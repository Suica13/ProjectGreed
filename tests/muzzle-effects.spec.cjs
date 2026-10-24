const { test, expect } = require("@playwright/test");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("native muzzle flash renders on the map after dodge and reaction labels localize", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  const result = await page.evaluate(() => {
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    Object.assign(a, { x: 10, y: 7, hp: 100000, shield: 0, dodgeSlot: 1 });
    Object.assign(b, { x: 13, y: 7, hp: 100000, shield: 0 });
    game.tiles[7][10] = game.tiles[7][13] = "plain";
    selected = a.id;
    update();
    const actors = JSON.parse(JSON.stringify([a, b])),
      weapon = UnitModels[a.model].weapons.find((w) => w.projectile);
    const events = Rules.fight(game, a, b, weapon, "defend");
    const record = {
      id: "muzzle-fixture",
      a: a.id,
      b: b.id,
      actors,
      events,
      before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
    };
    MapCombat.reset();
    MapCombat.seed([record]);
    battleView = {
      ...record,
      index: 0,
      start: performance.now(),
      displayHp: { ...record.before },
      completed: false,
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const f = MapCombat.frame;
    f.time = f.plan.shots[0].at + 0.04;
    MapCombat.suspend(battleView);
    MapCamera.setZoom(4);
    MapCamera.focus(11, 7, { preserveZoom: true });
    let rendered = 0;
    const original = SpriteEffects.draw;
    SpriteEffects.draw = function (...args) {
      const value = original(...args);
      if (f.weapon.muzzleEffects.includes(args[1]) && value) rendered++;
      return value;
    };
    drawMap(performance.now());
    SpriteEffects.draw = original;
    return {
      rendered,
      effect: f.weapon.muzzleEffects[0],
      ready: SpriteRenderer.images[ART.effects[f.weapon.muzzleEffects[0]].asset].complete,
    };
  });
  expect(result.ready).toBe(true);
  expect(result.rendered).toBeGreaterThan(0);
  await expect(page.locator("#battle")).toBeHidden();
  await expect(page.locator("#unitPanel .stats")).toContainText("反应系数");
  await page.screenshot({ path: ".openai/native-muzzle-map.png" });
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#unitPanel .stats")).toContainText("Reaction coefficient");
  await page.evaluate(() => I18n.setLanguage("ja"));
  await expect(page.locator("#unitPanel .stats")).toContainText("反応係数");
  expect(errors).toEqual([]);
});
