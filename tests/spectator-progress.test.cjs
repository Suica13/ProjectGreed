const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules"),{createRoomEngine}=require("../shared/room-engine");
function fixture(t) {
  let sequence=0;const frames=new Map();
  const engine=createRoomEngine({rules:G,randomId:()=>"view-"+(++sequence),randomToken:()=>"token-"+(++sequence),randomSeed:()=>1,aiDelayMs:999999,send:(ws,m)=>frames.set(ws,m)});
  t.after(()=>engine.close());
  const players=[{readyState:1},{readyState:1}],observer={readyState:1};
  engine.join(players[0],{mode:"create",room:"WATCH",roomMode:"quick",characterFaction:"PMC",licenses:{RGM_79:true}});
  engine.join(players[1],{mode:"join",room:"WATCH",characterFaction:"PMC",licenses:{RGM_79:true}});
  engine.join(observer,{mode:"join",room:"WATCH",characterFaction:"PMC"});
  const room=engine.rooms.get("WATCH");
  const act=(ws,action,fields={})=>engine.action(ws,{id:"req-"+(++sequence),revision:room.revision,matchId:room.matchId,round:room.game.round,phase:room.phase,reactionId:frames.get(ws)?.pending?.id,action,...fields});
  act(players[0],"configure_room",{...room.settings,battleMode:"quick",formationStyle:"free",technologyLimitMode:"custom",technologyLimit:999999,costLimit:5000,unitCostLimit:99999,fogMode:"disabled"});
  const formation=[{unitId:"RGM_79",kitId:"machine_gun"}];
  act(players[1],"set_ready",{ready:true,formation});
  act(players[0],"start_game",{formation});
  for(const ws of players)act(ws,"confirm_formation");
  for(const ws of players)act(ws,"confirm_deployment");
  room.game.tiles.forEach(row=>row.fill("plain"));
  room.game.units.forEach(u=>Object.assign(u,{x:u.team?4:2,y:4,hp:100000,shield:0}));
  const combat=()=>{
    act(players[0],"attack",{unitId:"0-0",targetId:"1-0",weaponId:"EF_90mmMG"});
    act(players[0],"end_turn");act(players[1],"respond",{response:"defend"});
    assert.equal(room.phase,"playback");return room.playback.id;
  };
  return {engine,room,players,observer,act,combat,frames};
}
test("connected, disconnected and reconnecting spectators never block turns; participant acknowledgements still gate",t=>{
  const {engine,room,players,observer,act,combat,frames}=fixture(t);
  const batchId=combat();
  assert.equal(room.playback.members.length,2);
  assert(!room.playback.members.includes(observer.memberId));
  assert.equal(frames.get(observer).playback.id,batchId,"observers still receive combat animation");
  act(observer,"playback_ready",{batchId});
  assert.deepEqual(room.playback.ready,[]);
  engine.disconnect(observer);
  act(players[0],"playback_ready",{batchId});
  assert.equal(room.phase,"playback");
  act(players[1],"playback_ready",{batchId});
  assert.equal(room.phase,"idle");assert.equal(room.game.team,1);
  const reconnected={readyState:1};
  engine.join(reconnected,{mode:"resume",room:"WATCH",characterFaction:"PMC",token:room.members.get(observer.memberId).token});
  assert.equal(reconnected.memberId,observer.memberId);
  assert.equal(room.phase,"idle");
});
test("a disconnected participant retains their playback requirement",t=>{
  const {engine,room,players,combat,act}=fixture(t);
  const batchId=combat();engine.disconnect(players[1]);
  act(players[0],"playback_ready",{batchId});
  assert.equal(room.phase,"playback");assert(room.playback.members.includes(players[1].memberId));
});
test("a disconnected spectator host hands authority to an active participant immediately",t=>{
  const {engine,room,players,observer}=fixture(t);
  room.hostId=observer.memberId;
  engine.disconnect(observer);
  assert.equal(room.hostId,players[0].memberId);
  assert.equal(room.phase,"idle");
});
test("older batches prune stale spectator waiters and still start the result countdown",t=>{
  const {engine,room,players,observer,combat,act}=fixture(t);
  const batchId=combat();room.playback.members.push(observer.memberId);
  room.game.winner=0;
  act(players[0],"playback_ready",{batchId});
  act(players[1],"playback_ready",{batchId});
  assert.equal(room.phase,"finished");assert(room.returnAt>Date.now());
});
test("irradiation uses the same participant-only barrier",t=>{
  const {room,players,observer,act,frames}=fixture(t),u=room.game.units[0];
  u.model=Object.keys(G.models).find(id=>G.models[id].prefabId==="RX_78_4_Bst");
  Object.assign(u,{x:3,y:8,en:G.modelOf(u).en,acted:false,actionPoints:5});
  const skill=G.unitSkills(u).find(s=>s.type==="irradiation");
  act(players[0],"skill",{unitId:u.id,skillId:skill.id,x:4,y:8});
  assert.equal(room.phase,"playback");assert(room.playback.skillEffect);
  assert.equal(room.playback.members.length,2);
  assert(!room.playback.members.includes(observer.memberId));
  assert(frames.get(observer).playback.skillEffect);
  const batchId=room.playback.id;
  for(const ws of players)act(ws,"playback_ready",{batchId});
  assert.equal(room.phase,"idle");
});
test("AI-only playback is delivered once and advances without spectator acknowledgement",async t=>{
  const {engine,room,players,observer,combat,frames}=fixture(t);
  combat();
  for(const ws of players) {const member=room.members.get(ws.memberId);room.seats[member.seat]=null;member.seat=null;}
  room.turnDone=room.turnDone.map(()=>true);
  room.playback.resumeTurn=true;
  engine.broadcast(room);
  assert.equal(frames.get(observer).phase,"playback");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(room.phase,"idle");assert.equal(room.playback,null);
});
