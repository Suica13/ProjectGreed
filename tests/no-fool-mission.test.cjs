const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),M=require('../shared/mission-mode');
function fixture() {
  const settings=M.settings(G,'mission_no_fool');
  const host={id:'host',seat:0,ws:{readyState:1}};
  const formations=Array(10).fill(null);
  formations[0]=[{unitId:'Medea',kitId:'standard'}];
  const room={settings,hostId:host.id,members:new Map([[host.id,host]]),seats:[host],
    started:true,phase:'idle',game:G.create(false,7319,formations,false,settings)};
  M.initialize(room,G);
  const logs=[];
  const poll=()=>M.poll(room,G,s=>logs.push(s));
  const round=n=>{
    room.game.round=n;room.game.team=0;
    for(const u of room.game.units){u.moved=false;u.acted=false;}
    poll();
  };
  return {room,logs,poll,round,escort:()=>room.game.units.find(u=>u.missionActor==='bigtray')};
}
test('escort map uses T1, 2000 COST, three carrier standard formation and a continuous road',()=>{
  const f=fixture(),map=G.getMap(f.room.settings.mapId);
  assert.equal(f.room.settings.missionEra,'UC_0079_T1');
  assert.equal(f.room.settings.costLimit,2000);
  assert.equal(G.armyRestrictions(f.room.settings,{seat:0}).fleetLimit,3);
  assert.equal(map.environment,'ground');
  assert(!G.canControlUnit(f.room.settings,[{seat:0}],0,f.escort()));
  const road=map.tileMap.layers.find(l=>l.id==='terrain_roads');
  for(let x=4;x<=33;x++)assert(road.data[11*map.width+x]);
});
test('escort advances once per displayed round across real team handoffs, arrives at 15 and holds two rounds',()=>{
  const f=fixture();
  for(let n=1;n<=17;n++){
    f.poll();
    assert.equal(f.room.game.round,n);
    assert.equal(f.room.game.mission.error,null);
    assert.equal(f.escort().x,4+Math.min(n,15)*2);
    const x=f.escort().x;f.poll();assert.equal(f.escort().x,x);
    assert.equal(f.room.game.winner,n===17?0:null);
    // This case isolates an unobstructed convoy route from enemy combat.
    for(const u of f.room.game.units.filter(u=>u.team===1))u.y=3;
    if(n<17)G.end(f.room.game);
  }
  assert.equal(f.room.game.mission.escort.arrivedRound,15);
  assert.deepEqual(M.reward(f.room,G),{money:4000,supplies:6000,inventory:{RGM_79_G:3}});
});
test('round two support and all three reinforcement waves have correct squads, cargo and counts',()=>{
  const f=fixture();
  f.round(1);assert.equal(f.room.game.units.length,2);
  f.round(2);
  const support=f.room.game.units.filter(u=>u.missionGroup==='air-support');
  assert.equal(support.length,6);
  assert.equal(new Set(support.map(u=>u.squadId)).size,2);
  for(const n of [3,6,10]){f.round(n);assert.equal(f.room.game.mission.error,null);}
  const units=f.room.game.units;
  assert.equal(units.filter(u=>u.missionGroup==='wave-one').length,10);
  assert.equal(units.filter(u=>u.missionGroup==='wave-two').length,10);
  assert.equal(units.filter(u=>u.missionGroup==='wave-three').length,6);
  const goal=G.getMap('mission_no_fool').mission.victory;
  assert(units.filter(u=>u.missionGroup==='wave-three').every(u=>
    u.x>=goal.x && u.x<goal.x+goal.width && u.y>=goal.y && u.y<goal.y+goal.height));
  const zakus=units.filter(u=>u.missionActor?.startsWith('zaku-'));
  assert.equal(zakus.length,9);assert(zakus.every(u=>u.embarked));
  for(const carrier of units.filter(u=>u.model==='FatUncle__standard'))
    assert.equal(G.hangars.cargo(f.room.game,carrier).length,3);
  const efreets=units.filter(u=>u.missionActor?.startsWith('efreet-'));
  assert.equal(efreets.length,3);assert(efreets.every(u=>u.embarked?.exposed));
  const count=units.length;f.poll();assert.equal(f.room.game.units.length,count);
});
test('empty opening and clearing the first wave do not skip later ambushes; all enemies grants hidden victory',()=>{
  const f=fixture();f.round(1);assert.equal(f.room.game.winner,null);
  f.round(3);f.room.game.units.filter(u=>u.team===1).forEach(u=>u.hp=0);f.poll();
  assert.equal(f.room.game.winner,null);
  f.round(6);f.round(10);
  f.room.game.units.filter(u=>u.team===1).forEach(u=>u.hp=0);f.poll();
  assert.equal(f.room.game.winner,0);
  assert(f.room.game.mission.fired.includes('all-enemies-cleared'));
  assert.deepEqual(M.reward(f.room,G),{money:5500,supplies:8250,inventory:{RGM_79_G:3,RX_79_G:1,MS_07H:2}});
  f.poll();assert.equal(f.room.game.mission.fired.filter(id=>id==='all-enemies-cleared').length,1);
});
test('destroyed convoy or PMC extinction wins precedence over arrival and extermination',()=>{
  for(const key of ['escort','pmc']){
    const f=fixture();f.round(1);
    if(key==='escort')f.escort().hp=0;
    else f.room.game.units.filter(u=>!u.missionActor).forEach(u=>u.hp=0);
    f.round(17);assert.equal(f.room.game.winner,1);
    assert.deepEqual(M.reward(f.room,G),{money:0,supplies:0,inventory:{}});
  }
});
test('blocked road pauses escort without consuming further steps or moving twice in one round',()=>{
  const f=fixture(),block=f.room.game.units.find(u=>!u.missionActor);
  Object.assign(block,{x:6,y:11});f.round(1);
  assert.equal(f.escort().x,4);assert.equal(f.room.game.mission.escort.step,0);
  Object.assign(block,{x:3,y:4});f.poll();assert.equal(f.escort().x,4);
  f.round(2);assert.equal(f.escort().x,6);
});
