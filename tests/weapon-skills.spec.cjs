const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function start(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
}
test("aircraft flies over its target and drops finite vertical bombs even on a Miss", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const result = await page.evaluate(() => {
    Net.leave();
    const model = Object.values(UnitModels).find((m) =>
      m.weapons.some((w) => w.projectile?.motion === "bomb"),
    );
    game = Rules.create(
      false,
      1,
      [
        [{ unitId: model.prefabId, kitId: model.kitId }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    const [a, b] = game.units;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 12, y: 10, hp: 100000, shield: 0 });
    const w = Rules.modelOf(a).weapons.find((w) => w.projectile?.motion === "bomb"),
      actors = structuredClone([a, b]),
      events = Rules.fight(game, a, b, { ...w, hit: 0 }, "evade", null, false),
      record = {
        id: "bomb-browser",
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
    setPageView("game");
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const f = MapCombat.frame;
    f.time = f.plan.shots[0].at;
    f.lastNow = performance.now();
    drawMap(performance.now());
    const pose = MapCombat.units().find((u) => u.id === a.id).mapPose,
      shot = f.plan.shots[0];
    const details = {
      model: model.id,
      shots: f.plan.shots.map((s) => ({
        x0: s.origin.x,
        x1: s.destination.x,
        y0: s.origin.y,
        y1: s.destination.y,
        visible: s.visibleUntil,
        impact: s.impactAt,
      })),
      pose: { x: pose.x, y: pose.y },
      origin: shot.origin,
      duration: f.plan.duration,
      miss: events[0].hit === false,
    };
    const returned = WeaponEffects.bombPose(f.plan, f.plan.duration, f.source, f.target);
    details.returned = returned;
    details.source = { x: f.source.x, y: f.source.y };
    const original = CombatPlayback.finish;
    let finished = false;
    CombatPlayback.finish = () => {
      finished = true;
      battleView = null;
      MapCombat.reset();
      phase = "idle";
    };
    try {
      f.time = f.plan.duration + 0.1;
      MapCombat.update(performance.now());
      details.completed = finished;
    } finally {
      CombatPlayback.finish = original;
    }
    return details;
  });
  expect(result.miss).toBe(true);
  expect(result.completed).toBe(true);
  expect(result.duration).toBeLessThan(20);
  for (const s of result.shots) {
    expect(s.x0).toBe(s.x1);
    expect(s.y0).toBeLessThan(s.y1);
    expect(s.visible).toBe(s.impact);
  }
  expect(result.pose.x).toBeCloseTo(result.origin.x, 0);
  expect(result.pose.y).toBeCloseTo(result.origin.y, 0);
  expect(result.returned.x).toBeCloseTo(result.source.x);
  expect(result.returned.y).toBeCloseTo(result.source.y);
  expect(errors).toEqual([]);
});
test("empty mortar cells render as ground impacts and finish the map playback batch", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const result = await page.evaluate(() => {
    Net.leave();
    game = Rules.create(
      false,
      2,
      [[{ unitId: "RGC_80", kitId: "machine_gun" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    const [a, b] = game.units;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 16, y: 10, hp: 100000, shield: 0 });
    let seq = 0;
    const planner = createAttackPlanner(Rules, () => "browser-" + ++seq),
      room = { game, matchId: "browser" };
    planner.reset(room);
    const w = Rules.modelOf(a).weapons.find((w) => w.special?.type === "mortar");
    planner.plan(room, a, b, w, 0);
    for (const r of planner.prepare(room)) planner.choose(room, r.id, "evade");
    const battles = planner.resolve(room),
      view = { battles, completed: false };
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = view;
    phase = "battle";
    setPageView("game");
    MapCombat.begin(view, () => 0);
    const start = performance.now();
    const original = CombatPlayback.finish;
    let finished = false;
    CombatPlayback.finish = () => {
      finished = true;
      battleView = null;
      MapCombat.reset();
      phase = "idle";
    };
    try {
      for (let i = 0; i < 120; i++) {
        MapCombat.update(start + i * 100);
        drawMap(start + i * 100);
        if (finished) break;
      }
    } finally {
      CombatPlayback.finish = original;
    }
    return {
      empty: battles.filter((b) => b.events[0].empty).length,
      count: battles.length,
      units: game.units.length,
      en: a.en,
      expected: Rules.modelOf(a).en - w.en,
      completed: finished,
    };
  });
  expect(result.empty).toBeGreaterThan(0);
  expect(result.count).toBe(3);
  expect(result.units).toBe(2);
  expect(result.en).toBe(result.expected);
  expect(result.completed).toBe(true);
  expect(errors).toEqual([]);
});
