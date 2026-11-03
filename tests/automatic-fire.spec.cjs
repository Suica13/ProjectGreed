const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    Net.leave();
    session++;
    game = Rules.create(
      false,
      1,
      [[{ unitId: "RGM_79", kitId: "machine_gun" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { fogMode: "disabled" },
    );
    game.tiles.forEach((row) => row.fill("plain"));
    game.deployment = null;
    game.units.forEach((u, i) =>
      Object.assign(u, { x: 8 + i, y: 7, hp: 100000, en: 10000, shield: 0, actionPoints: 10 }),
    );
    phase = "idle";
    pending = null;
    selected = game.units[0].id;
    battleView = null;
    mode = "select";
    setPageView("game");
    update();
  });
}
test("attack UI lists automatic weapons without manual controls", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(() => {
    AttackControls.choose(game.units[0], game.units[1]);
    update();
  });
  await expect(page.locator("#attackEditor")).toBeVisible();
  await expect(page.locator("#confirmAttackQueue")).toBeEnabled();
  expect(await page.locator("#attackEditor .weapon").count()).toBeGreaterThan(0);
  await expect(page.locator("#attackEditor .weapon-rounds").first()).toBeVisible();
  await expect(page.locator("#attackEditor .weapon-rounds").first()).toHaveText("2");
  await page.evaluate(() => {
    game.units[0].forcedExitRound = game.round;
    AttackControls.reset();
    AttackControls.choose(game.units[0], game.units[1]);
    update();
  });
  await expect(page.locator("#attackEditor .weapon-rounds").first()).toHaveText("1");
  expect(await page.locator("#attackEditor button.weapon").count()).toBe(0);
  expect(
    await page.locator("#changeAttackTarget,#clearAttackQueue,#autoAttackToggle").count(),
  ).toBe(0);
  expect(
    await page.locator("#attackEditor .fire-plan-controls, #attackEditor select").count(),
  ).toBe(0);
  expect(errors).toEqual([]);
});
test("alternating playback follows server timestamps and groups native bullets", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units,
      room = { game, matchId: "crossfire-browser" };
    let sequence = 0;
    const planner = createAttackPlanner(Rules, () => String(++sequence));
    planner.reset(room);
    planner.plan(room, a, b, null, 0);
    planner.prepare(room);
    planner.choose(room, room.pending.id, "counter", [], a.id);
    const battles = planner.resolve(room);
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      a: a.id,
      b: b.id,
      battles,
      actors: battles.flatMap((b) => b.actors),
      events: battles.flatMap((b) => b.events),
      completed: false,
      index: 0,
      displayHp: { [a.id]: 100000, [b.id]: 100000 },
      start: performance.now(),
    };
    phase = "battle";
    const start = performance.now();
    MapCombat.begin(battleView, () => 0.99);
    MapCombat.update(start);
    const rate = MovementTiming.combatRate(false, false);
    MapCombat.update(start + 1200 / rate);
    const frames = MapCombat.frames;
    return {
      events: battles.length,
      active: frames.length,
      sources: [...new Set(frames.map((f) => f.event.from))],
      consistent: frames.every((f) =>
        f.plan.shots.every(
          (shot, i) =>
            Math.abs(shot.at - (f.event.shotTimings[i].fireAt - f.event.timelineStart)) < 1e-8 &&
            Math.abs(shot.impactAt - (f.event.shotTimings[i].impactAt - f.event.timelineStart)) <
              1e-8,
        ),
      ),
      contacts: frames.every((f) =>
        f.plan.contacts.every((c) => Math.abs(c.at - f.plan.shots[c.shotIndex].impactAt) < 1e-8),
      ),
      hp: MapCombat.units().map((u) => u.hp),
    };
  });
  expect(result.events).toBeLessThan(20);
  expect(result.active).toBeGreaterThan(0);
  expect(result.sources).toHaveLength(1);
  expect(result.consistent).toBe(true);
  expect(result.contacts).toBe(true);
  expect(result.hp.every((hp) => hp <= 100000)).toBe(true);
  expect(errors).toEqual([]);
});

test("melee starts after ranged fire and remains engaged through the defender reply", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units;
    for (const unit of [a, b])
      Rules.models[unit.model] = {
        ...Rules.models[unit.model],
        partsBreakable: false,
        weapons: Rules.models[unit.model].weapons.filter(
          (w) => w.id === "EF_90mmMG" || w.id === "EF_BeamSaber_A",
        ),
      };
    const model = Rules.modelOf(a),
      gun = model.weapons.find((w) => w.type !== "melee"),
      sword = model.weapons.find((w) => w.type === "melee" && !/^Common_Push/.test(w.id));
    a.actionPoints = 20;
    b.counterActionPoints = 20;
    const room = { game, matchId: "mixed-motion" };
    let id = 0;
    const planner = createAttackPlanner(Rules, () => String(++id));
    planner.reset(room);
    planner.plan(room, a, b, null, 0, "melee");
    const [request] = planner.prepare(room);
    planner.choose(room, request.id, "counter", [], a.id);
    const battles = planner.resolve(room),
      pair = battles.find((b) => b.meleeExchange).meleeExchange;
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = {
      a: a.id,
      b: b.id,
      battles,
      actors: battles.flatMap((b) => b.actors),
      events: battles.flatMap((b) => b.events),
      index: 0,
      completed: false,
    };
    phase = "battle";
    const finish = CombatPlayback.finish;
    let done = false;
    CombatPlayback.finish = () => {
      done = true;
    };
    const zero = performance.now();
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(zero);
    const rate = MovementTiming.combatRate(false, false);
    const sample = (time) => {
      MapCombat.update(zero + (time * 1000) / rate);
      const unit = MapCombat.units().find((u) => u.id === a.id);
      return unit?.mapPose?.x ?? (Rules.center(a).x + 0.5) * Rules.mapCellPixels;
    };
    const approach = sample(pair.start + 0.15),
      engaged = sample(pair.start + pair.approach + 0.05),
      replyPosition = sample(
        battles.find((b) => b.combatStage === "counter" && b.events[0].type === "melee").events[0]
          .fireAt + 0.01,
      ),
      retreat = sample(pair.end - 0.15),
      returned = sample(pair.end + 0.02);
    sample(
      Math.max(
        ...battles.map((b) => b.events[0].impactAt),
        ...battles.filter((b) => b.meleeExchange).map((b) => b.meleeExchange.end),
      ) + 20,
    );
    CombatPlayback.finish = finish;
    MapCombat.reset();
    battleView = null;
    phase = "idle";
    return {
      approach,
      engaged,
      retreat,
      replyPosition,
      returned,
      origin: (Rules.center(a).x + 0.5) * Rules.mapCellPixels,
      roles: battles.map((b) => b.combatStage),
      weapons: battles.map((b) => b.events[0].weapon),
      gun: gun.id,
      sword: sword.id,
      initiator: pair.attacker,
      defender: a.id,
      done,
    };
  });
  expect(result.roles).toEqual(["attack", "counter", "attack", "counter", "attack", "counter"]);
  expect(result.weapons).toEqual([
    result.gun,
    result.gun,
    result.gun,
    result.gun,
    result.sword,
    result.sword,
  ]);
  expect(result.initiator).toBe(result.defender);
  expect(result.approach).toBeGreaterThan(result.origin);
  expect(result.engaged).toBeGreaterThan(result.approach);
  expect(result.replyPosition).toBeCloseTo(result.engaged);
  expect(result.retreat).toBeLessThan(result.engaged);
  expect(result.returned).toBeCloseTo(result.origin);
  expect(result.done).toBe(true);
  expect(errors).toEqual([]);
});
