const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js"), C = require("../shared/campaign.js");
const { createRoomEngine } = require("../shared/room-engine.js");
test("orphan controllers fall back to the team commander and return when their seat is occupied",()=>{
  const members=[{seat:2,bot:true},{seat:1},{seat:null}];
  const unit={ownerSeat:0,team:0};
  assert.equal(C.controller(members,unit),2);
  assert.equal(C.controller([...members,{seat:0}],unit),0);
  assert.equal(C.controller([{seat:1}],unit),null);
  assert.equal(unit.ownerSeat,0);
});
test("an AI commander actually moves an orphaned army through the normal action pipeline",async(t)=>{
  let serial=0; const moves=[];
  const engine=createRoomEngine({rules:G,randomId:()=>"commander-"+(++serial),randomSeed:()=>1,
    randomToken:()=>"token-"+(++serial),aiDelayMs:30,randomAIMoveDelay:()=>0,
    send:(ws,frame)=>{ if(frame.lastEvent?.type==="move"&&!moves.some(e=>e.id===frame.lastEvent.id)) moves.push(frame.lastEvent); }});
  t.after(()=>engine.close());
  const sockets=Array.from({length:4},()=>({readyState:1}));
  engine.join(sockets[0],{mode:"create",room:"COMMANDERS",characterFaction:"PMC",licenses:{Type61:true}});
  const room=engine.rooms.get("COMMANDERS");
  const act=(seat,action,fields={})=>engine.action(sockets[seat],{id:"act-"+(++serial),revision:room.revision,
    round:room.game.round,action,...fields});
  act(0,"configure_room",{...G.defaultRoomSettings(),mapId:"crossroads_2v2",fogMode:"disabled"});
  for(const socket of sockets.slice(1)) engine.join(socket,{mode:"join",room:room.code,characterFaction:"PMC",licenses:{Type61:true}});
  const formation=[{unitId:"Type61",kitId:"standard"}];
  for(let seat=0;seat<4;seat++) act(seat,"set_ready",{ready:true,formation});
  act(0,"start_game",{formation});
  for(let seat=0;seat<4;seat++) act(seat,"confirm_formation");
  for(let seat=0;seat<4;seat++) act(seat,"confirm_deployment");
  const members=[...room.members.values()];
  room.campaign=C.create({G,world:G.catalog.scenarios.earth_0079_mid.world,
    production:require("../shared/production-data.cjs"),development:require("../shared/development.js")},members);
  room.settings.mode="campaign";
  room.campaignBattle={region:"canada_east",delegatedSeats:[],startRound:1,stopRound:99};
  room.seats[0].seat=null;room.seats[0]=null;room.seats[2].bot=true;
  room.game.tiles.forEach(row=>row.fill("plain"));
  for(const unit of room.game.units) Object.assign(unit,{x:unit.team===0?5:25,y:5+Math.floor(G.ownerOf(unit)/2)*8});
  room.turnNotBefore=0;room.revision++;engine.broadcast(room);
  assert.equal(room.game.campaignControllers[0],2);
  assert(G.hasActions(room.game,2));
  const until=Date.now()+3000;
  while(!moves.some(e=>e.unitId===room.game.units.find(u=>G.ownerOf(u)===0).id)&&Date.now()<until)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert(moves.some(e=>e.unitId===room.game.units.find(u=>G.ownerOf(u)===0).id));
  assert.equal(G.ownerOf(room.game.units.find(u=>G.ownerOf(u)===0)),0);
});
