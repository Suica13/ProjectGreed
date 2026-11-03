const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("modern pilot saves bypass obsolete rosters and catalog clicks preserve every card", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "projectgreed.custom-pilots.v3.shared",
      JSON.stringify({ pilots: [], awards: [] }),
    );
    window.legacyPilotReads = [];
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (String(key).startsWith("projectgreed.custom-pilots.v2.")) legacyPilotReads.push(key);
      return get.call(this, key);
    };
  });
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  expect(await page.evaluate(() => legacyPilotReads)).toEqual([]);
  await page.evaluate(() => Formation.open());
  await page.locator("#openFormationPicker").click();
  await page.locator("#formationStock").selectOption("all");
  const result = await page.evaluate(() => {
    const list = byId("formationCatalog"),
      cards = [...list.querySelectorAll(".catalog-unit:not(:disabled)")];
    const rows = [...list.children],
      before = list.scrollTop;
    let added = 0,
      removed = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        added += record.addedNodes.length;
        removed += record.removedNodes.length;
      }
    });
    observer.observe(list, { childList: true, subtree: true });
    const at = performance.now();
    for (const card of cards.slice(0, 30)) card.click();
    const ms = performance.now() - at;
    for (const record of observer.takeRecords()) {
      added += record.addedNodes.length;
      removed += record.removedNodes.length;
    }
    observer.disconnect();
    return {
      added,
      removed,
      ms,
      count: cards.length,
      rowsStable: rows.every((row, i) => list.children[i] === row),
      scrollStable: list.scrollTop === before,
      selected: list.querySelectorAll('[aria-selected="true"]').length,
      selectedId: list.querySelector('[aria-selected="true"]')?.dataset.unitId,
      chosen: byId("formationPrefab").value,
    };
  });
  console.log("UNIT_CATALOG_PROFILE", JSON.stringify(result));
  expect(result.count).toBeGreaterThan(30);
  expect(result.rowsStable).toBe(true);
  expect(result.scrollStable).toBe(true);
  expect(result.selected).toBe(1);
  expect(result.selectedId).toBe(result.chosen);
  expect(result.added + result.removed).toBe(0);
  await page.evaluate(() => {
    window.savedCatalogRows = [...byId("formationCatalog").children];
    byId("formationCatalog").querySelector('[data-detail-unit-id="RGM_79"]').click();
  });
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await page.locator("#closeFormationDetail").click();
  expect(
    await page.evaluate(() =>
      savedCatalogRows.every((row, i) => byId("formationCatalog").children[i] === row),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    byId("formationCatalog").querySelector('[data-detail-unit-id="RGM_79"]').click(),
  );
  await page.locator("#formationDetailKit").selectOption("bazooka");
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator('.catalog-unit[data-unit-id="RGM_79"]')).toHaveAttribute(
    "data-preview-kit",
    "bazooka",
  );
});

test("an old faction roster still migrates when no shared roster exists", async ({ page }) => {
  const pilot = require("../shared/pilots.js").createCustom(
    "custom-legacy-perf-pilot",
    "Legacy pilot",
    undefined,
    "EFSF",
  );
  await page.addInitScript((base) => {
    localStorage.removeItem("projectgreed.custom-pilots.v3.shared");
    localStorage.setItem(
      "projectgreed.custom-pilots.v2.EFSF",
      JSON.stringify({ pilots: [base], awards: [] }),
    );
  }, pilot);
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared")).pilots.some(
        (p) => p.id === "custom-legacy-perf-pilot",
      ),
    ),
  ).toBe(true);
});

test("cargo ordering, equipment autosave and carrier removal work through current controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("projectgreed.combatFaction", "PMC");
    if (!localStorage.getItem("slg-formations-v1.PMC"))
      localStorage.setItem(
        "slg-formations-v1.PMC",
        JSON.stringify({
          version: 3,
          squads: [
            {
              name: "Cargo regression",
              units: [
                { unitId: "PegasusClass", kitId: "standard" },
                {
                  unitId: "RGM_79",
                  kitId: "machine_gun",
                  preload: { carrierIndex: 0, hangarId: "Hangar_1" },
                },
                { unitId: "Type61", kitId: "standard" },
                {
                  unitId: "RGM_79",
                  kitId: "machine_gun",
                  preload: { carrierIndex: 0, hangarId: "Hangar_2" },
                },
                {
                  unitId: "RGM_79",
                  kitId: "machine_gun",
                  preload: { carrierIndex: 0, hangarId: "Hangar_1" },
                },
              ],
            },
          ],
        }),
      );
  });
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#shellHangar").click();
  expect(
    await page
      .locator("#formationUnits > .formation-row")
      .evaluateAll((rows) => rows.map((r) => Number(r.dataset.formationIndex))),
  ).toEqual([0, 1, 4, 3, 2]);
  await page.locator('[data-formation-index="1"] .formation-detail-button').click();
  await page.locator("#formationDetailKit").selectOption("beam_spray");
  await page.locator("#closeFormationDetail").click();
  await page.reload();
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#shellHangar").click();
  expect(await page.evaluate(() => Formation.current()[1])).toEqual({
    unitId: "RGM_79",
    kitId: "beam_spray",
    preload: { carrierIndex: 0, hangarId: "Hangar_1" },
  });
  await page
    .locator('[data-formation-index="0"]')
    .getByRole("button", { name: "移除", exact: true })
    .click();
  expect(await page.evaluate(() => Formation.current().length)).toBe(4);
  expect(await page.evaluate(() => Formation.current().some((e) => e.preload))).toBe(false);
});
