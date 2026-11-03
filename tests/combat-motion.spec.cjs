const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(async () => {
    Net.leave();
    session++;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    game.tiles.forEach((row) => row.fill("plain"));
    game.units.forEach((unit, index) =>
      Object.assign(unit, { x: 5 + index, y: 5, hp: 1000000, en: 10000, shield: 0 }),
    );
    game.deployment = null;
    phase = "idle";
    moving = battleView = pending = null;
    await SpriteRenderer.ensureModels(game.units.map((unit) => unit.model));
    setPageView("game");
    update();
  });
}

test("counterfire retains distinct squad slots even when the final snapshot has killed every member", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units;
    const defenders = [
      b,
      ...[1, 2].map((i) => ({ ...structuredClone(b), id: "dead-counter-" + i })),
    ];
    defenders.forEach((u, i) => Object.assign(u, { squadId: "counter-squad", squadSlot: i }));
    game.units.push(...defenders.slice(1));
    const room = { game };
    let sequence = 0;
    const planner = createAttackPlanner(Rules, () => "counter-spacing-" + ++sequence);
    planner.reset(room);
    planner.plan(room, a, b, null, 0, "shooting");
    planner.prepare(room);
    planner.choose(
      room,
      room.pending.id,
      "counter",
      [],
      a.id,
      defenders.map((unit) => ({
        unitId: unit.id,
        response: "counter",
        counterTargetId: a.id,
      })),
    );
    const battles = planner.resolve(room);
    defenders.forEach((u) => {
      u.hp = 0;
    });
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      battles,
      actors: battles.flatMap((battle) => battle.actors),
      index: 0,
      completed: false,
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    const start = performance.now();
    MapCombat.update(start);
    const initial = defenders.map((u) => MapCombat.formationOffset(u));
    const rate = MovementTiming.combatRate(false, false);
    let sources = [];
    for (let time = 0.02; time < 20; time += 0.02) {
      MapCombat.update(start + (time * 1000) / rate);
      const counters = MapCombat.frames.filter((frame) =>
        defenders.some((u) => u.id === frame.source.unit.id),
      );
      if (counters.length === 3) {
        sources = counters.map((frame) => ({
          id: frame.source.unit.id,
          x: frame.source.x,
          y: frame.source.y,
        }));
        break;
      }
    }
    return { initial, sources, final: defenders.map((u) => MapCombat.formationOffset(u)) };
  });
  expect(new Set(result.initial.map((p) => `${p.x}:${p.y}`)).size).toBe(3);
  expect(result.sources).toHaveLength(3);
  expect(new Set(result.sources.map((p) => `${p.x}:${p.y}`)).size).toBe(3);
  expect(result.final).toEqual(result.initial);
});

test("opening volleys start on the first visible frame, excluding loading time", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units,
      room = { game };
    let sequence = 0;
    const planner = createAttackPlanner(Rules, () => "clock-" + ++sequence);
    planner.reset(room);
    planner.plan(room, a, b, null, 0, "shooting");
    planner.prepare(room);
    planner.choose(room, room.pending.id, "counter");
    const battles = planner.resolve(room);
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      battles,
      actors: battles.flatMap((battle) => battle.actors),
      index: 0,
      completed: false,
    };
    phase = "battle";
    MapCombat.begin(battleView);
    const first = performance.now() + 5000,
      rate = MovementTiming.combatRate(false, false);
    MapCombat.update(first);
    const opening = MapCombat.frames.map((frame) => frame.time);
    MapCombat.update(first + 32);
    const played = MapCombat.frames[0].time;
    const assets = globalThis.BattleAssets;
    try {
      globalThis.BattleAssets = { loading: true };
      MapCombat.update(first + 6000);
      globalThis.BattleAssets = { loading: false };
      MapCombat.update(first + 9000);
    } finally {
      globalThis.BattleAssets = assets;
    }
    return { opening, played, resumed: MapCombat.frames[0].time, expected: 0.032 * rate };
  });
  expect(result.opening.length).toBeGreaterThan(0);
  expect(result.opening.every((time) => time === 0)).toBe(true);
  expect(result.played).toBeCloseTo(result.expected, 6);
  expect(result.resumed).toBeCloseTo(result.played, 6);
});

test("consecutive dodges share a curved trajectory with continuous position and velocity", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const [from, to] = game.units,
      native = Rules.modelOf(from).weapons.find((weapon) => weapon.type !== "melee");
    const weapon = {
      ...native,
      attack: {
        ...native.attack,
        shots: [0, 0.45, 0.9, 1.35],
        strikes: [0, 1, 2, 3].map((index) => ({
          ...native.attack.strikes[0],
          at: index * 0.45,
          shotIndex: index,
          hitIndex: index,
        })),
        muzzleIndices: [0, 0, 0, 0],
        muzzleShotIndices: [0, 1, 2, 3],
      },
    };
    const actors = [from, to].map((unit, index) => ({
      unit,
      x: 100 + index * 200,
      y: 100,
      scale: 1,
      angle: 90,
      arenaWidth: 2000,
      arenaHeight: 2000,
    }));
    const event = {
      from: from.id,
      to: to.id,
      weapon: native.id,
      hit: false,
      before: to.hp,
      after: to.hp,
      targetDodgeSlot: 0,
      strikes: [0, 1, 2, 3].map((index) => ({
        shotIndex: index,
        hitIndex: index,
        executed: true,
        hit: false,
        damage: 0,
      })),
    };
    const track = { moves: [], initialSlot: 0 };
    const first = WeaponEffects.plan(weapon, ...actors, event, { start: 0, track });
    const second = WeaponEffects.plan(weapon, ...actors, event, { start: 0.25, track });
    let positionGap = 0,
      velocityGap = 0,
      curve = 0,
      sharedGap = 0;
    for (const move of track.moves) {
      const before = WeaponEffects.dodgeOffset(first, move.at - 0.0001),
        after = WeaponEffects.dodgeOffset(first, move.at + 0.0001);
      positionGap = Math.max(positionGap, Math.hypot(after.x - before.x, after.y - before.y));
      velocityGap = Math.max(velocityGap, Math.hypot(after.vx - before.vx, after.vy - before.vy));
      curve = Math.max(
        curve,
        Math.abs(WeaponEffects.dodgeOffset(first, move.at + move.duration / 2).x),
      );
    }
    for (let time = 0.25; time < 2; time += 0.013) {
      const a = WeaponEffects.dodgeOffset(first, time),
        b = WeaponEffects.dodgeOffset(second, time - 0.25);
      sharedGap = Math.max(sharedGap, Math.hypot(a.x - b.x, a.y - b.y));
    }
    return {
      moves: track.moves.length,
      positionGap,
      velocityGap,
      curve,
      sharedGap,
      endpoints: track.moves.map((move) => move.to),
      hp: to.hp,
    };
  });
  expect(result.moves).toBeGreaterThan(2);
  expect(result.positionGap).toBeLessThan(0.005);
  expect(result.velocityGap).toBeLessThan(0.03);
  expect(result.curve).toBeGreaterThan(0.1);
  expect(result.sharedGap).toBeLessThan(0.000001);
  expect(result.endpoints.every((value) => Math.abs(value) >= 0.7)).toBe(true);
  expect(result.hp).toBe(1000000);
});

test("overlapping firing lanes never snap a dodging unit back to another lane's pose", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const [source, target] = game.units,
      weapon = Rules.modelOf(source).weapons.find((item) => item.type !== "melee");
    const battles = [0, 0.42, 0.84].map((start, index) => {
      const event = {
        from: source.id,
        to: target.id,
        weapon: weapon.id,
        hit: false,
        damage: 0,
        before: target.hp,
        after: target.hp,
        crossfire: true,
        timelineStart: start,
        fireAt: start,
        impactAt: start + 0.2,
        shotTimings: weapon.attack.shots.map(() => ({ fireAt: start, impactAt: start + 0.2 })),
        strikes: weapon.attack.strikes.map((strike) => ({
          ...strike,
          hit: false,
          damage: 0,
          executed: strike.shotIndex === 0,
        })),
      };
      return {
        id: "dodge-lane-" + index,
        a: source.id,
        b: target.id,
        actors: structuredClone([source, target]),
        events: [event],
        before: { [source.id]: source.hp, [target.id]: target.hp },
        crossfire: true,
        timelineStart: start,
      };
    });
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      battles,
      actors: battles.flatMap((battle) => battle.actors),
      index: 0,
      completed: false,
    };
    phase = "battle";
    MapCombat.begin(battleView);
    const zero = performance.now(),
      rate = MovementTiming.combatRate(false, false);
    let previous = null,
      maxJump = 0,
      active = 0;
    for (let elapsed = 0; elapsed < 1.8; elapsed += 0.01) {
      MapCombat.update(zero + (elapsed * 1000) / rate);
      const pose = MapCombat.units().find((unit) => unit.id === target.id).mapPose;
      if (previous)
        maxJump = Math.max(maxJump, Math.hypot(pose.x - previous.x, pose.y - previous.y));
      previous = pose;
      if (pose.dodge?.active) active++;
    }
    return { maxJump, active, x: target.x, y: target.y, hp: target.hp };
  });
  expect(result.maxJump).toBeLessThan(5);
  expect(result.active).toBeGreaterThan(30);
  expect(result).toMatchObject({ x: 6, y: 5, hp: 1000000 });
});

test("incoming turns survive old volley completion and match authority after playback", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units;
    const c = { ...structuredClone(a), id: "north-attacker", x: b.x, y: b.y - 1 };
    game.units.push(c);
    const weapon = Rules.modelOf(a).weapons.find(w => w.type !== "melee");
    const battles = [a, c].map((source, index) => ({
      id: "turn-" + index, a: source.id, b: b.id,
      actors: structuredClone([source, b]), before: { [source.id]: source.hp, [b.id]: b.hp },
      crossfire: true, timelineStart: index * 0.1,
      events: [{ from: source.id, to: b.id, weapon: weapon.id, hit: false, damage: 0,
        before: b.hp, after: b.hp, crossfire: true, timelineStart: index * 0.1,
        fireAt: index * 0.1, impactAt: index * 0.1 + (index ? 0.1 : 1.5),
        strikes: weapon.attack.strikes.map(strike => ({ ...strike, hit: false, damage: 0, executed: true })) }],
    }));
    Rules.faceTarget(b, c);
    MapCombat.reset(); MapCombat.seed(battles);
    battleView = { battles, index: 0, completed: false };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    const start = performance.now(), rate = MovementTiming.combatRate(false, false);
    const angles = [];
    for (let time = 0; time < 5 && battleView; time += 0.02) {
      MapCombat.update(start + time * 1000 / rate);
      if (time >= 0.12 && battleView)
        angles.push(MapCombat.units().find(u => u.id === b.id).mapPose?.angle);
    }
    return { angles, final: b.angle };
  });
  expect(result.angles.length).toBeGreaterThan(10);
  expect(result.angles.every(angle => angle === 0)).toBe(true);
  expect(result.final).toBe(0);
});

test("map labels show custom and ACE names but hide generated pilot names", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units;
    const c = { ...structuredClone(a), id: "ace-label", x: 7 };
    game.units.push(c);
    a.pilot = { ...a.pilot, name: "GENERATED_HIDDEN", custom: false };
    b.pilot = { ...b.pilot, name: "CUSTOM_VISIBLE", custom: true };
    c.pilot = { ...c.pilot, name: "ACE_VISIBLE", custom: true, aceId: "amuro" };
    MapCamera.reset();
    MapCamera.setZoom(4);
    MapCamera.focus(6, 5, { preserveZoom: true });
    const labels = [], original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      labels.push(text); return original.call(this, text, ...args);
    };
    try { drawMap(performance.now()); } finally { CanvasRenderingContext2D.prototype.fillText = original; }
    return labels;
  });
  expect(result).not.toContain("GENERATED_HIDDEN");
  expect(result).toContain("CUSTOM_VISIBLE");
  expect(result).toContain("ACE_VISIBLE");
});
