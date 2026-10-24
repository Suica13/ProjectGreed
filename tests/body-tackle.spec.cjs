const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("body tackle remains selectable with destroyed arms and no EN and plays the native body animation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect.poll(() => page.evaluate(() => assetsReady)).toBe(true);
  await page.evaluate(() => {
    Net.leave();
    game = Rules.create(false, 1, [
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]);
    const [a, b] = game.units;
    Object.assign(a, { x: 2, y: 4, en: 0, brokenParts: { leftArm: true, rightArm: true } });
    Object.assign(b, { x: 3, y: 4, hp: 100000, shield: 0 });
    game.tiles[4][2] = game.tiles[4][3] = "plain";
    selected = a.id;
    phase = "idle";
    mode = "select";
    weaponId = null;
    moving = null;
    battleView = null;
    setPageView("game");
    update();
  });
  const skill = page.getByRole("button", { name: "技能 冲撞", exact: true });
  await expect(skill).toBeEnabled();
  await skill.click();
  await expect(page.locator(".target-button")).toHaveCount(1);
  const result = await page.evaluate(() => {
    const [a, b] = game.units,
      w = getWeapon(a, weaponId),
      held = a.heldWeapon;
    const event = Rules.fight(game, a, b, w, "defend", null, false)[0];
    const source = { unit: a, x: 100, y: 100, angle: 90, scale: 1 },
      target = { unit: b, x: 200, y: 100, angle: -90, scale: 1 };
    const plan = WeaponEffects.plan(w, source, target, event);
    return {
      id: weaponId,
      held: a.heldWeapon,
      original: held,
      en: a.en,
      clip: WeaponSequence.pose(w, 0.45).clip,
      shots: plan.contacts.length,
      sounds: plan.cues.filter((c) => c.sound === w.sound).length,
      acted: a.acted,
    };
  });
  expect(result.id).toBe("Common_Push_A");
  expect(result.clip).toBe("Common_Push_A");
  expect(result.held).toBe(result.original);
  expect(result.en).toBe(0);
  expect(result.acted).toBe(true);
  expect(result.shots).toBe(1);
  expect(result.sounds).toBe(1);
  expect(errors).toEqual([]);
});
