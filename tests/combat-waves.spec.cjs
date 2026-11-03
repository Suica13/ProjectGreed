const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("automatic attack and counter volleys alternate and complete with shuffled network records", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    await SpriteRenderer.load();
    Net.leave();
    TurnFlow.reset();
    MapCombat.reset();
    const entry = { unitId: "Type61", kitId: "standard" };
    game = Rules.create(
      false,
      2,
      [
        [entry, entry],
        [entry, entry],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    game.fogMode = "disabled";
    game.tiles.forEach((r) => r.fill("plain"));
    const [a, ally, b] = game.units,
      modelId = a.model,
      base = Rules.models[modelId];
    const native = base.weapons.find((w) => w.slot !== "skill");
    const gun = {
      ...native,
      id: "wave-gun",
      min: 1,
      max: 10,
      en: 1,
      actionCost: 1,
      hit: 1000,
      damage: 25,
      damageComponents: { shell: 25 },
      attack: {
        ...native.attack,
        strikes: native.attack.strikes.map((s) => ({ ...s, damageComponents: { shell: 25 } })),
      },
    };
    Rules.models[modelId] = {
      ...base,
      actionPoints: 8,
      weapons: [gun],
      skills: [],
      partsBreakable: false,
    };
    game.units.forEach((u, i) =>
      Object.assign(u, {
        x: 10 + i * 2,
        y: 10,
        hp: 1000000,
        en: 10000,
        shield: 0,
        actionPoints: 8,
        pilot: { stats: PilotSystem.baseStats() },
      }),
    );
    let seq = 0;
    const planner = createAttackPlanner(Rules, () => "wave-" + ++seq),
      room = { game, matchId: "browser-waves" };
    planner.reset(room);
    planner.plan(room, a, b, [gun, gun, gun], 0);
    planner.plan(room, ally, b, [gun], 0);
    const [request] = planner.prepare(room);
    planner.chooseBatch(room, request.id, [{ targetId: a.id }]);
    const battles = planner.resolve(room),
      mixed = [...battles].reverse();
    MapCombat.seed(mixed);
    battleView = {
      battles: mixed,
      mapBattle: true,
      actors: mixed.flatMap((b) => b.actors),
      events: mixed.flatMap((b) => b.events),
      completed: false,
    };
    phase = "battle";
    setPageView("game");
    byId("quick").checked = true;
    const original = CombatPlayback.finish;
    let finished = false,
      overlap = false;
    CombatPlayback.finish = () => {
      finished = true;
    };
    const zero = performance.now();
    MapCombat.begin(battleView, () => 1);
    for (let elapsed = 0; elapsed < 60000 && !finished; elapsed += 30) {
      MapCombat.update(zero + elapsed);
      const stages = new Set(
        MapCombat.frames
          .filter((f) => f.plan.shots.some((shot) => f.time >= shot.at && f.time <= shot.impactAt))
          .map((f) => f.view.combatStage),
      );
      if (stages.has("attack") && stages.has("counter")) overlap = true;
    }
    CombatPlayback.finish = original;
    MapCombat.reset();
    battleView = null;
    phase = "idle";
    return {
      finished,
      overlap,
      crossfire: battles.every((b) => b.crossfire),
      counters: battles.filter((b) => b.combatStage === "counter").map((b) => b.b),
      target: a.id,
    };
  });
  expect(result.finished).toBe(true);
  expect(result.overlap).toBe(false);
  expect(result.crossfire).toBe(true);
  expect(result.counters.length).toBeGreaterThan(0);
  expect(result.counters.every((id) => id === result.target)).toBe(true);
  expect(errors).toEqual([]);
});
