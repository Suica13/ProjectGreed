const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("map combat draws looping death electricity until the explosion begins", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]]);
    const [a, b] = game.units;
    Object.assign(a, { x: 10, y: 7 });
    Object.assign(b, { x: 12, y: 7, hp: 1, shield: 0 });
    const weapon = getWeapon(a, "EF_90mmMG");
    const event = {
      from: a.id,
      to: b.id,
      weapon: weapon.id,
      hit: true,
      before: 1,
      after: 0,
      damage: 1,
    };
    const battle = {
      id: "electric-test",
      a: a.id,
      b: b.id,
      actors: structuredClone([a, b]),
      events: [event],
      before: { [a.id]: a.hp, [b.id]: b.hp },
    };
    MapCombat.reset();
    MapCombat.seed([battle]);
    battleView = { ...battle, battles: [battle] };
    phase = "battle";
    setPageView("game");
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const current = MapCombat.frames[0];
    const plan = current.plan;
    const original = SpriteEffects.draw,
      drawn = [];
    SpriteEffects.draw = (...args) => {
      const visible = original(...args);
      if (args[1] === ART.presentation.deathElectricEffect && visible) drawn.push(args[5]);
      return visible;
    };
    const samples = [];
    try {
      for (const elapsed of [
        0.01,
        ART.effects[ART.presentation.deathElectricEffect].duration * 2.1,
        plan.deathAt - plan.deathSoundAt - 0.001,
        plan.deathAt - plan.deathSoundAt,
      ]) {
        drawn.length = 0;
        current.time = plan.deathSoundAt + elapsed;
        drawMap(performance.now());
        samples.push(drawn.length);
      }
    } finally {
      SpriteEffects.draw = original;
    }
    return samples;
  });
  expect(result.slice(0, 3).every((count) => count > 0)).toBe(true);
  expect(result[3]).toBe(0);
  expect(errors).toEqual([]);
});
