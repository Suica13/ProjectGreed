const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page).toHaveTitle("ProjectGreed V0.2");
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
    Rules.move(game, a, 3, 3);
    selected = a.id;
    update();
  });
  const undo = page.getByRole("button", { name: "撤销移动", exact: true });
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
  await expect(page.locator("#reactionSub")).toContainText("本回合剩余反击 0 / 2");
  await expect(page.locator("#responseEvade")).toContainText("机动性×1.25");
  await expect(page.locator("#responseDefend")).toContainText("格挡率+25个百分点");
  await page.locator("#responseEvade").click();
  expect(
    await page.evaluate(
      () =>
        Rules.estimate(
          game,
          game.units[0],
          game.units[1],
          getWeapon(game.units[0], "EF_90mmMG"),
          response,
        ).hit,
    ),
  ).toBe(71.8125);
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#reactionSub")).toContainText("Counters remaining this turn: 0 / 2");
  await expect(page.locator("#responseEvade")).toContainText("mobility ×1.25");
  await page.evaluate(() => I18n.setLanguage("ja"));
  await expect(page.locator("#responseEvade")).toContainText("機動性×1.25");
  expect(
    await page.evaluate(() =>
      UnitModels.RGM_79L__machine_gun.weapons.some((w) => w.id === "Common_DoubleVulcan_MS"),
    ),
  ).toBe(true);
});
