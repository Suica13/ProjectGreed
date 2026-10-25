const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  { createAttackPlanner } = require("../shared/attack-plans");
function fixture() {
  const game = G.create(
    false,
    1,
    [[{ unitId: "RX_78NT_1", kitId: "kit_1" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
    false,
    { costLimit: 99999, unitCostLimit: 10000 },
  );
  game.tiles.forEach((r) => r.fill("plain"));
  const [a, b] = game.units;
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 12, y: 10, hp: 1000000, shield: 0 });
  let id = 0;
  const planner = createAttackPlanner(G, () => String(++id)),
    room = { game, matchId: "ap" };
  planner.reset(room);
  const m = G.modelOf(a),
    queue = ["EF_RX_78NT_1_BR", "Common_ArmMG", "Common_DoubleVulcan_MS"].map((id) =>
      m.weapons.find((w) => w.id === id),
    );
  return { game, a, b, queue, planner, room };
}
test("catalog defaults to five AP and published weapon class prices are deterministic", () => {
  for (const m of Object.values(G.models)) {
    assert.equal(m.actionPoints, 5);
    for (const w of m.weapons) {
      assert.ok(Number.isInteger(w.actionCost));
      if (w.slot === "skill") continue;
      if (m.ship) assert.equal(w.actionCost, w.category === "missile" ? 2 : 3);
      else if (w.id === "Common_DoubleVulcan_MS") assert.equal(w.actionCost, 1);
    }
  }
  const { queue } = fixture();
  assert.deepEqual(
    queue.map((w) => w.actionCost),
    [2, 2, 1],
  );
  assert.equal(G.models.RGM_79__machine_gun.weapons[0].actionCost, 3);
  assert.equal(G.models.RGM_79__bazooka.weapons[0].actionCost, 2);
});
test("one target accepts an ordered five-point queue, reserves AP once and refunds replacements and cancellation", () => {
  const { a, b, queue, planner, room } = fixture(),
    en = a.en;
  planner.plan(room, a, b, queue, 0);
  assert.equal(a.actionPoints, 0);
  assert.equal(a.en, en);
  assert.deepEqual(
    a.plan.weapons,
    queue.map((w) => w.id),
  );
  assert.equal(room.plans.length, 1);
  planner.plan(room, a, b, [queue[2]], 0);
  assert.equal(a.actionPoints, 4);
  assert.equal(room.plans.length, 1);
  planner.cancel(room, a);
  assert.equal(a.actionPoints, 5);
  assert.equal(a.acted, false);
});
test("over-budget, invalid range and combined EN failures are atomic", () => {
  const { a, b, queue, planner, room } = fixture();
  const attempts = [
    [queue[0], queue[0], queue[0]],
    [...queue, { ...queue[0], id: "extra", actionCost: 2 }],
    [],
  ];
  for (const list of attempts) {
    assert.throws(() => planner.plan(room, a, b, list, 0));
    assert.equal(a.actionPoints, 5);
    assert.equal(room.plans.length, 0);
  }
  a.en = 60;
  assert.throws(() => planner.plan(room, a, b, queue, 0), /EN/);
  assert.equal(a.actionPoints, 5);
  a.en = 950;
  b.x = 20;
  assert.throws(() => planner.plan(room, a, b, queue, 0));
  assert.equal(a.actionPoints, 5);
});
test("one defensive decision resolves the weapon queue in order with only one counter after the last weapon", () => {
  const { a, b, queue, planner, room } = fixture(),
    en = a.en;
  planner.plan(room, a, b, queue, 0);
  const requests = planner.prepare(room);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].attacks.length, 3);
  const counter = G.modelOf(b).weapons[0];
  planner.choose(room, requests[0].id, "counter", counter.id, a.id);
  const battles = planner.resolve(room);
  assert.equal(battles.length, 3);
  assert.deepEqual(
    battles.map((b) => b.events[0].weapon),
    queue.map((w) => w.id),
  );
  assert.deepEqual(
    battles.map((b) => b.events.length),
    [1, 1, 2],
  );
  assert.equal(a.en, en - queue.reduce((n, w) => n + w.en, 0));
  assert.equal(a.actionPoints, 0);
  assert.ok(battles.every((b) => b.attackQueue.length === 3));
  assert.equal(b.counterCount, 1);
});
test("target death cancels later weapons without spending their EN; next own turn restores AP", () => {
  const { game, a, b, queue, planner, room } = fixture(),
    en = a.en;
  b.hp = 1;
  b.brokenParts = { head: true };
  planner.plan(room, a, b, queue, 0);
  const requests = planner.prepare(room);
  planner.choose(room, requests[0].id, "defend");
  const battles = planner.resolve(room);
  assert.equal(battles.length, 1);
  assert.equal(a.en, en - queue[0].en);
  // A separate surviving opponent keeps the turn cycle alive for the reset assertion.
  game.winner = null;
  game.units.push({ ...b, id: "survivor", x: 20, hp: 100000, brokenParts: {} });
  G.end(game);
  G.end(game);
  assert.equal(a.actionPoints, 5);
});

test("the same weapon may repeat while every occurrence consumes its own AP and EN", () => {
  const { a, b, queue, planner, room } = fixture(),
    en = a.en;
  const repeated = [queue[0], queue[0], queue[2]];
  planner.plan(room, a, b, repeated, 0);
  assert.equal(a.actionPoints, 0);
  const [request] = planner.prepare(room);
  planner.choose(room, request.id, "defend");
  const battles = planner.resolve(room);
  assert.deepEqual(
    battles.map((b) => b.events[0].weapon),
    repeated.map((w) => w.id),
  );
  assert.equal(a.en, en - queue[0].en * 2 - queue[2].en);
});

test("counter AP is 75 percent rounded up, independently of own-turn remaining AP", () => {
  const { game, a, b } = fixture(),
    model = G.models[b.model],
    original = model.actionPoints;
  try {
    for (const [normal, counter] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 3],
      [5, 4],
      [6, 5],
      [7, 6],
      [8, 6],
    ]) {
      model.actionPoints = normal;
      assert.equal(G.counterActionBudget(b), counter);
    }
    model.actionPoints = 5;
    b.actionPoints = 0;
    const weapon = G.modelOf(b).weapons[0];
    assert.equal(G.canCounter(game, b, a, { ...weapon, actionCost: 4 }), true);
    assert.equal(G.canCounter(game, b, a, { ...weapon, actionCost: 5 }), false);
    assert.equal(G.canCounter(game, b, a, undefined), false);
    assert.equal(b.actionPoints, 0);
  } finally {
    model.actionPoints = original;
  }
});

test("counter AP restrictions are enforced by the authoritative response path", () => {
  const { a, b, planner, room, queue } = fixture(),
    raw = G.models[b.model].weapons[0],
    cost = raw.actionCost;
  try {
    raw.actionCost = 5;
    planner.plan(room, a, b, [queue[0]], 0);
    const [request] = planner.prepare(room);
    assert.throws(() => planner.choose(room, request.id, "counter", raw.id, a.id));
    raw.actionCost = 4;
    planner.choose(room, request.id, "counter", raw.id, a.id);
    const before = b.actionPoints,
      battles = planner.resolve(room);
    assert.ok(battles[0].events.some((e) => e.from === b.id));
    assert.equal(b.actionPoints, before);
  } finally {
    raw.actionCost = cost;
  }
});

test("counterattack queues use the reduced AP budget, allow repeats and execute in order once", () => {
  const { a, b, queue, planner, room } = fixture();
  a.hp = 1000000;
  const counters = G.modelOf(b).weapons;
  const mg = counters.find((w) => w.id === "EF_90mmMG"),
    vulcan = counters.find((w) => w.id === "Common_DoubleVulcan_MS");
  const en = b.en,
    ownAP = b.actionPoints;
  planner.plan(room, a, b, [queue[0]], 0);
  const [request] = planner.prepare(room);
  for (const ids of [[mg.id, mg.id], Array(5).fill(vulcan.id), [], ["invalid"]])
    assert.throws(() => planner.choose(room, request.id, "counter", ids, a.id));
  assert.equal(room.reactions.length, 1);
  assert.equal(b.en, en);
  planner.choose(room, request.id, "counter", [mg.id, vulcan.id], a.id);
  assert.deepEqual(room.responses[0].counterIds, [mg.id, vulcan.id]);
  assert.equal(b.en, en);
  const battles = planner.resolve(room),
    events = battles.flatMap((battle) => battle.events).filter((e) => e.from === b.id);
  assert.deepEqual(
    events.map((e) => e.weapon),
    [mg.id, vulcan.id],
  );
  assert.equal(b.en, en - G.weaponStats(mg, b).en - G.weaponStats(vulcan, b).en);
  assert.equal(b.actionPoints, ownAP);
  assert.equal(b.counterCount, 1);
  assert.equal(b.counterTargetId, a.id);
});

test("repeated counter weapons reserve their combined EN atomically and stop when their target dies", () => {
  const { a, b, queue, planner, room } = fixture();
  b.model = "RGM_79__beam_spray";
  const vulcan = G.modelOf(b).weapons.find((w) => w.id === "EF_BeamSprayGun");
  planner.plan(room, a, b, [queue[0]], 0);
  const [request] = planner.prepare(room);
  const en = b.en;
  b.en = G.weaponStats(vulcan, b).en * 1.5;
  assert.throws(
    () => planner.choose(room, request.id, "counter", [vulcan.id, vulcan.id], a.id),
    /EN/,
  );
  assert.equal(room.responses.length, 0);
  b.en = en;
  a.hp = 1;
  room.game.seed = 2;
  planner.choose(room, request.id, "counter", Array(2).fill(vulcan.id), a.id);
  const events = planner
    .resolve(room)
    .flatMap((battle) => battle.events)
    .filter((e) => e.from === b.id);
  assert.equal(a.hp, 0);
  assert.equal(events.length, 1);
  assert.equal(b.en, en - G.weaponStats(vulcan, b).en);
});

test("lost weapon parts skip only unavailable counter weapons without spending their EN", () => {
  const { a, b, queue, planner, room } = fixture();
  a.hp = 1000000;
  planner.plan(room, a, b, [queue[0]], 0);
  const [request] = planner.prepare(room);
  const mg = G.modelOf(b).weapons.find((w) => w.id === "EF_90mmMG"),
    vulcan = G.modelOf(b).weapons.find((w) => w.id === "Common_DoubleVulcan_MS");
  planner.choose(room, request.id, "counter", [mg.id, vulcan.id], a.id);
  b.brokenParts.leftArm = b.brokenParts.rightArm = true;
  const en = b.en;
  const events = planner
    .resolve(room)
    .flatMap((battle) => battle.events)
    .filter((e) => e.from === b.id);
  assert.deepEqual(
    events.map((e) => e.weapon),
    [vulcan.id],
  );
  assert.equal(b.en, en - G.weaponStats(vulcan, b).en);
});
