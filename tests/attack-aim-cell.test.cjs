const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
function fixture() {
  const entry = { unitId: "Type61", kitId: "standard" };
  const game = G.create(false, 1, [[entry], [entry]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  game.fogMode = "disabled";
  game.tiles.forEach((r) => r.fill("plain"));
  const [a, b] = game.units,
    base = G.modelOf(a),
    weapon = base.weapons.find((w) => w.slot !== "skill");
  const near = { ...weapon, id: "near", min: 2, max: 2, actionCost: 1, en: 0 };
  const far = { ...weapon, id: "far", min: 4, max: 4, actionCost: 1, en: 0 };
  G.models.aim_attacker = { ...base, weapons: [near, far], skills: [], hangars: [] };
  G.models.aim_target = { ...base, footprint: { width: 3, height: 1 }, weakPoint: false };
  Object.assign(a, { model: "aim_attacker", x: 10, y: 10, angle: 0, actionPoints: 10 });
  Object.assign(b, { model: "aim_target", x: 12, y: 10, angle: 0, hp: 100000 });
  const room = { game };
  const planner = createAttackPlanner(G, () => "id");
  planner.reset(room);
  return {
    room,
    planner,
    a,
    b,
    near,
    far,
    cleanup: () => {
      delete G.models.aim_attacker;
      delete G.models.aim_target;
    },
  };
}
test("queue rejects individually valid weapons with disjoint target cells before reserving resources", () => {
  const f = fixture();
  try {
    const { room, planner, a, b, near, far } = f;
    assert(G.canAttack(room.game, a, b, near));
    assert(G.canAttack(room.game, a, b, far));
    assert.equal(G.attackAimCell(room.game, a, b, [near, far]), null);
    assert.throws(() => G.attackQueue(room.game, a, b, [near, far]), /目标格/);
    assert.throws(() => planner.plan(room, a, b, [near, far], 0), /目标格/);
    assert.equal(a.actionPoints, 10);
    assert.equal(room.plans.length, 0);
    const plan = planner.plan(room, a, b, [near, near], 0);
    assert.deepEqual(plan.aimCell, { x: 12, y: 10 });
    assert.equal(a.actionPoints, 8);
  } finally {
    f.cleanup();
  }
});
test("queue and planner choose the same shared cell, respect explicit aiming and reject invalid cells", () => {
  const f = fixture();
  try {
    const { room, planner, a, b, near, far } = f;
    near.max = 3;
    far.min = 3;
    assert.deepEqual(G.attackAimCell(room.game, a, b, [near, far]), { x: 13, y: 10 });
    assert.doesNotThrow(() => G.attackQueue(room.game, a, b, [near, far]));
    assert.deepEqual(planner.plan(room, a, b, [near, far], 0).aimCell, { x: 13, y: 10 });
    planner.cancel(room, a);
    assert.throws(() =>
      G.attackQueue(room.game, a, { ...b, aimCell: { x: 12, y: 10 } }, [near, far]),
    );
    assert.throws(() => planner.plan(room, a, { ...b, aimCell: { x: 40, y: 10 } }, [near], 0));
    assert.equal(a.actionPoints, 10);
  } finally {
    f.cleanup();
  }
});

test("room AI timer submits a valid same-cell volley against a large target", async () => {
  const { createRoomEngine } = require("../shared/room-engine.js");
  let seq = 0;
  const frames = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id-" + ++seq,
    randomToken: () => "token-" + ++seq,
    randomSeed: () => 1,
    aiDelayMs: 20,
    send: (ws, msg) => frames.push(msg),
  });
  const host = { readyState: 1 };
  let f;
  try {
    engine.join(host, {
      mode: "create",
      room: "AIAIM",
      characterFaction: "PMC",
      licenses: { Type61: true },
    });
    const room = engine.rooms.get("AIAIM");
    const act = (action, fields = {}) =>
      engine.action(host, {
        id: "action-" + ++seq,
        revision: room.revision,
        round: room.game.round,
        matchId: room.matchId,
        action,
        ...fields,
      });
    act("add_ai", { seat: 1 });
    act("configure_room", { ...room.settings, fogMode: "disabled" });
    act("start_game", {
      formation: [{ unitId: "Type61", kitId: "standard" }],
      licenses: { Type61: true },
    });
    act("confirm_formation");
    act("confirm_deployment");
    assert.equal(room.phase, "idle");
    f = fixture();
    Object.assign(f.a, { id: "1-test", ownerSeat: 1, team: 1, hp: 100000, en: 10000 });
    Object.assign(f.b, { id: "0-test", ownerSeat: 0, team: 0 });
    room.game = f.room.game;
    room.game.team = 0;
    room.game.deployment = [true, true];
    room.turnNotBefore = 0;
    act("end_turn");
    Object.assign(f.a, { moved: true, actionPoints: 5 });
    room.turnNotBefore = 0;
    const deadline = Date.now() + 6000;
    while (!frames.some((m) => m.lastEvent?.type === "plan_attack") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const event = frames.find((m) => m.lastEvent?.type === "plan_attack")?.lastEvent;
    assert(
      event,
      "AI must plan a legal attack instead of rejecting its weapon queue: " +
        JSON.stringify({
          phase: room.phase,
          team: room.game.team,
          events: frames.map((f) => f.lastEvent?.type),
          acted: f.a.acted,
          ap: f.a.actionPoints,
        }),
    );
    assert(event.weapons.length > 0);
    assert.equal(new Set(event.weapons).size, 1, "incompatible near/far weapons must not be mixed");
    assert(G.cells(f.b).some((c) => c.x === event.aimCell.x && c.y === event.aimCell.y));
  } finally {
    engine.close();
    f?.cleanup();
  }
});
