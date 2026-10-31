const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("all units finish each attack/counter wave before the next starts, including a longer counter tail", async ({
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
    planner.chooseBatch(
      room,
      request.id,
      [a.id, ally.id, a.id, a.id, a.id].map((targetId) => ({ targetId, weaponIds: [gun.id] })),
    );
    const battles = planner.resolve(room),
      starts = {},
      ends = {};
    // Hidden-effect records are merged separately by the network client: input order is not guaranteed.
    const mixed = [...battles].reverse();
    MapCombat.seed(mixed);
    battleView = {
      battles: mixed,
      mapBattle: true,
      actors: mixed.flatMap((b) => b.actors),
      events: mixed.flatMap((b) => b.events),
    };
    phase = "battle";
    setPageView("game");
    byId("quick").checked = true;
    MapCombat.begin(battleView, () => 0);
    const zero = performance.now(),
      original = CombatPlayback.finish;
    let finished = 0,
      previous = new Set();
    CombatPlayback.finish = () => finished++;
    try {
      for (let i = 0; i < 3000 && !finished; i++) {
        const now = zero + i * 50;
        MapCombat.update(now);
        const active = new Set(MapCombat.frames.map((f) => f.view.id));
        for (const id of active) starts[id] ??= now;
        for (const id of previous) if (!active.has(id)) ends[id] = now;
        previous = active;
      }
      const stages = battles.map((b) => ({
        id: b.id,
        wave: b.combatWave,
        stage: b.combatStage,
        start: starts[b.id],
        end: ends[b.id],
      }));
      return { finished, stages };
    } finally {
      CombatPlayback.finish = original;
      Rules.models[modelId] = base;
      MapCombat.reset();
      battleView = null;
    }
  });
  expect(result.finished).toBe(1);
  expect(result.stages).toHaveLength(9);
  for (const stage of result.stages) {
    expect(stage.start, JSON.stringify(stage)).toBeDefined();
    expect(stage.end, JSON.stringify(stage)).toBeDefined();
    const earlier = result.stages.filter(
      (b) =>
        b.wave < stage.wave ||
        (b.wave === stage.wave && stage.stage === "counter" && b.stage === "attack"),
    );
    for (const other of earlier) expect(stage.start).toBeGreaterThanOrEqual(other.end);
  }
  expect(result.stages.filter((b) => b.wave === 4 && b.stage === "counter")).toHaveLength(1);
  expect(errors).toEqual([]);
});
