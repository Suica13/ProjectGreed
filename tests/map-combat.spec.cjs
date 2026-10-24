const { test, expect } = require("@playwright/test");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function stage(page, death = false) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await page.evaluate((death) => {
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    Object.assign(a, { x: 10, y: 7, hp: 100000, shield: 0 });
    Object.assign(b, { x: 10, y: 8, hp: death ? 1 : 100000, shield: 0 });
    game.tiles[7][10] = game.tiles[8][10] = "plain";
    game.seed = 0;
    const actors = JSON.parse(JSON.stringify([a, b]));
    const weapon = UnitModels[a.model].weapons.find((w) => w.type === "melee");
    const events = Rules.fight(game, a, b, weapon, death ? "defend" : "counter", weapon.id);
    const record = {
      id: "map-fixture",
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
      networkId: record.id,
      index: 0,
      start: performance.now(),
      displayHp: { ...record.before },
      completed: false,
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
  }, death);
}
async function at(page, value) {
  return page.evaluate((value) => {
    const f = MapCombat.frame;
    f.time =
      value === "electric"
        ? f.plan.deathSoundAt + 0.02
        : value === "explosion"
          ? f.plan.deathAt + 0.02
          : f.plan.lead + value / f.plan.actionSpeed;
    f.lastNow = performance.now();
    drawMap(performance.now());
    return {
      units: MapCombat.units()
        .filter((u) => [f.event.from, f.event.to].includes(u.id))
        .map((u) => ({ id: u.id, x: u.x, y: u.y, hp: u.hp, pose: u.mapPose })),
      source: f.event.from,
      target: f.event.to,
      time: f.time,
      deathAt: f.plan.deathAt,
      events: battleView.events.length,
    };
  }, value);
}
test("map melee approaches vertically, plays the second swing and keeps real grid coordinates", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stage(page);
  const move = await at(page, -0.15);
  const source = move.units.find((u) => u.id === move.source);
  expect(source.pose.x).toBeCloseTo(10.5 * 64);
  expect(source.pose.y).toBeGreaterThan(7.5 * 64);
  expect(source.x).toBe(10);
  expect(source.y).toBe(7);
  const swing = await at(page, 1.3);
  expect(swing.units.find((u) => u.id === swing.source).pose.clip).toBe("Common_Melee_F");
  expect(swing.events).toBe(2);
  await expect(page.locator("#battle")).toBeHidden();
  await page.screenshot({ path: ".openai/map-combat-melee.png" });
  await page.locator("#roomSettings").evaluate(() => {
    setPageView("room");
  });
  const paused = await page.evaluate(() => MapCombat.frame.time);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    setPageView("game");
    MapCombat.resume(battleView);
  });
  expect(await page.evaluate(() => MapCombat.frame.time)).toBeLessThan(paused + 0.15);
  expect(errors).toEqual([]);
});
test("map death keeps the unit during electricity and hides its sprite when the explosion starts", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stage(page, true);
  const electric = await at(page, "electric");
  const target = electric.units.find((u) => u.id === electric.target);
  expect(target.hp).toBe(0);
  expect(target.pose.dying).toBe(true);
  expect(target.pose.keepVisible).toBe(true);
  expect(target.pose.hidden).toBe(false);
  const explosion = await at(page, "explosion");
  expect(explosion.units.find((u) => u.id === explosion.target).pose.hidden).toBe(true);
  await page.screenshot({ path: ".openai/map-combat-death.png" });
  expect(errors).toEqual([]);
});

test("parallel attacks draw each unit once and merge damage and shield loss into one displayed state", async ({
  page,
}) => {
  await stage(page);
  const result = await page.evaluate(() => {
    const attackers = game.units.filter((u) => u.team === 0),
      target = game.units.find((u) => u.team === 1);
    game.winner = null;
    game.seed = 42;
    Object.assign(target, { x: 10, y: 8, hp: 100000, shield: 5000 });
    const battles = [];
    attackers.forEach((unit, index) => {
      Object.assign(unit, { x: 6, y: 7 + index, hp: 100000, en: 100, acted: false });
      game.tiles[unit.y][unit.x] = "plain";
      const weapon = UnitModels[unit.model].weapons.find((w) => w.type !== "melee");
      const actors = JSON.parse(JSON.stringify([unit, target]));
      const events = Rules.fight(game, unit, target, weapon, "defend");
      battles.push({
        id: "parallel" + index,
        a: unit.id,
        b: target.id,
        actors,
        events,
        before: { [unit.id]: unit.hp, [target.id]: actors[1].hp },
      });
    });
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      networkId: "parallel",
      battles,
      a: battles[0].a,
      b: target.id,
      actors: battles.flatMap((b) => b.actors),
      events: battles.flatMap((b) => b.events),
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    for (const f of MapCombat.frames) {
      f.time = f.plan.impacts[0] + 0.01;
      f.lastNow = performance.now();
    }
    const expectedHp =
      100000 -
      MapCombat.frames.reduce(
        (sum, f) =>
          sum + WeaponEffects.arrived(f.plan, f.time).reduce((sum, c) => sum + c.damage, 0),
        0,
      );
    const expectedShield =
      5000 -
      MapCombat.frames.reduce(
        (sum, f) =>
          sum +
          WeaponEffects.arrived(f.plan, f.time).reduce((sum, c) => sum + (c.shieldDamage || 0), 0),
        0,
      );
    let draws = 0;
    const original = SpriteRenderer.draw;
    SpriteRenderer.draw = function (...args) {
      draws++;
      return original(...args);
    };
    drawMap(performance.now());
    SpriteRenderer.draw = original;
    const visual = MapCombat.units().find((u) => u.id === target.id);
    return {
      frames: MapCombat.frames.length,
      draws,
      units: game.units.length,
      hp: visual.hp,
      shield: visual.shield,
      expectedHp,
      expectedShield,
    };
  });
  expect(result.frames).toBe(3);
  expect(result.draws).toBe(result.units);
  expect(result.hp).toBe(result.expectedHp);
  expect(result.shield).toBe(result.expectedShield);
});

test("repeated simultaneous dodges draw one boost at the actual visible unit pose", async ({
  page,
}) => {
  await stage(page);
  const samples = await page.evaluate(() => {
    game.winner = null;
    game.seed = 1;
    const attackers = game.units.filter((u) => u.team === 0).slice(0, 2),
      target = game.units.find((u) => u.team === 1),
      battles = [];
    Object.assign(target, { model: "RGM_79__machine_gun", x: 12, y: 8, hp: 100000, shield: 0 });
    for (const [index, unit] of attackers.entries()) {
      Object.assign(unit, {
        model: "RGM_79__machine_gun",
        x: 9,
        y: 7 + index,
        hp: 100000,
        en: 100,
        acted: false,
      });
      const weapon = getWeapon(unit, "EF_90mmMG"),
        actors = structuredClone([unit, target]);
      const event = Rules.fight(game, unit, target, { ...weapon, hit: 0 }, "evade")[0];
      event.targetDodgeSlot = index;
      battles.push({
        id: "boost-" + index,
        a: unit.id,
        b: target.id,
        actors,
        events: [event],
        before: { [unit.id]: unit.hp, [target.id]: target.hp },
      });
    }
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      networkId: "boosts",
      battles,
      a: battles[0].a,
      b: target.id,
      actors: battles.flatMap((b) => b.actors),
      events: battles.flatMap((b) => b.events),
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const original = SpriteEffects.boostStart,
      result = [];
    try {
      for (const index of [0, 1, 2]) {
        for (const f of MapCombat.frames) {
          f.time = f.plan.impacts[index] + 0.03;
          f.lastNow = performance.now();
        }
        const calls = [];
        SpriteEffects.boostStart = function (ctx, unit, x, y, scale, time, angle) {
          if (unit.id === target.id) calls.push({ x, y, time, angle });
          return original(...arguments);
        };
        drawMap(performance.now());
        const pose = MapCombat.units().find((u) => u.id === target.id).mapPose;
        result.push({ calls, pose });
      }
    } finally {
      SpriteEffects.boostStart = original;
    }
    return result;
  });
  for (const { calls, pose } of samples) {
    expect(calls).toHaveLength(1);
    expect(calls[0].x).toBeCloseTo(pose.x, 6);
    expect(calls[0].y).toBeCloseTo(pose.y, 6);
    expect(calls[0].time).toBeCloseTo(pose.dodge.time, 6);
    expect(calls[0].angle).toBe(pose.angle);
  }
});

test("a later lethal volley waits for an earlier authoritative counter before displaying death", async ({
  page,
}) => {
  await stage(page);
  const result = await page.evaluate(() => {
    game.winner = null;
    game.seed = 1;
    const [a, other] = game.units.filter((u) => u.team === 0),
      target = game.units.find((u) => u.team === 1);
    Object.assign(a, {
      model: "RGM_79__machine_gun",
      x: 8,
      y: 8,
      hp: 100000,
      shield: 0,
      en: 100,
      acted: false,
    });
    Object.assign(other, {
      model: "RGM_79__beam_spray",
      x: 9,
      y: 7,
      hp: 100000,
      shield: 0,
      en: 100,
      acted: false,
    });
    Object.assign(target, {
      model: "RGM_79__machine_gun",
      x: 10,
      y: 8,
      hp: 6000,
      shield: 0,
      en: 100,
      counterCount: 0,
    });
    for (const row of game.tiles) row.fill("plain");
    const battles = [];
    for (const [index, unit] of [a, other].entries()) {
      const actors = structuredClone([unit, target]),
        before = Object.fromEntries(actors.map((u) => [u.id, u.hp]));
      const events = Rules.fight(
        game,
        unit,
        target,
        // Isolate death ordering; part-damage counter cancellation has its own coverage.
        {
          ...UnitModels[unit.model].weapons[0],
          attack: {
            ...UnitModels[unit.model].weapons[0].attack,
            strikes: UnitModels[unit.model].weapons[0].attack.strikes.map((s) => ({
              ...s,
              partBreakModifier: 0,
            })),
          },
        },
        "counter",
        "EF_90mmMG",
        index === 0,
      );
      battles.push({ id: "fatal-" + index, a: unit.id, b: target.id, actors, before, events });
    }
    const independent = game.units.filter((u) => u.team === 0)[2],
      independentTarget = game.units.filter((u) => u.team === 1)[1];
    Object.assign(independent, {
      model: "RGM_79__machine_gun",
      x: 8,
      y: 13,
      hp: 100000,
      en: 100,
      acted: false,
    });
    Object.assign(independentTarget, { x: 10, y: 13, hp: 100000, shield: 0 });
    const independentActors = structuredClone([independent, independentTarget]);
    battles.push({
      id: "unrelated",
      a: independent.id,
      b: independentTarget.id,
      actors: independentActors,
      before: Object.fromEntries(independentActors.map((u) => [u.id, u.hp])),
      events: Rules.fight(
        game,
        independent,
        independentTarget,
        UnitModels[independent.model].weapons[0],
        "defend",
      ),
    });
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      networkId: "fatal",
      battles,
      a: a.id,
      b: target.id,
      actors: battles.flatMap((b) => b.actors),
      events: battles.flatMap((b) => b.events),
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const initialFrames = MapCombat.frames.length;
    let f = MapCombat.frames[0];
    f.time = f.plan.duration;
    f.lastNow = performance.now();
    MapCombat.update(performance.now());
    MapCombat.update(performance.now());
    f = MapCombat.frames.find((f) => f.event.from === target.id);
    const counterExists = !!f;
    f.time = f.plan.shots[0].at + 0.02;
    f.lastNow = performance.now();
    drawMap(performance.now());
    const counterHp = MapCombat.units().find((u) => u.id === target.id).hp;
    const counterHidden = !!MapCombat.units().find((u) => u.id === target.id).mapPose?.hidden;
    f.time = f.plan.duration;
    f.lastNow = performance.now();
    MapCombat.update(performance.now());
    MapCombat.update(performance.now());
    const lethal = MapCombat.frames.find((f) => f.event.from === other.id);
    lethal.time = lethal.plan.deathAt + 0.02;
    lethal.lastNow = performance.now();
    const fired = [],
      original = WeaponEffects.draw;
    try {
      WeaponEffects.draw = function (ctx, weapon, plan, time, source) {
        fired.push(source.unit.id);
        return original(...arguments);
      };
      drawMap(performance.now());
    } finally {
      WeaponEffects.draw = original;
    }
    const dead = MapCombat.units().find((u) => u.id === target.id);
    return {
      initialFrames,
      counterExists,
      counterHp,
      counterHidden,
      deadHp: dead.hp,
      hidden: dead.mapPose.hidden,
      fired,
      target: target.id,
      eventCounts: battles.map((b) => b.events.length),
      finalHp: target.hp,
      counterCount: target.counterCount,
    };
  });
  expect(result.eventCounts).toEqual([2, 1, 1]);
  expect(result.finalHp).toBe(0);
  expect(result.counterCount).toBe(1);
  expect(result.initialFrames).toBe(2);
  expect(result.counterExists).toBe(true);
  expect(result.counterHp).toBeGreaterThan(0);
  expect(result.counterHidden).toBe(false);
  expect(result.deadHp).toBe(0);
  expect(result.hidden).toBe(true);
  expect(result.fired).not.toContain(result.target);
});

test("the last of four battles finishes automatically after a vertical cannon Miss leaves the map", async ({
  page,
}) => {
  await stage(page);
  const result = await page.evaluate(() => {
    const entry = { unitId: "RGC_80", kitId: "machine_gun" },
      enemy = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(
      false,
      1,
      [Array(4).fill(entry), Array(4).fill(enemy), null, null, null, null],
      false,
      { mapId: "frontline_3v3" },
    );
    for (const row of game.tiles) row.fill("plain");
    const attackers = game.units.filter((u) => u.team === 0),
      targets = game.units.filter((u) => u.team === 1),
      battles = [];
    for (const [index, a] of attackers.entries()) {
      const b = targets[index];
      Object.assign(a, { x: index ? 4 : 10, y: index ? 16 + index * 3 : 5, en: 100 });
      Object.assign(b, {
        x: index ? 8 : 10,
        y: index ? 16 + index * 3 : 13,
        hp: 100000,
        shield: 0,
      });
      const actors = structuredClone([a, b]),
        before = Object.fromEntries(actors.map((u) => [u.id, u.hp])),
        weapon = getWeapon(a, "Common_Cannon"),
        events = Rules.fight(game, a, b, { ...weapon, hit: 0 }, "evade");
      battles.push({ id: "exit-" + index, a: a.id, b: b.id, actors, before, events });
    }
    const authoritative = JSON.stringify(game);
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      networkId: "four",
      battles,
      a: battles[0].a,
      b: battles[0].b,
      actors: battles.flatMap((b) => b.actors),
      events: battles.flatMap((b) => b.events),
    };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    const start = performance.now();
    MapCombat.update(start);
    const lastPlanDuration = MapCombat.frames[0].plan.duration;
    for (const f of MapCombat.frames.slice(1)) f.time = f.plan.duration;
    MapCombat.update(start + 1);
    const remaining = byId("mapCombatStatus").textContent;
    let finished = 0;
    const original = CombatPlayback.finish;
    try {
      CombatPlayback.finish = () => {
        finished++;
        battleView = null;
        MapCombat.reset();
        phase = "idle";
      };
      for (let elapsed = 100; elapsed <= 10000 && battleView; elapsed += 100)
        MapCombat.update(start + elapsed);
    } finally {
      CombatPlayback.finish = original;
    }
    return {
      remaining,
      finished,
      lastPlanDuration,
      controlsHidden: byId("mapCombatControls").hidden,
      stateUnchanged: JSON.stringify(game) === authoritative,
    };
  });
  expect(result.remaining).toContain("1/4");
  expect(result.lastPlanDuration).toBeLessThan(10);
  expect(result.finished).toBe(1);
  expect(result.controlsHidden).toBe(true);
  expect(result.stateUnchanged).toBe(true);
});

test("each attacking and countering unit gets its own delay, preserved across pause and resume", async ({
  page,
}) => {
  await stage(page);
  const result = await page.evaluate(() => {
    game.winner = null;
    const [a, other] = game.units.filter((u) => u.team === 0),
      [target, otherTarget] = game.units.filter((u) => u.team === 1);
    for (const unit of [a, other, target, otherTarget])
      Object.assign(unit, {
        model: "RGM_79__machine_gun",
        hp: 100000,
        shield: 0,
        en: 100,
        acted: false,
        counterCount: 0,
      });
    Object.assign(a, { x: 8, y: 8 });
    Object.assign(target, { x: 10, y: 8 });
    Object.assign(other, { x: 8, y: 14 });
    Object.assign(otherTarget, { x: 10, y: 14 });
    for (const row of game.tiles) row.fill("plain");
    const battles = [];
    for (const [from, to, stance] of [
      [a, target, "counter"],
      [other, otherTarget, "evade"],
    ]) {
      const actors = structuredClone([from, to]),
        before = Object.fromEntries(actors.map((u) => [u.id, u.hp]));
      const weapon = getWeapon(from, "EF_90mmMG"),
        events = Rules.fight(game, from, to, { ...weapon, hit: 0 }, stance, weapon.id);
      battles.push({ id: "delay-" + from.id, a: from.id, b: to.id, actors, before, events });
    }
    const before = JSON.stringify(game),
      originalNow = performance.now.bind(performance);
    let clock = 10000,
      draws = 0;
    const values = [0.2, 0.8, 0.5],
      checkpoints = [];
    try {
      performance.now = () => clock;
      MapCombat.reset();
      MapCombat.seed(battles);
      battleView = {
        networkId: "stagger",
        battles,
        a: a.id,
        b: target.id,
        actors: battles.flatMap((b) => b.actors),
        events: battles.flatMap((b) => b.events),
      };
      phase = "battle";
      MapCombat.begin(battleView, () => values[draws++]);
      const step = (value) => {
        clock = value;
        MapCombat.update(clock);
        return MapCombat.frames.map((f) => f.event.from);
      };
      checkpoints.push(step(10000));
      checkpoints.push(step(10199));
      checkpoints.push(step(10201));
      step(10250);
      const pausedTime = MapCombat.frames.find((f) => f.event.from === a.id).time;
      MapCombat.suspend(battleView);
      step(15250);
      const timeDuringPause = MapCombat.frames.find((f) => f.event.from === a.id).time;
      MapCombat.resume(battleView);
      checkpoints.push(step(15490));
      checkpoints.push(step(15510));
      const primary = MapCombat.frames.find((f) => f.event.from === a.id);
      primary.time = primary.plan.duration;
      primary.lastNow = clock;
      MapCombat.update(clock);
      checkpoints.push(step(clock + 799));
      checkpoints.push(step(clock + 2));
      return {
        checkpoints,
        ids: { a: a.id, other: other.id, counter: target.id },
        draws,
        pausedTime,
        timeDuringPause,
        unchanged: JSON.stringify(game) === before,
        eventCounts: battles.map((b) => b.events.length),
      };
    } finally {
      performance.now = originalNow;
      MapCombat.reset();
      battleView = null;
      phase = "idle";
    }
  });
  expect(result.eventCounts).toEqual([2, 1]);
  expect(result.draws).toBe(3);
  expect(result.checkpoints[0]).toEqual([]);
  expect(result.checkpoints[1]).toEqual([]);
  expect(result.checkpoints[2]).toEqual([result.ids.a]);
  expect(result.checkpoints[3]).toEqual([result.ids.a]);
  expect(result.checkpoints[4]).toEqual([result.ids.a, result.ids.other]);
  expect(result.checkpoints[5]).not.toContain(result.ids.counter);
  expect(result.checkpoints[6]).toContain(result.ids.counter);
  expect(result.timeDuringPause).toBe(result.pausedTime);
  expect(result.unchanged).toBe(true);
});
