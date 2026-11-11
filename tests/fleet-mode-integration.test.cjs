const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  { createRoomEngine } = require("../shared/room-engine");
function fixture(t, mode) {
  let n = 0;
  const e = createRoomEngine({
    rules: G,
    randomId: () => String(++n),
    randomToken: () => String(++n),
    randomSeed: () => 7319,
    send: () => {},
    aiDelayMs: 999999,
  });
  t.after(() => e.close());
  const ws = { readyState: 1 };
  e.join(ws, {
    mode: "create",
    room: "FLEETMODE",
    roomMode: mode,
    characterFaction: "PMC",
    licenses: { Medea: true, Type61: true },
    inventory: { Medea: 5, Type61: 30 },
  });
  const room = e.rooms.get("FLEETMODE"),
    seat = mode === "battlefield" ? 2 : 0;
  const act = (action, fields = {}) =>
    e.action(ws, {
      id: "action-" + ++n,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  if (["regular", "quick"].includes(mode)) act("add_ai", { seat: 1 });
  const formation = [
    { unitId: "Medea", kitId: "standard" },
    { unitId: "Type61", kitId: "standard", preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
  ];
  act("start_game", { formation });
  assert.equal(room.phase, "assembly");
  act("confirm_formation");
  if (mode === "sweep") {
    assert.equal(room.phase, "sweep_map");
    act("sweep_select", { nodeId: "0:1" });
    act("sweep_confirm");
  }
  assert.equal(room.phase, "deployment");
  return { e, room, seat, act };
}
for (const mode of ["regular", "quick", "battlefield", "sweep"])
  test(`${mode} deploys a legal transport formation with cargo and shared limits`, (t) => {
    const { room, seat } = fixture(t, mode),
      units = room.game.units.filter((u) => G.ownerOf(u) === seat);
    assert.equal(units.length, 2);
    assert.equal(units.filter((u) => u.embarked).length, 1);
      assert.equal(room.settings.unitLimit, 18);
  });
test("sweep restock validates hangars using stable roster keys after the original carrier is lost", (t) => {
  const { e, room, seat, act } = fixture(t, "sweep");
  act("confirm_deployment");
  const own = room.game.units.filter((u) => G.ownerOf(u) === seat),
    id = room.seats[seat].id;
  own.find((u) => G.modelOf(u).prefabId === "Medea").hp = 0;
  for (const u of room.game.units.filter((u) => u.team === 1)) u.hp = 0;
  room.game.winner = 0;
  room.phase = "finished";
  e.broadcast(room);
  assert.equal(room.phase, "sweep_map");
  assert.equal(room.sweep.rosters[id].length, 1);
  room.sweep.nodes.find((n) => n.id === "1:1").type = "rest";
  act("sweep_select", { nodeId: "1:1" });
  act("sweep_confirm");
  act("sweep_event", { choice: 1 });
  assert.equal(room.phase, "sweep_resupply");
  assert.throws(
    () => act("sweep_reinforce", { entry: { unitId: "Type61", kitId: "standard" } }),
    /预先搭载/,
  );
  act("sweep_reinforce", { entry: { unitId: "Medea", kitId: "standard" } });
  const carrier = room.sweep.rosters[id].find((r) => r.entry.unitId === "Medea");
  assert.equal(carrier.key, 2);
  act("sweep_reinforce", {
    entry: {
      unitId: "Type61",
      kitId: "standard",
      preload: { carrierIndex: carrier.key, hangarId: "Hangar_1" },
    },
  });
  assert.equal(room.sweep.rosters[id].at(-1).entry.preload.carrierIndex, 2);
  act("sweep_resupply_done");
  room.sweep.nodes.find((n) => n.id === "2:1").type = "battle";
  act("sweep_select", { nodeId: "2:1" });
  act("sweep_confirm");
  assert.equal(room.phase, "deployment");
  const units = room.game.units.filter((u) => G.ownerOf(u) === seat);
  assert.equal(units.length, 3);
  assert.equal(units.filter((u) => u.embarked).length, 1);
});
