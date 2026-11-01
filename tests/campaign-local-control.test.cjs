const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js"), C = require("../shared/campaign.js");
const {createRoomEngine} = require("../shared/room-engine.js");

test("local control transfers enforce ownership and revision, deduplicate requests and preserve AP", t => {
  let serial=0;
  const errors=[];
  const engine=createRoomEngine({rules:G,randomId:()=>"control-"+(++serial),randomSeed:()=>1,
    randomToken:()=>"token-"+(++serial),send:(socket,message)=>{if(message.code) errors.push(message.code);}});
  t.after(()=>engine.close());
  const sockets=Array.from({length:4},()=>({readyState:1}));
  engine.join(sockets[0],{mode:"create",room:"CONTROL",characterFaction:"PMC",licenses:{Type61:true}});
  const room=engine.rooms.get("CONTROL");
  const act=(seat,action,fields={})=>engine.action(sockets[seat],{
    id:"request-"+(++serial),revision:room.revision,matchId:room.matchId,round:room.game.round,action,...fields});
  act(0,"configure_room",{...G.defaultRoomSettings(),mapId:"crossroads_2v2",fogMode:"disabled"});
  for(const socket of sockets.slice(1)) engine.join(socket,{mode:"join",room:room.code,characterFaction:"PMC",licenses:{Type61:true}});
  const formation=[{unitId:"Type61",kitId:"standard"}];
  for(let seat=0;seat<4;seat++) act(seat,"set_ready",{ready:true,formation});
  act(0,"start_game",{formation});
  for(let seat=0;seat<4;seat++) act(seat,"confirm_formation");
  for(let seat=0;seat<4;seat++) act(seat,"confirm_deployment");
  room.campaign=C.create({G,world:G.catalog.scenarios.earth_0079_mid.world,
    production:require("../shared/production-data.cjs"),development:require("../shared/development.js")},[...room.members.values()]);
  room.campaign.units=[];
  room.settings.mode="campaign";
  room.campaignBattle={region:"canada_east",delegatedSeats:[],startRound:1,stopRound:99};
  const actor=room.game.units.find(u=>G.ownerOf(u)===2);
  const army=C.addUnit({G,production:require("../shared/production-data.cjs")},room.campaign,2,"canada_east","Type61");
  actor.campaignId=army.id;
  engine.broadcast(room);
  const before=structuredClone(actor), revision=room.revision;
  assert.throws(()=>act(1,"unit_control_transfer",{unitId:actor.id,to:0}),/不是你的回合|不能操作/);
  assert.throws(()=>act(2,"unit_control_transfer",{unitId:actor.id,to:1}),/同队/);
  act(2,"unit_control_transfer",{unitId:actor.id,to:0,revision:revision-1});
  assert(errors.includes("STALE"));assert.deepEqual(actor,before);
  const fields={unitId:actor.id,to:0,id:"one-transfer"};
  act(2,"unit_control_transfer",fields);
  const committed=room.revision;
  act(2,"unit_control_transfer",fields);
  assert.equal(room.revision,committed);assert.equal(army.ownerSeat,0);
  assert.deepEqual({...actor,ownerSeat:before.ownerSeat},before);
  assert.equal(G.canControlUnit(room.settings,[...room.members.values()],2,actor),false);
  assert.throws(()=>act(2,"unit_control_transfer",{unitId:actor.id,to:2}),/不能操作|不是你的回合/);
});
