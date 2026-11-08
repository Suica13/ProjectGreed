const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  S = require("../shared/sweep-mode"),
  { createRoomEngine } = require("../shared/room-engine");
function fixture(t, options = {}) {
  let serial = 0;
  const messages = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "sweep-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: (ws, m) => messages.push(m),
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "SWEEP",
    roomMode: options.mode || "sweep",
    characterFaction: "PMC",
    licenses: { Type61: true },
    inventory: { Type61: 10, RGZ_91B: 2 },
  });
  const room = engine.rooms.get("SWEEP");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: "request-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  if (options.mode === "regular") act("add_ai", { seat: 1 });
  if (options.formation) Object.assign(room.settings, { costLimit: 99999, unitCostLimit: 99999 });
  act("start_game", {
    formation: options.formation || [
      { unitId: "Type61", kitId: "standard" },
      { unitId: "Type61", kitId: "standard" },
    ],
  });
  act("confirm_formation");
  return { engine, ws, room, act, messages };
}
test("sweep initializes a shared map with a locked enemy AI and private pending loot", (t) => {
  const { room, messages } = fixture(t);
  assert.equal(room.phase, "sweep_map");
  assert(room.seats[1].sweepEnemy);
  const snapshot = messages.filter((m) => m.type === "state").at(-1);
  assert(snapshot.sweep.nodes.length >= 18);
  assert.equal(snapshot.sweep.seed, undefined);
  assert.equal(snapshot.sweep.teams[0].units.length, 2);
  assert.equal(snapshot.sweep.pending.money, 0);
});
test("battle loot is deferred, HP/EN persist, extraction emits one award and inventory losses are immediate", (t) => {
  const { room, act, engine } = fixture(t);
  act("sweep_select", { nodeId: "0:1" });
  act("sweep_confirm");
  assert.equal(room.phase, "deployment");
  const own = room.game.units.filter((u) => u.team === 0);
  own[0].hp -= 1000;
  own[0].en = 23;
  act("confirm_deployment");
  const before = room.seats[0].inventory.Type61;
  own[1].hp = 0;
  engine.broadcast(room);
  assert.equal(room.seats[0].inventory.Type61, before - 1);
  for (const u of room.game.units.filter((u) => u.team === 1)) u.hp = 0;
  room.game.winner = 0;
  room.phase = "finished";
  engine.broadcast(room);
  assert.equal(room.phase, "sweep_map");
  assert.equal(room.sweep.rosters[room.seats[0].id][0].state.en, 23);
  assert(room.sweep.pending[room.seats[0].id].money > 0);
  assert(!room.economyAwards.some((a) => a.kind === "result"));
  act("sweep_extract");
  assert.equal(room.phase, "finished");
  assert.equal(room.economyAwards.filter((a) => a.kind === "result").length, 1);
  engine.broadcast(room);
  assert.equal(room.economyAwards.filter((a) => a.kind === "result").length, 1);
});
test("eight deterministic events and unlimited adjacent rows preserve traversal validity", () => {
  assert.equal(S.events.length, 8);
  assert.deepEqual(S.rows(1), S.rows(1));
  const nodes = S.rows(7, 100, 7);
  assert(
    nodes.every((n) => n.next.every((id) => Math.abs(Number(id.split(":")[1]) - n.lane) <= 1)),
  );
});

test("a second battle inherits resources and rest can restore or add counted reserve units", (t) => {
  const { room, act, engine } = fixture(t);
  const choose = (id) => {
    act("sweep_select", { nodeId: id });
    act("sweep_confirm");
  };
  choose("0:1");
  act("confirm_deployment");
  const own = room.game.units.find((u) => u.team === 0);
  own.hp = 2000;
  own.en = 17;
  for (const u of room.game.units.filter((u) => u.team === 1)) u.hp = 0;
  room.game.winner = 0;
  room.phase = "finished";
  engine.broadcast(room);
  room.sweep.nodes.find((n) => n.id === "1:1").type = "battle";
  choose("1:1");
  const resumed = room.game.units.find((u) => u.team === 0);
  assert.equal(resumed.hp, 2000);
  assert.equal(resumed.en, 17);
  act("confirm_deployment");
  for (const u of room.game.units.filter((u) => u.team === 1)) u.hp = 0;
  room.game.winner = 0;
  room.phase = "finished";
  engine.broadcast(room);
  room.sweep.nodes.find((n) => n.id === "2:1").type = "rest";
  choose("2:1");
  act("sweep_event", { choice: 0 });
  assert.equal(room.phase, "sweep_map");
  assert(room.sweep.rosters[room.seats[0].id][0].state.hp > 2000);
  room.sweep.nodes.find((n) => n.id === "3:1").type = "rest";
  choose("3:1");
  act("sweep_event", { choice: 1 });
  assert.equal(room.phase, "sweep_resupply");
  const count = room.sweep.rosters[room.seats[0].id].length;
  act("sweep_reinforce", { entry: { unitId: "Type61", kitId: "standard" } });
  assert.equal(room.sweep.rosters[room.seats[0].id].length, count + 1);
  act("sweep_resupply_done");
  assert.equal(room.phase, "sweep_map");
});

test("wipe halves resources but retains recovered inventory, with duplicate-safe extraction", (t) => {
  const { room, act, engine } = fixture(t);
  act("sweep_select", { nodeId: "0:1" });
  act("sweep_confirm");
  act("confirm_deployment");
  const pending = room.sweep.pending[room.seats[0].id];
  pending.money = 1000;
  pending.supplies = 2000;
  pending.technology = 100;
  pending.inventory = { RGZ_91: 1 };
  for (const u of room.game.units.filter((u) => u.team === 0)) u.hp = 0;
  room.game.winner = 1;
  room.phase = "finished";
  engine.broadcast(room);
  assert(room.sweep.failed);
  assert.equal(room.phase, "finished");
  const award = room.economyAwards.find((a) => a.kind === "result");
  assert.equal(award.money, 625);
  assert.equal(award.supplies, 1250);
  assert.deepEqual(award.stockGained.inventory, { RGZ_91: 1 });
  assert.equal(room.seats[0].inventory.Type61, 8);
});

test("event deaths debit inventory once and non-hosts cannot select routes or remove the enemy", (t) => {
  const { room, act, engine } = fixture(t);
  assert.throws(() => act("remove_ai", { seat: 1 }));
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "join",
    room: "SWEEP",
    characterFaction: "PMC",
    inventory: { Type61: 3 },
  });
  assert.equal(ws.seat, null);
  assert.throws(() =>
    engine.action(ws, {
      id: "guest-select",
      action: "sweep_select",
      revision: room.revision,
      matchId: room.matchId,
      nodeId: "0:1",
    }),
  );
  const node = room.sweep.nodes.find((n) => n.id === "0:1");
  node.type = "event";
  act("sweep_select", { nodeId: node.id });
  act("sweep_confirm");
  room.sweep.event = structuredClone(S.events.find((e) => e.id === "minefield"));
  for (const r of room.sweep.rosters[room.seats[0].id]) r.state.hp = 1;
  act("sweep_event", { choice: 1 });
  assert(room.sweep.failed);
  assert.equal(room.seats[0].inventory.Type61, 8);
  engine.broadcast(room);
  assert.equal(room.seats[0].inventory.Type61, 8);
});

test("deployment ordinary transformation is authoritative and never enables temporary systems", (t) => {
  const p = G.catalog.prefabs.find((p) => p.id === "RGZ_91B");
  const { room, act } = fixture(t, {
    mode: "regular",
    formation: [{ unitId: p.id, kitId: p.defaultKit }],
  });
  assert.equal(room.phase, "deployment");
  const u = room.game.units.find((u) => u.ownerSeat === 0);
  const deployment = room.game.deployment;
  act("deployment_transform", { unitId: u.id, skillId: "Transform" });
  assert.equal(G.modelOf(u).prefabId, "RGZ_91B_MA");
  assert.equal(room.game.deployment, deployment);
  assert(!u.acted);
  assert.throws(() => act("deployment_transform", { unitId: u.id, skillId: "EXAM" }));
});
