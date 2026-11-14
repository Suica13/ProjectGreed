const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

for (const variant of [
  { name: "Windows", width: 1440, native: true, bom: true },
  { name: "Android", width: 390, native: true },
  { name: "portable HTML", width: 1440, native: false },
]) {
  test(`HTML imports ${variant.name} progress with pilots and a large carrier fleet`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: variant.width, height: 950 });
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    const { portable, native, expected } = await page.evaluate(() => {
      const data = ProfileSave.exportData();
      data.economy.money = 314159;
      data.economy.supplies = 271828;
      data.economy.inventory = { DogosseGiarClass: 3, RGM_79: 40 };
      data.economy.licenses.DogosseGiarClass = true;
      data.economy.licenses.RGM_79 = true;
      data.economy.claimed = { "native-import-receipt": "native-import-match" };
      data.development.points.EFSF = 12345;
      data.development.points.ZEON = 54321;
      const pilot = PilotSystem.custom({
        ...PilotSystem.createCustom("custom-native-import", "Native pilot"),
        level: 8,
        reincarnations: 1,
        experience: 200000,
      });
      data.pilots.PMC = { pilots: [pilot], awards: ["native-pilot-receipt"] };
      for (const store of Object.values(data.pilots)) store.awards = ["native-pilot-receipt"];
      const carrier = UnitModels.DogosseGiarClass__standard,
        units = [];
      for (let ship = 0; ship < 3; ship++) {
        const carrierIndex = units.length;
        units.push({ unitId: "DogosseGiarClass", kitId: "standard" });
        for (const hangar of carrier.hangars)
          for (let i = 0; i < 3; i++)
            units.push({
              unitId: "RGM_79",
              kitId: "machine_gun",
              preload: { carrierIndex, hangarId: hangar.id },
            });
      }
      units[1].customPilot = pilot;
      data.formations.PMC = {
        version: 3,
        index: 0,
        squads: [{ name: "Native carrier fleet", units }],
      };
      const values = Object.fromEntries(
        [...ProfileSave.storageEntries(data)].filter(([, v]) => v !== null),
      );
      values["slg-session-secret"] = "native-test-seat-token";
      values["projectgreed.campaign.backup.v1"] = "native-test-ongoing-campaign";
      return {
        portable: ProfileSave.encodeData(data),
        native: { format: "ProjectGreed-app-store", version: 1, revision: 17, values },
        expected: ProfileSave.validate(data),
      };
    });
    await page.locator("#shellSettings").click();
    await page.locator('[data-settings-tab="storage"]').click();
    expect(await page.evaluate(() => !!window.AppRuntime?.native)).toBe(false);
    const reloaded = page.waitForEvent("load");
    await page
      .locator("#profileSaveFile")
      .setInputFiles({
        name: "profile.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          (variant.bom ? "\uFEFF" : "") + JSON.stringify(variant.native ? native : portable),
        ),
      });
    await reloaded;
    await page.waitForFunction(() => assetsReady);
    const actual = await page.evaluate(() => {
      const data = ProfileSave.exportData();
      delete data.createdAt;
      return {
        data,
        token: localStorage.getItem("slg-session-secret"),
        campaign: localStorage.getItem("projectgreed.campaign.backup.v1"),
      };
    });
    expect(actual.data).toEqual(expected);
    expect(actual.token).toBeNull();
    expect(actual.campaign).toBeNull();
    expect(errors).toEqual([]);
  });
}

test("invalid native import leaves existing personal progress untouched", async ({ page }) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const before = await page.evaluate(() => ProfileSave.validate(ProfileSave.exportData()));
  await page
    .locator("#profileSaveFile")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ format: "ProjectGreed-app-store", version: 2, values: {} }),
      ),
    });
  await expect(page.locator("#profileSaveStatus")).toContainText("原生存档格式无效");
  expect(await page.evaluate(() => ProfileSave.validate(ProfileSave.exportData()))).toEqual(before);
});
