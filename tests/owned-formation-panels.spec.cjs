const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
const Pilots = require("../shared/pilots");
for (const width of [1440, 390]) test("formation selects physical stored units and opens owned previews at " + width, async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript((pilot) => {
    if (!localStorage.getItem("owned-formation-fixture")) {
      localStorage.setItem("slg-formations-v1.PMC", JSON.stringify({ version: 3, squads: [{ name: "Owned fleet", units: [] }] }));
      localStorage.setItem("slg-formations-v1.PMC-active", "0");
      localStorage.setItem("owned-formation-fixture", "1");
      localStorage.setItem("projectgreed.custom-pilots.v3.shared", JSON.stringify({ pilots: [pilot], awards: [] }));
    }
  }, Pilots.createCustom("custom-owned-panel-pilot", "OwnedPilot"));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const fixture = await page.evaluate(() => {
    I18n.setLanguage("zh");
    Economy.creditActivity({ id: "owned-picker", matchId: "owned-picker", money: 100000, supplies: 100000,
      inventory: { Medea: 1, RGM_79: 2 }, licenses: { WhiteBase: true } });
    const stock = Economy.snapshot().storage, damaged = stock.units[1];
    Economy.setStoredPilot(damaged.id, "custom-owned-panel-pilot");
    Economy.creditAward({ id: "owned-damage", matchId: "battle", money: 0, supplies: 0,
      stockStates: [{ stockId: damaged.id, unitId: damaged.unitId, kitId: damaged.kitId, hp: 1000, en: 10, brokenParts: { leftArm: true } }] });
    return { carrier: stock.ships[0].id, passenger: damaged.id };
  });
  await page.locator("#shellHangar").click();
  await page.locator("#shellFormation").click();
  await page.locator("#openFormationPicker").click();
  await expect(page.locator('.catalog-unit[data-unit-id="WhiteBase"]')).toHaveCount(0);
  await expect(page.locator('.catalog-unit[data-stock-id]')).toHaveCount(1);
  await expect(page.locator("#formationCatalog .unit-tags-more")).toHaveCount(0);
  await page.locator('#formationCatalog .catalog-unit[data-stock-id="' + fixture.carrier + '"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator('#formationCatalog .catalog-unit[data-stock-id="' + fixture.carrier + '"]')).toBeDisabled();
  await page.locator("#closeFormationPicker").click();
  await page.locator('[data-add-hangar-carrier="0"]').first().click();
  await page.locator('#formationCatalog .catalog-unit[data-stock-id="' + fixture.passenger + '"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator('#formationCatalog .catalog-unit[data-stock-id="' + fixture.passenger + '"]')).toBeDisabled();
  await page.locator("#closeFormationPicker").click();
  await page.locator('[data-formation-index="1"] .formation-detail-button').click();
  await expect(page.locator("#warehouseDialog")).toBeVisible();
  await expect(page.locator("#formationUnitDetail")).not.toBeVisible();
  await expect(page.locator('#warehouseDialog [role="meter"][aria-label="HP"]')).toHaveAttribute("aria-valuenow", "1000");
  await expect(page.locator('.warehouse-part[data-part-id="leftArm"]')).toHaveClass(/is-broken/);
  await expect(page.locator(".warehouse-detail-pilot")).toContainText("OwnedPilot");
  const kits = await page.locator("#warehouseDetailKit option").evaluateAll((nodes) => nodes.map((node) => node.value));
  if (kits.length > 1) await page.locator("#warehouseDetailKit").selectOption(kits[1]);
  await page.screenshot({ path: `tmp/verification/screenshots/owned-unit-blue-${width}.png` });
  await page.locator("#warehouseOpenCatalog").click();
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await expect(page.locator("#formationUnitDetail .eyebrow")).toHaveCount(0);
  const catalogLayout = await page.locator("#formationUnitDetail").evaluate((node) => {
    const tags = node.querySelector("#formationDetailTags").getBoundingClientRect(), preview = node.querySelector(".unit-detail-preview-box").getBoundingClientRect();
    return { clear: tags.bottom <= preview.y, overflow: node.querySelector(".formation-detail-dialog").scrollWidth > node.querySelector(".formation-detail-dialog").clientWidth + 1 };
  });
  expect(catalogLayout.clear).toBe(true);
  expect(catalogLayout.overflow).toBe(false);
  await page.screenshot({ path: `tmp/verification/screenshots/encyclopedia-blue-${width}.png` });
  await page.locator("#closeFormationDetail").click();
  await page.locator("#warehouseClose").click();
  const current = await page.evaluate(() => Formation.current());
  expect(current[1].stockId).toBe(fixture.passenger);
  expect(current[1].customPilot.id).toBe("custom-owned-panel-pilot");
  if (kits.length > 1) expect(current[1].kitId).toBe(kits[1]);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Formation.current()[1].stockId)).toBe(fixture.passenger);
  await page.evaluate(() => Formation.previewUnit("WhiteBase"));
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await expect(page.locator("#warehouseDialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});
