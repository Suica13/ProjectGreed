const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page).toHaveTitle("ProjectGreed V06");
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
}
test("offline undo control locks earlier units after a later move and never overlaps units", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.evaluate(() => {
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[e, e], [e]]);
    phase = "idle";
    const [a, b] = game.units;
    Object.assign(a, { x: 2, y: 3 });
    Object.assign(b, { x: 2, y: 5 });
    selected = a.id;
    update();
  });
  const move = page.getByRole("button", { name: "移动", exact: true });
  await expect(move).toBeEnabled();
  await move.click();
  await page.evaluate(() => {
    Rules.move(game, game.units[0], 3, 3);
    update();
  });
  await expect(move).toHaveCount(0);
  const undo = page.getByRole("button", { name: "撤回移动", exact: true });
  await expect(undo).toBeEnabled();
  await page.evaluate(() => {
    Rules.move(game, game.units[1], 2, 3);
    selected = game.units[0].id;
    update();
  });
  await expect(undo).toBeDisabled();
  await page.evaluate(() => {
    selected = game.units[1].id;
    update();
  });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(move).toBeEnabled();
  await page.evaluate(() => {
    selected = game.units[0].id;
    update();
  });
  await expect(undo).toBeDisabled();
  expect(await page.evaluate(() => new Set(game.units.map((u) => u.x + "," + u.y)).size)).toBe(3);
  expect(errors).toEqual([]);
});
test("reaction UI honors exhausted counter budgets and displays the new defense and evade rules in all languages", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const e = { unitId: "RGM_79L", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[e], [e]]);
    phase = "idle";
    const [a, b] = game.units;
    Object.assign(a, { x: 2, y: 3 });
    Object.assign(b, { x: 4, y: 3, counterCount: 2 });
    selected = a.id;
    beginAttack(a, b, getWeapon(a, "EF_90mmMG"));
  });
  await expect(page.locator("#reaction")).toBeVisible();
  await expect(page.locator("#responseCounter")).toBeDisabled();
  await expect(page.locator("#reactionSub")).not.toContainText("剩余反击");
  await expect(page.locator("#responseEvade")).toContainText("反应系数×1.25");
  await expect(page.locator("#responseDefend")).toContainText("格挡率+25个百分点");
  await expect(page.locator("#responseDefend")).toContainText("最终伤害减少25%");
  await expect(page.locator("#responseEvade")).toContainText("最终回避率+15个百分点");
  await page.locator("#responseEvade").click();
  const chances = await page.evaluate(() => {
    const [a, b] = game.units,
      weapon = { ...getWeapon(a, "EF_90mmMG"), hit: 60 };
    return {
      normal: Rules.estimate(game, a, b, weapon, "counter").hit,
      evade: Rules.estimate(game, a, b, weapon, response).hit,
      mobility: Rules.modelOf(b).mobility,
    };
  });
  expect(chances.normal - chances.evade).toBeCloseTo(chances.mobility * 0.25 * 0.25 + 15);
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#reactionSub")).not.toContainText("Counters remaining");
  await expect(page.locator("#responseEvade")).toContainText("reaction coefficient ×1.25");
  await expect(page.locator("#responseEvade")).toContainText("15 percentage points");
  await expect(page.locator("#responseDefend")).toContainText("final damage taken −25%");
  await page.evaluate(() => I18n.setLanguage("ja"));
  await expect(page.locator("#responseEvade")).toContainText("反応係数×1.25");
  await expect(page.locator("#responseEvade")).toContainText("最終回避率+15ポイント");
  await expect(page.locator("#responseDefend")).toContainText("最終被ダメージ25%軽減");
  expect(
    await page.evaluate(() =>
      UnitModels.RGM_79L__machine_gun.weapons.some((w) => w.id === "Common_DoubleVulcan_MS"),
    ),
  ).toBe(true);
});
