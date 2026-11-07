const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("one UI refresh shares target probes and the next refresh observes changed combat state", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    Net.leave();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    game.tiles.forEach((row) => row.fill("plain"));
    game.deployment = null;
    const [own, enemy] = game.units;
    Object.assign(own, { x: 5, y: 5 });
    Object.assign(enemy, { x: 5, y: 7 });
    const original = Rules.automaticWeapons;
    let calls = 0;
    Rules.automaticWeapons = (...args) => {
      calls++;
      return original(...args);
    };
    try {
      const answers = AttackControls.withTargetQuery(() =>
        Array.from({ length: 5 }, () => AttackControls.canTarget(own, enemy)),
      );
      const firstCalls = calls;
      enemy.hp = 0;
      const after = AttackControls.withTargetQuery(() => AttackControls.canTarget(own, enemy));
      enemy.hp = 100;
      const outside = AttackControls.canTarget(own, enemy);
      return { answers, firstCalls, after, outside, calls };
    } finally {
      Rules.automaticWeapons = original;
    }
  });
  expect(result.answers).toEqual(Array(5).fill(true));
  expect(result.firstCalls).toBe(1);
  expect(result.after).toBe(false);
  expect(result.outside).toBe(true);
  expect(result.calls).toBe(2);
});
