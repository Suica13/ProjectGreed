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

test("AI-only planning waits for its spectator host, advances once and stops on human takeover", async t => {
  const { engine, room, act } = fixture(t);
  const start = room.campaign.turn;
  // Neither broadcasts nor the old AI timer may advance a host-controlled phase.
  const sync = setInterval(() => engine.broadcast(room), 5);
  t.after(() => clearInterval(sync));
  await pause(180);
  assert.equal(room.campaign.turn, start);
  clearInterval(sync);
  act("campaign_ready", {turn:start, ready:true, id:"host-strategic-step"});
  const after = JSON.stringify(room.campaign);
  act("campaign_ready", {turn:start, ready:true, id:"host-strategic-step"});
  assert.equal(JSON.stringify(room.campaign), after, "retries must not settle a second strategic turn");
  assert(room.campaign.history.some(line=>line.includes("生产、收入与调动已结算")));
  assert.equal(room.started, false);
  act("switch_seat", { seat: 0 });
  const humanTurn = room.campaign.turn;
  await pause(180);
  assert.equal(room.campaign.turn, humanTurn, "seated humans must still explicitly finish their turn");
  act("switch_seat", { seat: null });
  await pause(180);
  assert.equal(room.campaign.turn, humanTurn);
});

test("AI-only encounters wait for their spectator host, while suspended campaigns remain in their lobby", async t => {
  const { engine, room, act } = fixture(t);
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
  await pause(150);
  assert.equal(room.started,false);
  const preparation=room.campaignPreparation;
  const guest={readyState:1};
  engine.join(guest,{mode:"join",room:room.code,name:"Other spectator",characterFaction:"PMC"});
  engine.action(guest,{id:"guest-spectate",revision:room.revision,action:"switch_seat",seat:null});
  const fields={region:preparation.region,mapId:preparation.mapId,preparationId:preparation.id};
  assert.throws(()=>engine.action(guest,{id:"guest-start-battle",revision:room.revision,
    action:"campaign_start_battle",...fields}),/只有房主/);
  act("campaign_start_battle",{...fields,id:"host-start-battle"});
  const matchId=room.matchId;
  act("campaign_start_battle",{...fields,id:"host-start-battle"});
  assert.equal(room.matchId,matchId);
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
