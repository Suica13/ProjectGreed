const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1600, 390])
  test(`six battlefield room sizes apply era, PMC limits and entry pay at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("battlefield");
    await page.locator("#createOfflineRoom").click();
    if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    const presets = await page.evaluate(() => Rules.battlefieldMode.roomPresets);
    for (const preset of presets) {
      await page.locator("#battlefieldScalePreset").selectOption(preset.id);
      await expect
        .poll(() =>
          page.evaluate(() => Rules.battlefieldMode.roomPreset(Net.snapshot.settings)?.id),
        )
        .toBe(preset.id);
      await expect(page.locator("#roomCostLimit")).toHaveValue(String(preset.costLimit));
      await expect(page.locator("#roomUnitCostLimit")).toHaveValue(String(preset.unitCostLimit));
      await expect(page.locator("#roomUnitLimit")).toHaveValue(String(preset.unitLimit));
      for (const team of [0, 1])
        await expect(page.locator(`#battlefieldTeam${team}era`)).toHaveValue(preset.era);
      await expect(page.locator("#battlefieldEntryReward")).toContainText(
        preset.money.toLocaleString("en-US"),
      );
      await expect(page.locator("#battlefieldEntryReward")).toContainText(
        preset.supplies.toLocaleString("en-US"),
      );
    }
    await page.locator("#roomPresetName").fill("War room size");
    await page.locator("#saveRoomPreset").click();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("projectgreed.room-rule-presets.v1")).find(
        (p) => p.name === "War room size",
      ),
    );
    expect(saved.rules.battlefieldTeams.every((t) => t.era === "0087T2")).toBe(true);
    await page.locator("#battlefieldScalePreset").selectOption("0079T1-small");
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.costLimit)).toBe(4000);
    await page.locator("#roomFormationPreset").selectOption(saved.id);
    await expect
      .poll(() => page.evaluate(() => Rules.battlefieldMode.roomPreset(Net.snapshot.settings)?.id))
      .toBe("0087T2-large");
    await page.locator("#roomCostLimit").fill("99999");
    await page.locator("#roomCostLimit").blur();
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.costLimit)).toBe(99999);
    await expect(page.locator("#battlefieldEntryReward")).toContainText("13,500");
    await page.locator("#battlefieldTeam0faction").selectOption("EFSF");
    await expect
      .poll(() => page.evaluate(() => Net.snapshot.settings.battlefieldTeams[0].era))
      .toBe("0079T1");
    await expect(page.locator("#battlefieldEntryReward")).toContainText("6,000");
    await expect(page.locator("#battlefieldEntryReward")).toContainText("13,500");
    expect(
      await page
        .locator("#roomSettingsPage")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
