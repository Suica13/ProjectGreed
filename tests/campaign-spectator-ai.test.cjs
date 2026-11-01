const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const C = require("../shared/campaign.js");
const { createRoomEngine } = require("../shared/room-engine.js");
const production = require("../shared/production-data.cjs");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate() && Date.now() < deadline) await pause(5);
  assert(predicate(), "automatic campaign progress timed out");
}
function fixture(t, delay = 60, spectateBeforeStart = false) {
  let serial = 0;
  const socket = { readyState: 1 };
  const engine = createRoomEngine({ rules: G, randomId: () => "watch-" + ++serial,
    randomToken: () => "token-" + ++serial, randomSeed: () => 1,
    aiDelayMs: delay, randomAIMoveDelay: () => 0, send() {} });
  t.after(() => engine.close());
  engine.join(socket, { mode: "create", room: "WATCH", roomMode: "campaign", name: "Observer", characterFaction: "PMC" });
  const room = engine.rooms.get("WATCH");
  const act = (action, fields = {}) => engine.action(socket, { action, id: "request-" + ++serial,
    revision: room.revision, matchId: room.matchId, round: room.game.round, ...fields });
  act("add_ai", { seat: 1 }); act("add_ai", { seat: 2 });
  if (spectateBeforeStart) act("switch_seat", { seat: null });
  act("start_game", { campaignRounds: 10 });
  if (!spectateBeforeStart) act("switch_seat", { seat: null });
  return { engine, room, act };
}

test("AI-only planning advances without spectator input, survives repeated sync and stops on human takeover", async t => {
  const { engine, room, act } = fixture(t);
  const start = room.campaign.turn;
  // Room broadcasts must not continually postpone the same automatic step.
  const sync = setInterval(() => engine.broadcast(room), 5);
  t.after(() => clearInterval(sync));
  await until(() => room.campaign.turn > start);
  clearInterval(sync);
  assert.equal(room.started, false);
  act("switch_seat", { seat: 0 });
  const humanTurn = room.campaign.turn;
  await pause(180);
  assert.equal(room.campaign.turn, humanTurn, "seated humans must still explicitly finish their turn");
  act("switch_seat", { seat: null });
  await until(() => room.campaign.turn > humanTurn || room.started);
});

test("AI-only encounters enter automatically, while suspended campaigns remain in their lobby", async t => {
  const { engine, room } = fixture(t);
  room.campaignLobby = true;
  const initial = room.campaign.turn;
  engine.broadcast(room);
  await pause(150);
  assert.equal(room.campaign.turn, initial);
  room.campaign.units = [];
  C.addUnit({ G, production }, room.campaign, 2, "canada_east", "Type61");
  C.addUnit({ G, production }, room.campaign, 1, "canada_east", "MS_06F");
  room.campaign.phase = "encounters";
  room.campaign.encounters = [{ region: "canada_east", turn: 0, battleSave: null, roster: {}, settled: [] }];
  engine.broadcast(room);
  await pause(100);
  assert.equal(room.started, false, "suspension must also block automatic battle entry");
  room.campaignLobby = false;
  engine.broadcast(room);
  await until(() => room.started);
  assert.equal(room.campaignBattle.region, "canada_east");
  assert.equal(room.phase, "idle", "AI deployment must not wait for a spectator");
  assert.deepEqual(room.campaignBattle.delegatedSeats, []);
});

test("pending AI planning timers cannot advance destroyed rooms", async t => {
  const { engine, room } = fixture(t, 60, true);
  const before = room.campaign.turn;
  engine.destroyRoom(room);
  await pause(150);
  assert.equal(room.campaign.turn, before);
});
