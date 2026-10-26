const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("parallel map volleys share one dodge per second for the same defender", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry, entry], [entry]]);
    const attackers = game.units.filter((unit) => unit.team === 0);
    const target = game.units.find((unit) => unit.team === 1);
    Object.assign(target, { x: 12, y: 8, hp: 100000, shield: 0 });
    const battles = attackers.map((attacker, index) => {
      Object.assign(attacker, { x: 10, y: 7 + index, hp: 100000 });
      const weapon = getWeapon(attacker, "Common_DoubleVulcan_MS");
      const event = {
        from: attacker.id,
        to: target.id,
        weapon: weapon.id,
        before: target.hp,
        after: target.hp,
        hit: false,
        damage: 0,
        energySpent: 0,
        strikes: weapon.attack.strikes.map((strike) => ({
          ...strike,
          executed: true,
          hit: false,
          damage: 0,
          before: target.hp,
          after: target.hp,
        })),
      };
      return {
        id: "dodge-rate-" + index,
        a: attacker.id,
        b: target.id,
        actors: structuredClone([attacker, target]),
        events: [event],
        before: { [attacker.id]: attacker.hp, [target.id]: target.hp },
      };
    });
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      battles,
      actors: battles.flatMap((battle) => battle.actors),
      events: battles.flatMap((battle) => battle.events),
    };
    phase = "battle";
    setPageView("game");
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    return MapCombat.frames.map((frame) => ({
      moves: frame.plan.moves.map((move) => move.at),
      shots: frame.plan.shots.length,
      misses: frame.plan.contacts.every((contact) => !contact.hit),
    }));
  });
  expect(result).toHaveLength(2);
  expect(result.every((frame) => frame.shots === 16 && frame.misses)).toBe(true);
  const moves = result.flatMap((frame) => frame.moves).sort((a, b) => a - b);
  expect(moves.length).toBeGreaterThan(0);
  for (let i = 1; i < moves.length; i++) expect(moves[i] - moves[i - 1]).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});
