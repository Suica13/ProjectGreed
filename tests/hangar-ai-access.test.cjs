const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const { createRoomEngine } = require("../shared/room-engine");

function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry, entry], [entry]], false, { costLimit: 99999 });
  game.tiles.forEach(row => row.fill("plain"));
  const [carrier, passenger, enemy] = game.units;
  carrier.model = Object.keys(G.models).find(id => id.startsWith("PegasusClass__"));
  Object.assign(carrier, { x: 12, y: 10, hp: G.modelOf(carrier).hp });
  Object.assign(passenger, { x: 11, y: 10, ownerSeat: 2, hp: 1 });
  Object.assign(enemy, { x: 35, y: 22 });
  return { game, carrier, passenger };
}

test("foreign AI recovery is blocked by default and follows the per-carrier toggle", () => {
  const { game, carrier, passenger } = fixture();
  assert.equal(G.hangars.allowsAIEntry(passenger, carrier), false);
  assert.equal(G.hangars.recoveryOrder(game, passenger), null);
  G.hangars.setAIEntry(carrier, true);
  assert(G.hangars.recoveryOrder(game, passenger));
  const restored = JSON.parse(JSON.stringify(carrier));
  assert(G.hangars.allowsAIEntry(passenger, restored));
  G.hangars.setAIEntry(carrier, false);
  assert.equal(G.hangars.recoveryOrder(game, passenger), null);
});

test("blocking foreign AI keeps human boarding, own AI recovery and AI carriers intact", () => {
  const { game, carrier, passenger } = fixture();
  const hangar = G.hangars.of(carrier)[0];
  assert(G.hangars.canEmbark(game, passenger, carrier, hangar.id));
  assert(G.hangars.allowsAIEntry(passenger, carrier, true));
  passenger.ownerSeat = carrier.ownerSeat;
  assert(G.hangars.recoveryOrder(game, passenger));
  assert.throws(() => G.hangars.setAIEntry(carrier, "true"), /设置无效/);
  assert.throws(() => G.hangars.setAIEntry(passenger, true), /设置无效/);
});

test("room authority validates ownership and booleans and deduplicates hangar settings", t => {
  let serial = 0;
  const snapshots = [];
  const clients = [{ readyState: 1 }, { readyState: 1 }];
  const engine = createRoomEngine({ rules: G, send: (_ws, value) => snapshots.push(value),
    randomId: () => "id-" + ++serial, randomToken: () => "token-" + ++serial,
    randomSeed: () => 1 });
  t.after(() => engine.close());
  const profile = { characterFaction: "PMC", licenses: { Type61: true }, inventory: { Type61: 5 } };
  engine.join(clients[0], { ...profile, mode: "create", room: "HANGAR" });
  engine.join(clients[1], { ...profile, mode: "join", room: "HANGAR" });
  const room = engine.rooms.get("HANGAR");
  const act = (seat, action, fields = {}, id = "request-" + ++serial) => engine.action(clients[seat], {
    id, revision: room.revision, matchId: room.matchId, round: room.game?.round, action, ...fields,
  });
  const formation = [{ unitId: "Type61", kitId: "standard" }];
  act(0, "configure_room", { ...G.defaultRoomSettings(), battleMode: "quick", formationStyle: "free" });
  act(1, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  act(0, "confirm_formation"); act(1, "confirm_formation");
  const carrier = room.game.units.find(unit => unit.ownerSeat === 0);
  carrier.model = Object.keys(G.models).find(id => id.startsWith("PegasusClass__"));
  assert.throws(() => act(1, "set_hangar_ai_access", { unitId: carrier.id, allowed: true }), /不能操作/);
  assert.throws(() => act(0, "set_hangar_ai_access", { unitId: carrier.id, allowed: 1 }), /设置无效/);
  const before = { hp: carrier.hp, en: carrier.en, moved: carrier.moved, acted: carrier.acted };
  act(0, "set_hangar_ai_access", { unitId: carrier.id, allowed: true }, "access-once");
  act(0, "set_hangar_ai_access", { unitId: carrier.id, allowed: false }, "access-once");
  assert.equal(carrier.allowAIBoarding, true);
  assert.deepEqual({ hp: carrier.hp, en: carrier.en, moved: carrier.moved, acted: carrier.acted }, before);
  assert(snapshots.some(snapshot => snapshot.game?.units.some(unit => unit.id === carrier.id && unit.allowAIBoarding)));
});
