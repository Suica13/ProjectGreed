const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`ordinary BWS forms remain selectable and transform in hangar and deployment at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("projectgreed.language", "zh");
      localStorage.setItem(
        "slg-formations-v1.PMC",
        JSON.stringify({
          version: 3,
          squads: [{ name: "BWS", units: [{ unitId: "RGZ_91B", kitId: "standard" }] }],
        }),
      );
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({
          schemaVersion: 3,
          money: 10000,
          supplies: 20000,
          licenses: {},
          inventory: { RGZ_91B: 2 },
          kits: {},
        }),
      );
    });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => MenuShell.go("formation"));
    await expect(page.locator("#formationUnits .formation-transform-button").first()).toBeVisible();
    await page.locator("#formationUnits .formation-transform-button").first().click();
    await page.locator("dialog[open]").getByRole("button", { name: /MA/ }).click();
    expect(await page.evaluate(() => Formation.current()[0].unitId)).toBe("RGZ_91B_MA");
    expect(await page.evaluate(() => Economy.quantity("RGZ_91B_MA"))).toBe(1);
    expect(await page.evaluate(() => Economy.hasLicense("RGZ_91B_MA"))).toBe(false);
    await page.evaluate(() => MenuShell.go("production"));
    await page.locator("#productionSearch").fill("RGZ_91B_MA");
    await expect(page.locator("#productionList .production-unit").first()).toBeVisible();
    await page.evaluate(() => {
      MenuShell.go("menu");
      const original = createRoomEngine;
      createRoomEngine = (options) => original({ ...options, aiDelayMs: 999999 });
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("quick");
    await page.locator("#createOfflineRoom").click();
    await page.evaluate(() => Net.request("configure_room", {costLimit:99999,unitCostLimit:99999,unitLimit:36}));
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await page.locator("#deploymentRoster button[data-unit-id]").first().click();
    await expect(page.locator("#deploymentTransform")).toBeVisible();
    await page.locator("#deploymentTransform").click();
    await expect
      .poll(() => page.evaluate(() => Rules.modelOf(getUnit(selected)).prefabId))
      .toBe("RGZ_91B");
    expect(errors).toEqual([]);
  });
