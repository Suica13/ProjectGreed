const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("combat reuses idle bystanders while keeping participating actors' playback attributes", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    Net.leave();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    const actors = structuredClone(game.units),
      idle = { ...structuredClone(game.units[0]), id: "bystander", hp: 500 };
    game.units.push(idle);
    game.units[0].hp = 1;
    const battle = {
      id: "empty-volley",
      a: actors[0].id,
      b: actors[1].id,
      actors,
      events: [],
      before: {},
    };
    MapCombat.reset();
    MapCombat.seed([battle]);
    battleView = { networkId: "bystanders", battles: [battle], actors, events: [] };
    MapCombat.begin(battleView, () => 0);
    const first = MapCombat.units();
    idle.hp = 450;
    const second = MapCombat.units();
    return {
      firstReused: first.find((unit) => unit.id === idle.id) === idle,
      secondReused: second.find((unit) => unit.id === idle.id) === idle,
      currentHp: second.find((unit) => unit.id === idle.id).hp,
      actorHp: second.find((unit) => unit.id === actors[0].id).hp,
      expectedActorHp: actors[0].hp,
      authoritativeHp: game.units[0].hp,
    };
  });
  expect(result.firstReused && result.secondReused).toBe(true);
  expect(result.currentHp).toBe(450);
  expect(result.actorHp).toBe(result.expectedActorHp);
  expect(result.authoritativeHp).toBe(1);
});
