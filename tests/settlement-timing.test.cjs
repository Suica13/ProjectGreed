const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules"), S = require("../shared/sweep-mode");
const { createRoomEngine } = require("../shared/room-engine");
const formation = [{ unitId: "Medea", kitId: "standard" }, {
  unitId: "Type61", kitId: "standard", preload: { carrierIndex: 0, hangarId: "Hangar_1" },
}];
function fixture(t, mode) {
  let n = 0;
  const frames = new Map(), engine = createRoomEngine({ rules: G,
    randomId: () => "id-" + ++n, randomToken: () => "token-" + ++n,
    randomSeed: () => 7319, send: (ws, msg) => frames.set(ws, msg), aiDelayMs: 999999,
  });
  t.after(() => engine.close());
  const clients = [{ readyState: 1 }, { readyState: 1 }];
  clients.slice(0, mode === "sweep" ? 1 : 2).forEach((ws, i) => engine.join(ws, {
    mode: i ? "join" : "create", room: "TIMING", roomMode: mode, characterFaction: "PMC",
    licenses: { Medea: true, Type61: true }, inventory: { Medea: 5, Type61: 5 },
  }));
  const room = engine.rooms.get("TIMING");
  const act = (i, action, fields = {}) => engine.action(clients[i], {
    id: "req-" + ++n, revision: room.revision, round: room.game.round,
    phase: room.phase, matchId: room.matchId, action, ...fields,
  });
  if (mode !== "sweep") act(1, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  act(0, "confirm_formation");
  if (mode !== "sweep") {
    act(1, "confirm_formation");
    for (const i of [0, 1]) { act(i, "auto_place_deployment"); act(i, "confirm_deployment"); }
    assert.equal(room.phase, "idle");
  } else assert.equal(room.phase, "sweep_map");
  const player = [...room.members.values()].find((p) => p.ws === clients[0]);
  return { engine, room, clients, frames, act, player };
}
for (const mode of ["regular", "quick", "battlefield"]) {
  test(`${mode} casualties stay pending across disconnect and settle exactly once`, (t) => {
    const f = fixture(t, mode), { room, player } = f;
    const actor = room.game.units.find((u) => u.ownerSeat === player.seat && u.formationIndex === 1);
    actor.hp = 0;
    f.engine.broadcast(room);
    f.act(0, "sync");
    assert.equal(player.inventory.Type61, 5);
    assert.equal(f.frames.get(f.clients[0]).rewardsSettled, false);
    assert(!room.economyAwards.some((a) => a.stockLost));
    if (mode === "battlefield") {
      const reserve = room.game.battlefield.reserves.find((r) => r.ownerSeat === player.seat && r.unitId === "Type61");
      assert.equal(reserve.stockRemaining, 4);
    }
    f.engine.disconnect(f.clients[0]);
    assert.equal(player.inventory.Type61, 5);
    const resumed = { readyState: 1 };
    f.engine.join(resumed, { mode: "resume", room: "TIMING", token: player.token, characterFaction: "PMC" });
    f.clients[0] = resumed;
    assert.equal(player.inventory.Type61, 5);
    room.game.winner = 0; room.phase = "finished";
    f.engine.broadcast(room);
    f.act(0, "sync");
    assert.equal(f.frames.get(resumed).rewardsSettled, true);
    assert.equal(player.inventory.Type61, mode === "quick" ? 5 : 4);
    const awards = JSON.stringify(room.economyAwards);
    f.act(0, "sync");
    assert.equal(JSON.stringify(room.economyAwards), awards);
  });
}
test("returning from an unfinished regular match never settles casualties or rewards", (t) => {
  const f = fixture(t, "regular");
  f.room.game.units.find((u) => u.ownerSeat === f.player.seat).hp = 0;
  f.act(0, "return_room");
  assert.equal(f.player.inventory.Medea, 5);
  assert.equal(f.frames.get(f.clients[0]).rewardsSettled, false);
  assert(!f.room.economyAwards.some((a) => a.stockLost || a.kind === "result"));
});
for (const failed of [false, true]) test(`sweep node losses remain pending until ${failed ? "wipeout" : "extraction"}`, (t) => {
  const f = fixture(t, "sweep"), s = f.room.sweep, id = f.player.id;
  s.depth = 0;
  s.losses[id].push(s.rosters[id].pop());
  s.pending[id] = { money: 1000, supplies: 2000, technology: 250, inventory: { Type61: 2 } };
  f.act(0, "sync");
  assert.equal(f.player.inventory.Type61, 5);
  const view = S.view(f.room, id);
  assert.equal(view.inventoryRemaining.Type61, 4);
  assert.equal(f.frames.get(f.clients[0]).rewardsSettled, false);
  assert(!f.room.economyAwards.some((a) => a.stockLost));
  if (failed) { S.finish(f.room, true); f.engine.broadcast(f.room); f.act(0, "sync"); }
  else f.act(0, "sweep_extract");
  const award = f.room.economyAwards.find((a) => a.kind === "result");
  assert.equal(f.player.inventory.Type61, 4);
  assert.deepEqual(award.stockLost.inventory, { Type61: 1 });
  assert.deepEqual(award.stockGained.inventory, { Type61: 2 });
  assert.equal(award.money, failed ? 500 : 1000);
  assert.equal(f.frames.get(f.clients[0]).rewardsSettled, true);
  f.act(0, "sync");
  assert.equal(f.player.inventory.Type61, 4);
  assert.equal(f.room.economyAwards.filter((a) => a.kind === "result").length, 1);
});
