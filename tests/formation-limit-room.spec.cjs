const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`room exposes only total COST and capacity and saves both at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    if (width < 720) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await expect(page.locator("#roomCostLimit")).toHaveValue("1500");
    await expect(page.locator("#roomUnitLimit")).toHaveValue("18");
    await expect(page.locator("#roomFormationStyle")).toBeHidden();
    await expect(page.locator("#roomUnitCostLimit")).toBeHidden();
    expect(
      await page
        .locator("#roomFormationPreset option")
        .evaluateAll((options) =>
          options.filter((o) => /^\d+,18$/.test(o.value)).map((o) => o.value),
        ),
    ).toEqual([1500, 2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000].map((c) => c + ",18"));
    for (const id of ["roomFleetUnitCostLimit", "roomCargoCostLimit"])
      await expect(page.locator("#" + id)).toHaveCount(0);
    await page.locator("#roomCostLimit").fill("4000");
    await page.locator("#roomCostLimit").press("Enter");
    await page.locator("#roomUnitLimit").fill("24");
    await page.locator("#roomUnitLimit").press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => [Net.snapshot.settings.costLimit, Net.snapshot.settings.unitLimit]),
      )
      .toEqual([4000, 24]);
    await page.locator("#roomPresetName").fill("容量预设");
    await page.locator("#saveRoomPreset").click();
    const saved = await page.locator("#roomFormationPreset").inputValue();
    expect(saved).toMatch(/^saved-/);
    await page.locator("#roomFormationPreset").selectOption("1500,18");
    await expect(page.locator("#roomUnitLimit")).toHaveValue("18");
    await page.locator("#roomFormationPreset").selectOption(saved);
    await expect(page.locator("#roomCostLimit")).toHaveValue("4000");
    await expect(page.locator("#roomUnitLimit")).toHaveValue("24");
    await page.locator("#roomBattleMode").selectOption("quick");
    await expect(page.locator("#roomFormationStyle")).toBeVisible();
    await page.locator("#roomFormationStyle").selectOption("free");
    await expect(page.locator("#roomUnitCostLimit")).toBeVisible();
    await page.locator("#roomUnitCostLimit").fill("500");
    await page.locator("#roomUnitCostLimit").press("Enter");
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.unitCostLimit)).toBe(500);
    await page.locator("#roomPresetName").fill("自由编组预设");
    await page.locator("#saveRoomPreset").click();
    const freePreset = await page.locator("#roomFormationPreset").inputValue();
    await page.locator("#roomFormationStyle").selectOption("standard");
    await expect(page.locator("#roomUnitCostLimit")).toBeHidden();
    await page.locator("#roomFormationPreset").selectOption(freePreset);
    await expect(page.locator("#roomFormationStyle")).toHaveValue("free");
    await expect(page.locator("#roomUnitCostLimit")).toHaveValue("500");
    await page.locator("#roomBattleMode").selectOption("regular");
    await expect
      .poll(() => page.evaluate(() => Net.snapshot.settings.formationStyle))
      .toBe("standard");
    await expect(page.locator("#roomFormationStyle")).toBeHidden();
    await page.screenshot({ path: `tmp/verification/screenshots/formation-limits-${width}.png` });
    expect(errors).toEqual([]);
  });
