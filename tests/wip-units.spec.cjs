const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  G = require("../shared/rules.js");
for (const width of [1280, 390])
  test(`WIP units remain visible with black overlay and cannot be added at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const prefab = G.catalog.prefabs.find((p) => p.id === "ApsarasII"),
      entry = { unitId: prefab.id, kitId: prefab.weaponKits[0].id };
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript((entry) => {
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem(
        "slg-formations-v1.PMC",
        JSON.stringify({
          version: 3,
          squads: [{ name: "WIP旧编组", units: [entry, { unitId: "Type61", kitId: "standard" }] }],
        }),
      );
    }, entry);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openFormation").click();
    const saved = page.locator('#formationUnits [data-formation-index="0"]');
    await expect(saved.locator(".overcost-label")).toHaveText("WIP");
    await expect(saved.locator(".disabled-panel")).toBeVisible();
    await page.locator("#openFormationPicker").click();
    await page.locator("#formationSearch").fill("Apsaras");
    const card = page.locator('[data-unit-id="ApsarasII"]'),
      row = page.locator(".catalog-unit-row").filter({ has: card });
    await expect(card).toBeVisible();
    await expect(card).toBeDisabled();
    await expect(row.locator(".overcost-label")).toHaveText("WIP");
    await expect(row.locator(".disabled-panel")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0.62)",
    );
    await expect(page.locator("#addFormationUnit")).toBeDisabled();
    expect(
      await page.evaluate(() =>
        PlayerProfile.allows(Rules.catalog.prefabs.find((p) => p.id === "ApsarasII")),
      ),
    ).toBe(false);
    await row.locator(".catalog-detail").click();
    await expect(page.locator("#formationDetailTitle")).toContainText("阿普萨拉斯");
    expect(await page.evaluate(() => Formation.current().length)).toBe(2);
    expect(errors).toEqual([]);
  });
