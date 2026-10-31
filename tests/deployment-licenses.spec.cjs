const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const tree = require("../shared/development-tree.json");
for (const width of [1280, 390])
  test(`license migration, purchase, free kits and duplicate formation at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      ({ tree }) => {
        if (localStorage.getItem("licenseTestSeeded")) return;
        localStorage.setItem("licenseTestSeeded", "1");
        localStorage.setItem(
          "projectgreed.economy.v1",
          JSON.stringify({
            money: 1000000,
            supplies: 1000000,
            inventory: { Type61: 24 },
            kits: { RGM_79__bazooka: 5 },
          }),
        );
        localStorage.setItem(
          "projectgreed.developmentProgress.v1",
          JSON.stringify({
            points: { EFSF: 0, ZEON: 0 },
            claimed: {},
            researched: Object.fromEntries(
              ["EFSF", "ZEON"].map((f) => [f, tree[f].map((n) => n.id)]),
            ),
          }),
        );
      },
      { tree },
    );
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      ProductionUI.openUnit("RGM_79");
    });
    await expect(page.locator("#productionTitle")).toHaveText("部署许可");
    await expect(page.locator("#productionKit")).toHaveValue("beam_spray");
    expect(await page.evaluate(() => Economy.hasLicense("Type61"))).toBe(true);
    await expect(page.locator("#buyProductionKit")).toHaveCount(0);
    await expect(page.locator("#openFormationKitShop")).toHaveCount(0);
    const before = await page.evaluate(() => Economy.snapshot().money);
    const price = await page.evaluate(
      () => Economy.licenseOffer("RGM_79").money,
    );
    await page.locator("#produceUnit").click();
    await expect(page.locator("#produceUnit")).toBeDisabled();
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(before - price);
    await page.locator("#productionKit").selectOption("bazooka");
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(before - price);
    const save = await page.evaluate(() => ProfileSave.validate(ProfileSave.exportData()).economy);
    expect(save.licenses.RGM_79).toBe(true);
    expect(save.inventory).toBeUndefined();
    expect(save.kits).toBeUndefined();
    await page.evaluate(() => Formation.open());
    const original = await page.locator("#formationUnits .formation-row").count();
    await page.locator("#openFormationPicker").click();
    await page.locator("#formationSearch").fill("RGM_79");
    await page.locator('#formationCatalog [data-unit-id="RGM_79"]').click();
    await page.locator("#addFormationUnit").click();
    await page.locator("#addFormationUnit").click();
    await page.locator("#closeFormationPicker").click();
    await expect(page.locator("#formationUnits .formation-row")).toHaveCount(original + 2);
    expect(
      await page
        .locator("#formationUnits .formation-row")
        .evaluateAll((rows) =>
          rows.slice(-2).every((row) => !row.classList.contains("inventory-shortage")),
        ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => SpecialTransforms.open("MS_06S"));
    await expect(page.locator("#specialTransformsDialog")).toContainText("特殊变换");
    await expect(page.locator(".special-transform-row")).not.toHaveCount(0);
    await expect(page.locator("#specialTransformsDialog")).not.toContainText("Pilot_");
    await expect(page.locator("#specialTransformsDialog button")).toHaveCount(1);
    expect(await page.locator("#specialTransformsDialog img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    await page.locator("#specialTransformsDialog button").click();
    const archive = await page.evaluate(() => ProfileSave.exportData());
    await page.evaluate((archive) => ProfileSave.importData(archive), archive);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(await page.evaluate(() => Economy.hasLicense("RGM_79"))).toBe(true);
    expect(await page.evaluate(() => Economy.storageIssue())).toBe(null);
    expect(errors).toEqual([]);
  });
