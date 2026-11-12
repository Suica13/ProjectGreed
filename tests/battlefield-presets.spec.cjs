const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1600, 390])
  test(`thirty-six fixed battlefield presets apply era, limits and entry pay at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("battlefield");
    await page.locator("#createOfflineRoom").click();
    if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await expect(page.locator("#roomFormationRules")).toBeHidden();
    const presets = await page.evaluate(() => Rules.battlefieldMode.roomPresets);
    for (const preset of presets) {
      await page.locator("#battlefieldEra").selectOption(preset.era);
      await expect(page.locator("#battlefieldEra")).toHaveValue(preset.era);
      await page.locator("#battlefieldScalePreset").selectOption(preset.id);
      await expect.poll(() => page.evaluate(() => Rules.battlefieldMode.roomPreset(Net.snapshot.settings)?.id)).toBe(preset.id);
      await expect(page.locator("#roomCostLimit")).toHaveValue(String(preset.costLimit));
      await expect(page.locator("#roomUnitLimit")).toHaveValue(String(preset.unitLimit));
      expect(await page.evaluate(() => Net.snapshot.settings.battlefieldTeams.map(t => t.era))).toEqual([preset.era, preset.era]);
      expect(await page.evaluate(() => Rules.battlefieldMode.baseReward(Net.snapshot.settings, 0))).toMatchObject({ money: preset.money, supplies: preset.supplies });
    }
    expect(await page.locator("#battlefieldEra option[value=custom]").count()).toBe(0);
    expect(await page.locator("#battlefieldScalePreset option[value=custom]").count()).toBe(0);
    expect(await page.locator("#roomSettingsPage").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
