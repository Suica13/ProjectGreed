const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  P = G.pilots;
const { createAttackPlanner } = require("../shared/attack-plans.js");
function world(speed = 100, skill = false) {
  let pilot = P.custom({
    ...P.createCustom("custom-mobility", "Mobility"),
    level: 10,
    stats: { ...P.baseStats(), speed },
  });
  if (skill) pilot = P.learnSkill(pilot, P.skillChoices.find((s) => s.statMultipliers.speed).id);
  const g = G.create(
    false,
    1,
    [
      [{ unitId: "RGM_79", kitId: "machine_gun", customPilot: pilot }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  const [u, b] = g.units;
  Object.assign(u, { x: 10, y: 10 });
  Object.assign(b, { x: 20, y: 10 });
  return { g, u, b };
}
test("pilot mobility scales movement and half-point AP independently from reaction", () => {
  const { u } = world();
  const base = G.models[u.model];
  for (const [speed, moveRate, apRate] of [
    [0, 0.5, 0.6],
    [50, 0.75, 0.8],
    [100, 1, 1],
    [125, 1.125, 1.1],
    [150, 1.25, 1.2],
    [175, 1.375, 1.3],
    [200, 1.5, 1.4],
  ]) {
    u.pilot = { stats: { ...P.baseStats(), speed } };
    const m = G.modelOf(u);
    assert.equal(m.move, base.move * moveRate);
    assert.equal(
      m.actionPoints,
      Math.round(base.actionPoints * Math.max(1, 1 + (base.speed - 100) * 0.005) * apRate * 2) / 2,
    );
    assert.equal(m.mobility, base.mobility);
  }
  const fast = Object.values(G.models).find((m) => m.actionPoints === 12);
  u.model = fast.id || fast.prefabId + "__" + fast.kitId;
  u.pilot = { stats: { ...P.baseStats(), speed: 200 } };
  assert.equal(
    G.actionBudget(u),
    Math.round(fast.actionPoints * Math.max(1, 1 + (fast.speed - 100) * 0.005) * 1.4 * 2) / 2,
  );
});
test("fractional movement budget is used by pathfinding and AP initializes/refills at the scaled budget", () => {
  const { g, u } = world(150);
  assert.equal(G.modelOf(u, g).move, 7.5);
  assert.equal(u.actionPoints, 12);
  const cells = G.reachable(g, u);
  assert(cells.has("17,10"));
  assert(!cells.has("18,10"));
  u.actionPoints = 0;
  G.end(g);
  G.end(g);
  assert.equal(u.actionPoints, 12);
  assert.equal(G.counterActionBudget(u), 9);
});
test("scaled AP permits a third 4-AP attack and cancellation refunds exactly the reservation", () => {
  const { g, u, b } = world(150);
  Object.assign(b, { x: 12, y: 10 });
  const gun = G.modelOf(u).weapons.find((w) => w.id === "EF_90mmMG");
  assert.equal(gun.actionCost, 4);
  let seq = 0;
  const planner = createAttackPlanner(G, () => String(++seq)),
    room = { game: g, matchId: "ratio" };
  planner.reset(room);
  planner.plan(room, u, b, [gun, gun, gun], 0);
  assert.equal(u.actionPoints, 0);
  assert.throws(() => planner.plan(room, u, b, [gun, gun, gun, gun], 0));
  planner.cancel(room, u);
  assert.equal(u.actionPoints, 12);
});
test("mobility skill grants only its AP budget increase and expires before next-turn refill", () => {
  const { g, u } = world(200, true),
    skill = P.skillsOf(u).find((s) => s.statMultipliers.speed);
  const original = structuredClone(u.pilot);
  assert.equal(u.actionPoints, 14);
  u.actionPoints = 2;
  G.useSkill(g, u, skill.id, u.x, u.y);
  assert.equal(G.actionBudget(u), 17);
  assert.equal(u.actionPoints, 5);
  assert.deepEqual(u.pilot, original);
  assert.throws(() => G.useSkill(g, u, skill.id, u.x, u.y));
  G.end(g);
  G.end(g);
  assert.equal(G.actionBudget(u), 14);
  assert.equal(u.actionPoints, 14);
});

test("half-point AP is preserved by turn refill and percentage penalties", () => {
  const { g, u } = world(113);
  assert.equal(G.actionBudget(u), 10.5);
  assert.equal(u.actionPoints, 10.5);
  assert.equal(G.counterActionBudget(u), 8);
  u.apPenaltyNextTurn = 0.25;
  u.actionPoints = 0;
  G.end(g);
  G.end(g);
  assert.equal(u.actionPoints, 8);
  assert.equal(u.apPenaltyNextTurn, undefined);
  G.end(g);
  G.end(g);
  assert.equal(u.actionPoints, 10.5);
  assert.equal(JSON.parse(JSON.stringify(g)).units.find((x) => x.id === u.id).actionPoints, 10.5);
});
