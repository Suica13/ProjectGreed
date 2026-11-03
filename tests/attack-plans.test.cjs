const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules");
const { createAttackPlanner } = require("../shared/attack-plans");
function fixture() {
  const e = { unitId: "RGM_79", kitId: "machine_gun" },
    game = G.create(
      false,
      1,
      [
        [e, e],
        [e, e],
      ],
      false,
      { fogMode: "disabled" },
    );
  game.tiles.forEach((row) => row.fill("plain"));
  game.units.forEach((u, i) =>
    Object.assign(u, { x: i < 2 ? 5 : 6, y: 5 + (i % 2), hp: 100000, en: 10000, shield: 0 }),
  );
  let n = 0;
  const planner = createAttackPlanner(G, () => String(++n)),
    room = { game, matchId: "planner" };
  planner.reset(room);
  return {
    planner,
    room,
    a: game.units[0],
    ally: game.units[1],
    b: game.units[2],
    other: game.units[3],
  };
}
test("planning is reversible and changes neither RNG, HP, EN nor AP", () => {
  const { room, planner, a, b } = fixture(),
    before = [room.game.seed, a.en, b.hp, a.actionPoints];
  planner.plan(room, a, b, null, 0);
  planner.plan(room, a, b, null, 0);
  assert.equal(room.plans.length, 1);
  assert.deepEqual([room.game.seed, a.en, b.hp, a.actionPoints], before);
  planner.cancel(room, a);
  assert.equal(a.acted, false);
  assert.equal(a.plan, undefined);
  assert.equal(room.plans.length, 0);
});
test("responses are collected without damage and reject stale or duplicate reaction IDs", () => {
  const { room, planner, a, ally, b, other } = fixture();
  planner.plan(room, a, b, null, 0);
  planner.plan(room, ally, other, null, 0);
  const requests = planner.prepare(room),
    before = room.game.units.map((u) => u.hp);
  assert.equal(requests.length, 2);
  assert.throws(() => planner.choose(room, "stale", "defend"));
  planner.choose(room, requests[0].id, "defend");
  assert.throws(() => planner.resolve(room));
  assert.deepEqual(
    room.game.units.map((u) => u.hp),
    before,
  );
  assert.throws(() => planner.choose(room, requests[0].id, "defend"));
  planner.choose(room, requests[1].id, "evade");
  assert(planner.resolve(room).length > 0);
  assert.equal(room.game.team, 0, "only the room engine advances turns");
});
test("dead or out-of-range targets are skipped without resource charges", () => {
  const { room, planner, a, ally, b, other } = fixture();
  planner.plan(room, a, b, null, 0);
  planner.plan(room, ally, other, null, 0);
  const energy = a.en;
  b.hp = 0;
  other.x = 30;
  assert.equal(planner.prepare(room).length, 0);
  assert.equal(planner.resolve(room).length, 0);
  assert.equal(a.en, energy);
  assert.equal(a.plan, undefined);
  assert.equal(ally.plan, undefined);
});
test("canceling a plan restores move undo until another unit moves", () => {
  const { room, planner, a, ally, b } = fixture();
  G.move(room.game, a, 5, 4);
  planner.plan(room, a, b, null, 0);
  planner.cancel(room, a);
  assert.equal(G.canUndo(room.game, a), true);
  G.move(room.game, ally, 4, 6);
  assert.equal(G.canUndo(room.game, a), false);
});
test("focused fire has one response and counters only attacking squads", () => {
  const { room, planner, a, ally, b, other } = fixture();
  planner.plan(room, a, b, null, 0);
  planner.plan(room, ally, b, null, 0);
  const [request] = planner.prepare(room);
  assert.equal(request.attacks.length, 2);
  assert.throws(() => planner.choose(room, request.id, "counter", [], other.id));
  planner.choose(room, request.id, "counter", [], ally.id);
  const battles = planner.resolve(room),
    counters = battles.filter((b) => b.combatStage === "counter");
  assert(counters.length > 0);
  assert(counters.every((battle) => [a.id, ally.id].includes(battle.events[0].to)));
  assert.equal(b.counterCount, 1);
});
for (const response of ["defend", "evade"])
  test("focused fire shares " + response + " across all attackers", () => {
    const { room, planner, a, ally, b } = fixture();
    planner.plan(room, a, b, null, 0);
    planner.plan(room, ally, b, null, 0);
    const [request] = planner.prepare(room);
    planner.choose(room, request.id, response);
    assert(
      planner.resolve(room).every((battle) => battle.events.every((e) => e.response === response)),
    );
    assert.equal(b.counterCount || 0, 0);
  });
test("multi-target submissions are rejected atomically and weapon lists cannot choose the loadout", () => {
  const { room, planner, a, b, other } = fixture(),
    before = structuredClone(a);
  assert.throws(() => planner.planBatch(room, a, [{ targetId: b.id }, { targetId: other.id }], 0));
  assert.deepEqual(a, before);
  assert.equal(room.plans.length, 0);
  planner.planBatch(room, a, [{ targetId: b.id, weaponIds: ["client-forged-weapon"] }], 0);
  assert.deepEqual(
    room.plans[0].weapons,
    G.automaticQueue(room.game, a, b).map((w) => w.id),
  );
});
test("multi-target counters are rejected before modifying reaction choices", () => {
  const { room, planner, a, ally, b } = fixture();
  planner.plan(room, a, b, null, 0);
  planner.plan(room, ally, b, null, 0);
  const [request] = planner.prepare(room);
  assert.throws(() =>
    planner.chooseBatch(room, request.id, [{ targetId: a.id }, { targetId: ally.id }]),
  );
  assert.equal(room.responses.length, 0);
  assert.equal(room.pending.id, request.id);
  planner.chooseBatch(room, request.id, [{ targetId: a.id }]);
  assert(planner.resolve(room).length);
});
