const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("AI quantity ratio has twelve choices, localizes, stays independent per bot and deploys 36 units", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  await page.locator("#roomUnitLimit").fill("12");
  await page.locator("#roomCostLimit").fill("10000");
  await waitForRoomSettings(page);
  await page.locator("#addAI2").click();
  await page.locator("#addAI3").click();
  await page.locator("#aiSettings1").click();
  await expect(page.locator("#ai-countPercent-1")).toHaveValue("100");
  expect(
    await page
      .locator("#ai-countPercent-1 option")
      .evaluateAll((options) => options.map((o) => o.value)),
  ).toEqual(Array.from({ length: 12 }, (_, i) => String((i + 1) * 25)));
  await page.locator("#ai-countPercent-1").selectOption("300");
  await expect(page.locator("#ai-countPercent-1")).toHaveValue("300");
  await expect(page.locator("#ai-fill-1")).toHaveValue("100");
  await expect(page.locator("#roomDetailContent")).toContainText("单位数量上限: 36 台");
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#roomDetailContent")).toContainText("Squad size ratio");
  await expect(page.locator("#roomDetailContent")).toContainText(
    "Unit limit: 36 (room limit 12 × 300%)",
  );
  await page.evaluate(() => I18n.setLanguage("ja"));
  await expect(page.locator("#roomDetailContent")).toContainText("編成機体数比率");
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.screenshot({ path: ".openai/ai-count-settings.png" });
  await page.locator("#closeRoomDetail").click();
  await page.locator("#aiSettings2").click();
  await expect(page.locator("#ai-countPercent-2")).toHaveValue("100");
  await page.locator("#ai-countPercent-2").selectOption("50");
  await expect(page.locator("#roomDetailContent")).toContainText("单位数量上限: 6 台");
  await page.locator("#closeRoomDetail").click();
  await page.locator("#aiSettings3").click();
  await expect(page.locator("#ai-countPercent-3")).toHaveValue("100");
  await page.locator("#closeRoomDetail").click();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(
    await page.evaluate(() =>
      [1, 2, 3].map((seat) => game.units.filter((u) => u.ownerSeat === seat).length),
    ),
  ).toEqual([36, 6, 12]);
  expect(
    await page.evaluate(
      () => new Set(game.units.map((u) => u.x + "," + u.y)).size === game.units.length,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => Rules.catalog.formation.maxUnits)).toBe(12);
  expect(errors).toEqual([]);
});
