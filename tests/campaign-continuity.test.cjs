const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  C = require("../shared/campaign.js"),
  Records = require("../shared/match-records.js");
const { createCampaignRoom } = require("../shared/campaign-room.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
const ctx = {
  G,
  world: require("../assets/maps/strategy/earth_0079_mid/world.json"),
  production: require("../shared/production-data.cjs"),
  development: require("../shared/development.js"),
  validateBattle: (save) => Records.validateSave(G, save),
};
function fixture(ids = ["Gunperry", "RGM_79", "MS_06F"], prepare = null, regionId = "canada", seatCount = 2) {
  let serial = 0;
  const members = [
    { id: "host", seat: 0 },
    { id: "guest", seat: 1 },
  ];
  const state = C.create(ctx, members);
  state.units = [];
  ids.forEach((id, index) => C.addUnit(ctx, state, index === ids.length - 1 ? 1 : 0, regionId, id));
  if (prepare) prepare(state, members);
  state.phase = "encounters";
  state.encounters = [{ region: regionId, turn: 0, battleSave: null, roster: {}, settled: [] }];
  const planner = createAttackPlanner(G, () => "plan-" + ++serial);
  const room = {
    hostId: "host",
    campaign: state,
    seats: [...members, ...Array(seatCount - members.length).fill(null)],
    settings: { mode: "campaign" },
    started: false,
    phase: "waiting",
    chat: [],
  };
  const adapter = createCampaignRoom({
    G,
    Records,
    randomId: () => "battle-" + ++serial,
    randomSeed: () => 13,
    members: () => members,
    planner,
    log: (room, text) => room.log.unshift(text),
  });
  function enter() {
    const preparation = adapter.view(room).preparation;
    for (const member of members.filter(member => preparation.participants.some(p => p.seat === member.seat)))
      adapter.handle(room, member, {
        action: "campaign_enter",
        region: preparation.region,
        preparationId: preparation.id,
        mapId: preparation.mapId || "frontier_1v1",
        delegate: false,
      });
  }
  enter();
  return { room, adapter, members, enter };
}

test("regional re-entry preserves the full battlefield and every actor, including cargo and map effects", () => {
  const { room, adapter, enter } = fixture();
  room.game.round = 7;
  room.game.team = 1;
  const carrier = room.game.units.find((unit) => G.modelOf(unit).prefabId === "Gunperry");
  const passenger = room.game.units.find((unit) => G.modelOf(unit).prefabId === "RGM_79");
  carrier.angle = 123;
  passenger.embarked = {
    carrierId: carrier.id,
    hangarId: G.hangars.of(carrier)[0].id,
    boardRound: 3,
  };
  for (const [index, actor] of room.game.units.entries()) {
    actor.hp -= 100 * (index + 1);
    actor.en -= 10 * (index + 1);
    actor.shield = Math.max(0, actor.shield - 25);
    actor.actionPoints = 3.5;
    actor.weaponUses = { [G.modelOf(actor).weapons[0].id]: 2 };
    actor.skillReadyRound = { EXAM: 11 };
    actor.skillUses = { test: 1 };
    actor.brokenParts = { armL: true };
    actor.burning = { expiresRound: 10, lastDamageRound: 5 };
    actor.apPenaltyNextTurn = 0.25;
    actor.moduleHp = { left: 100 };
    actor.pilot.experience = 1234;
  }
  G.hangars.sync(room.game);
  room.game.smokeFields = [{ x: carrier.x, y: carrier.y, radius: 2, expiresRound: 9 }];
  room.game.beamDiffusionFields = [{ x: carrier.x, y: carrier.y, radius: 4, expiresRound: 11 }];
  room.game.visionAreas = [{ team: 0, x: carrier.x, y: carrier.y, radius: 3, expiresRound: 9 }];
  const expected = Records.clone(room.game);
  const oldLog = [...room.log];
  adapter.checkpoint(room);
  const encounter = room.campaign.encounters[0];
  assert.deepEqual(encounter.battleSave.game, expected);
  for (const actor of expected.units)
    assert.deepEqual(room.campaign.units.find((unit) => unit.id === actor.campaignId).state, actor);
  C.validate(ctx, room.campaign, room.seats);
  room.campaign.phase = "encounters";
  enter();
  assert.deepEqual(
    room.game,
    expected,
    "no unit, field, RNG stream or turn state is rebuilt for a continuing battlefield",
  );
  assert.deepEqual(room.log.slice(1), oldLog);
  assert.equal(room.campaignBattle.stopRound, expected.round + room.campaign.rounds);
});

test("mid-battle campaign export retains escaped units and completed player actions through import", () => {
  const { room, adapter, members, enter } = fixture(["RGM_79", "RGM_79", "MS_06F"]);
  const removed = room.game.units.shift();
  const spawned = {
    ...Records.clone(removed),
    id: removed.id + "-escape-1",
    hp: 1000,
    en: 100,
    x: removed.x + 1,
    angle: 78,
  };
  delete spawned.campaignId;
  room.game.units.push(spawned);
  room.turnDone = [true, false];
  const exported = adapter.handle(room, members[0], { action: "campaign_export" }).save;
  const savedBattle = exported.encounters[0].battleSave;
  assert.equal(exported.units.find((unit) => unit.id === removed.campaignId).destroyed, true);
  assert(savedBattle.game.units.find((unit) => unit.id === spawned.id).campaignId);
  assert.equal(exported.units.find(unit=>unit.id===savedBattle.game.units.find(actor=>actor.id===spawned.id).campaignId).participatedTurn,exported.turn);
  assert.equal(
    room.campaign.units.length,
    3,
    "export must not mutate the running strategic ledger",
  );
  room.campaign = C.validate(ctx, exported, members);
  room.started = false;
  room.campaignBattle = null;
  enter();
  assert.deepEqual(room.game, savedBattle.game);
  assert.deepEqual(room.turnDone, [true, false]);
  assert.equal(room.campaignBattle.stopRound, 11, "resume the original remaining segment rounds");
});

test("a sniper becoming ready at a segment boundary survives save validation and queues once on re-entry", () => {
  const { room, adapter, enter } = fixture(["RGM_79SC", "RGM_79", "MS_06F"]);
  const actor = room.game.units[0],
    target = room.game.units.at(-1);
  const shot = {
    target: target.id,
    weapon: G.modelOf(actor).weapons[0].id,
    aimCell: { x: target.x, y: target.y },
  };
  actor.readySnipe = Records.clone(shot);
  actor.plan = { ...shot, charged: true };
  actor.actionPoints = 0;
  adapter.checkpoint(room);
  assert.equal(room.campaign.encounters[0].battleSave.game.units[0].plan, null);
  C.validate(ctx, room.campaign, room.seats);
  room.campaign.phase = "encounters";
  enter();
  assert.equal(room.game.units[0].readySnipe, undefined);
  assert.equal(room.plans.length, 1);
  assert.equal(room.plans[0].weapon, shot.weapon);
  assert.equal(room.plans[0].target, target.id);
  assert.equal(room.plans[0].charged, true);
  assert.equal(room.game.units[0].actionPoints, 0);
});


test("strategic boarding enters and resumes a real local battle with the same carrier and crew", () => {
  let passengerId, carrierId, pilotId;
  const {room,adapter,enter} = fixture(["Medea","Type61","MS_06F"], (state,members) => {
    const carrier=state.units[0], passenger=state.units[1];
    carrierId=carrier.id; passengerId=passenger.id;
    C.action(ctx,state,members,0,{action:"campaign_pilot_recruit",turn:1,name:"Transport pilot"});
    pilotId=state.pilots[0].profile.id;
    C.action(ctx,state,members,0,{action:"campaign_pilot_assign",turn:1,armyId:passenger.id,pilotId});
    C.action(ctx,state,members,0,{action:"campaign_embark",turn:1,armyId:passenger.id,carrierId:carrier.id,hangarId:"Hangar_1"});
  });
  const passenger=room.game.units.find(u=>u.campaignId===passengerId), carrier=room.game.units.find(u=>u.campaignId===carrierId);
  assert(passenger && carrier);assert.equal(passenger.embarked.carrierId,carrier.id);assert.equal(passenger.pilot.id,pilotId);
  assert.equal(G.hangars.cargo(room.game,carrier).length,1);
  adapter.checkpoint(room);C.validate(ctx,room.campaign,room.seats);
  const saved=room.campaign.encounters[0].battleSave.game.units.find(u=>u.campaignId===passengerId);
  assert.equal(saved.embarked.carrierId,carrier.id);
  room.campaign.phase="encounters";
  enter();assert.equal(room.game.units.find(u=>u.campaignId===passengerId).embarked.carrierId,carrier.id);
});


test("capturing Odessa's local base ends the campaign even with defending survivors", () => {
  const {room,adapter} = fixture(["Gunperry","RGM_79","MS_06F"], null, "odessa", 10);
  const actor = room.game.units.find(u=>u.team===0 && G.modelOf(u).prefabId==="RGM_79");
  const base = room.game.campaignBattlefield.layout.nodes.find(node=>node.kind==="base");
  actor.x=base.x;actor.y=base.y;actor.actionPoints=5;actor.acted=false;
  room.game.team=0;
  for (const enemy of room.game.units.filter(u=>u.team!==actor.team)) { enemy.x=base.x+5;enemy.y=base.y+5; }
  G.campaignBattlefield.capture(G,room.game,actor);
  assert(room.game.units.some(u=>u.team===1 && u.hp>0));
  adapter.checkpoint(room);
  assert.equal(room.campaign.regions.find(r=>r.id==="odessa").owner,0);
  assert.equal(room.campaign.winner,0);
  assert.equal(adapter.view(room).preparation,null);
  assert.equal(C.validate(ctx,room.campaign,room.seats).winner,0);
});


test("local control transfer preserves actor identity, AP, transport links and campaign ownership",()=>{
 const {room,adapter,members,enter}=fixture(["Gunperry","RGM_79","MS_06F"],(state,members)=>members.push({id:"ally",name:"Ally",seat:2}),"canada",10);
 room.phase="idle";
 const carrier=room.game.units.find(u=>G.modelOf(u).prefabId==="Gunperry"),
 passenger=room.game.units.find(u=>G.modelOf(u).prefabId==="RGM_79");
 passenger.embarked={carrierId:carrier.id,hangarId:G.hangars.of(carrier)[0].id};
 const before=structuredClone([carrier,passenger]);
 assert.throws(()=>adapter.transferControl(room,carrier,1,0),/同队/);
 assert.throws(()=>adapter.transferControl(room,carrier,2,1),/总指挥官/);
 carrier.plan={test:true};assert.throws(()=>adapter.transferControl(room,carrier,2,0),/攻击计划/);delete carrier.plan;
 adapter.transferControl(room,carrier,2,0);
 for(const [i,u] of [carrier,passenger].entries()) {
  assert.equal(u.ownerSeat,2);assert.deepEqual({...u,ownerSeat:before[i].ownerSeat},before[i]);
  assert.equal(room.campaign.units.find(a=>a.id===u.campaignId).ownerSeat,2);
 }
 assert.equal(G.controllerOf(room.game,passenger),2);
 assert(room.log.some(line=>line.includes("控制权转交")));
 const exported=adapter.handle(room,members[0],{action:"campaign_export"}).save;
 room.campaign=C.validate(ctx,exported,members);room.started=false;room.campaignBattle=null;enter();
 assert.equal(room.game.units.find(u=>u.id===carrier.id).ownerSeat,2);
 assert.equal(room.game.units.find(u=>u.id===passenger.id).embarked.carrierId,carrier.id);
});


test("ending the final local segment heals reserves once, while battlefield participants keep damage",()=>{
 const {room,adapter}=fixture();
 const reserve=C.addUnit(ctx,room.campaign,0,"jaburo","Type61");
 reserve.state={hp:100,en:0};
 const actor=room.game.units[0];actor.hp=100;actor.en=0;
 assert.equal(room.campaign.units.find(u=>u.id===actor.campaignId).participatedTurn,room.campaign.turn);
 const m=C.model(ctx,reserve);adapter.checkpoint(room);
 assert.equal(room.campaign.turn,2);
 assert.equal(reserve.state.hp,Math.min(m.hp,100+Math.round(m.hp*.3)));
 assert.equal(reserve.state.en,Math.ceil(m.en*.6));
 assert.equal(room.campaign.units.find(u=>u.id===actor.campaignId).state.hp,100);
 assert.doesNotThrow(()=>C.validate(ctx,room.campaign,room.seats));
});


test("returning a local battle to the lobby preserves the remaining segment and all unit state",()=>{
 const {room,adapter,members,enter}=fixture();
 room.phase="idle";room.game.round=4;room.turnDone=[true,false];
 const actor=room.game.units[0];actor.hp=123;actor.en=45;actor.angle=73;actor.actionPoints=2.5;
 const before=structuredClone(room.game),stop=room.campaignBattle.stopRound;
 adapter.suspend(room);
 assert.equal(room.started,false);assert.equal(adapter.view(room).inLobby,true);
 assert.equal(room.campaign.turn,1);assert.equal(room.campaign.encounters[0].resumeStopRound,stop);
 assert.throws(()=>adapter.handle(room,members[1],{action:"campaign_resume"}),/只有房主/);
 adapter.handle(room,members[0],{action:"campaign_resume"});assert.equal(adapter.view(room).inLobby,false);
 enter();assert.deepEqual(room.game,before);assert.deepEqual(room.turnDone,[true,false]);
 assert.equal(room.campaignBattle.stopRound,stop);
});


test("dismissing an archived battlefield unit removes its saved actor before the next encounter",()=>{
 const {room,adapter,members}=fixture();adapter.checkpoint(room);
 const army=room.campaign.units.find(u=>u.team===0&&u.unitId==="RGM_79");
 const encounter=room.campaign.encounters[0];
 assert(encounter.battleSave.game.units.some(u=>u.campaignId===army.id));
 C.action(ctx,room.campaign,members,0,{action:"campaign_dismiss",turn:room.campaign.turn,armyId:army.id});
 assert(!encounter.battleSave.game.units.some(u=>u.campaignId===army.id));
 assert(!Object.values(encounter.roster).includes(army.id));
 assert.doesNotThrow(()=>C.validate(ctx,room.campaign,members));
});


test("local round briefings deduplicate losses, survive saves and add a segment summary",()=>{
  const {room,adapter,members,enter}=fixture();
  const actor=room.game.units.find(u=>G.modelOf(u).prefabId==="RGM_79");
  const cost=G.modelOf(actor).cost;actor.hp=0;
  room.game.round=2;adapter.boundary(room);
  let briefs=room.campaign.history.filter(line=>line.includes("回合简报"));
  assert.equal(briefs.length,1);assert.match(briefs[0],/加拿大西部.*第1回合/);
  assert(briefs[0].includes(`队伍1损失1台/${cost}C`));
  adapter.boundary(room);
  assert.equal(room.campaign.history.filter(line=>line.includes("回合简报")).length,1);
  room.phase="idle";
  const saved=adapter.handle(room,members[0],{action:"campaign_export"}).save;C.validate(ctx,saved,members);
  assert.equal(saved.encounters[0].briefedRound,1);
  assert(saved.encounters[0].briefedDestroyed.includes(actor.campaignId));
  adapter.suspend(room);adapter.handle(room,members[0],{action:"campaign_resume"});enter();
  adapter.boundary(room);
  assert.equal(room.campaign.history.filter(line=>line.includes("回合简报")).length,1);
  room.game.round=3;adapter.boundary(room);
  briefs=room.campaign.history.filter(line=>line.includes("回合简报"));
  assert.equal(briefs.length,2);assert.match(briefs[1],/队伍1损失0台\/0C/);
  adapter.checkpoint(room);
  const summary=room.campaign.history.find(line=>line.includes("阶段简报"));
  assert(summary.includes(`队伍1损失1台/${cost}C`));
  assert.match(summary,/保留战场与损伤/);
  assert.equal(room.campaign.encounters[0].briefedRound,undefined);
});
