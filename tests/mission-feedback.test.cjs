const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),M=require('../shared/mission-mode');
function fixture(seed=7319){
  const settings=M.settings(G,'mission_sleepless_raid');
  const host={id:'host',seat:0,ws:{readyState:1}};
  const formations=Array(10).fill(null);
  formations[0]=[{unitId:'FatUncle',kitId:'standard'},{unitId:'MS_06F',kitId:'machine_gun',preload:{carrierIndex:0,hangarId:'Hangar_1'}}];
  const room={settings,hostId:host.id,members:new Map([[host.id,host]]),seats:[host],started:true,phase:'idle',game:G.create(false,seed,formations,false,settings)};
  M.initialize(room,G);const logs=[];
  const poll=()=>{M.poll(room,G,s=>logs.push(s));assert.equal(room.game.mission.error,null);};
  const round=n=>{room.game.round=n;poll();};
  const kill=group=>{for(const u of room.game.units.filter(u=>u.missionGroup===group))u.hp=0;poll();};
  const extract=()=>{for(const u of room.game.units.filter(u=>u.team===0&&!u.embarked))Object.assign(u,{x:4,y:29});poll();};
  return {room,poll,round,kill,extract,logs};
}
test('night raid selects exactly three deterministic targets from five and keeps them stationary',()=>{
  const f=fixture();f.poll();
  assert.equal(f.room.settings.costLimit,5000);
  assert.equal(G.getMap(f.room.settings.mapId).mission.fleetLimit,2);
  const targets=f.room.game.units.filter(u=>u.missionGroup==='targets');
  assert.equal(targets.length,3);assert(targets.every(u=>u.missionStationary&&u.moved));
  assert.deepEqual(f.room.game.mission.selectedActors,fixture().room.game.mission.selectedActors);
  const selections=new Set(Array.from({length:12},(_,i)=>fixture(i+1).room.game.mission.selectedActors.join(',')));
  assert(selections.size>1);
  assert.equal(f.room.game.units.filter(u=>u.missionGroup==='guards').length,28);
  assert.equal(M.objectives(f.room.game,G).victory[0].total,3);
});
test('night raid spawns air support once, extends deadline once and dawn still arrives on round 30',()=>{
  const f=fixture();f.round(10);
  assert.equal(f.room.game.units.filter(u=>u.missionGroup==='air').length,8);
  f.room.game.units.find(u=>u.missionActor==='commander').hp=0;f.poll();f.poll();
  assert.equal(f.room.game.mission.deadlineRound,50);
  assert.equal(f.room.game.units.filter(u=>u.missionGroup==='reinforcements').length,21);
  f.round(29);assert.equal(f.room.game.climateSettings.dayNight,'late_night');
  f.round(30);assert.equal(f.room.game.climateSettings.dayNight,'dawn');
  f.round(50);assert.equal(f.room.game.winner,null);
  f.round(51);assert.equal(f.room.game.winner,1);assert.equal(M.technologyReward(f.room,G),0);
});
test('night raid deadline includes round 30 and fails on round 31 without commander kill',()=>{
  const f=fixture();f.round(30);assert.equal(f.room.game.winner,null);
  f.round(31);assert.equal(f.room.game.winner,1);
});
test('target kills open extraction once, all living units including loaded cargo must extract',()=>{
  const f=fixture();f.kill('targets');
  assert.equal(f.room.game.mission.extractionOpen,true);
  assert.equal(f.room.game.units.filter(u=>u.missionActor==='extraction-uncle').length,1);
  assert.equal(f.room.game.winner,null);
  const cargo=f.room.game.units.find(u=>u.embarked);assert(cargo);
  f.extract();assert.equal(f.room.game.winner,0);
  assert.deepEqual(M.reward(f.room,G),{money:6000,supplies:8000,inventory:{MS_08TX:3,MS_09:6}});
  assert.equal(M.technologyReward(f.room,G),1000);
});
test('all enemies bonus requires both reinforcement waves and is only granted on extraction',()=>{
  const f=fixture();f.kill('guards');f.kill('targets');
  assert(!f.room.game.mission.fired.includes('all-enemies-cleared'));
  f.kill('reinforcements');f.round(10);f.kill('air');
  assert(f.room.game.mission.fired.includes('all-enemies-cleared'));
  assert.equal(f.room.game.winner,null);
  f.extract();assert.equal(f.room.game.winner,0);
  assert.equal(M.technologyReward(f.room,G),1500);
  assert.deepEqual(M.reward(f.room,G),{money:9000,supplies:12500,inventory:{MS_08TX:3,MS_09:6,MS_14G:3,MS_06F2:6}});
});
test('PMC extinction takes priority over target completion or extraction',()=>{
  const f=fixture();for(const u of f.room.game.units.filter(u=>!u.missionActor))u.hp=0;
  f.kill('targets');assert.equal(f.room.game.winner,1);assert.equal(M.technologyReward(f.room,G),0);
});

test('scripted convoy automatically responds through real reaction authority without delegating PMC',async(t)=>{
  const {createRoomEngine}=require('../shared/room-engine');
  const {createAttackPlanner}=require('../shared/attack-plans');
  let seq=0;const ws={readyState:1},frames=[];
  const engine=createRoomEngine({rules:G,randomId:()=>`convoy-${++seq}`,randomToken:()=>`t-${++seq}`,randomSeed:()=>7319,aiDelayMs:20,send:(_,s)=>frames.push(s)});
  t.after(()=>engine.close());
  engine.join(ws,{mode:'create',room:'CONVOY',roomMode:'mission',characterFaction:'PMC',inventory:{Medea:5},licenses:{Medea:true}});
  const room=engine.rooms.get('CONVOY');
  const act=(action,fields={})=>engine.action(ws,{id:`req-${++seq}`,revision:room.revision,round:room.game.round,matchId:room.matchId,action,...fields});
  act('configure_room',{mapId:'mission_no_fool',costLimit:2000,unitLimit:18});
  act('start_game',{formation:[{unitId:'Medea',kitId:'standard'}]});act('confirm_formation');
  G.aiDeployment(room.game,0);act('confirm_deployment');
  const convoy=room.game.units.find(u=>u.missionEscort);
  assert(convoy);assert(!G.canControlUnit(room.settings,[...room.members.values()],0,convoy));
  room.game.round=3;engine.broadcast(room);
  const enemy=room.game.units.find(u=>u.missionActor==='zaku-one-0-0');
  assert(enemy);
  delete enemy.embarked;delete enemy.deploymentStaged;enemy.x=convoy.x+2;enemy.y=convoy.y;enemy.acted=false;enemy.moved=false;
  room.game.team=1;
  const planner=createAttackPlanner(G,()=>`reaction-${++seq}`);
  planner.reset(room);
  const weapon=G.modelOf(enemy).weapons.find(w=>w.kind==='shooting') || G.modelOf(enemy).weapons[0];
  planner.plan(room,enemy,convoy,weapon,G.ownerOf(enemy),'shooting',true);
  planner.prepare(room);assert(room.reactions.length>0);
  room.phase='reaction';engine.broadcast(room);
  const start=Date.now();
  while(room.phase==='reaction'&&Date.now()-start<3000)await new Promise(r=>setTimeout(r,25));
  assert.notEqual(room.phase,'reaction',JSON.stringify(frames.at(-1)?.error));
  assert.equal(room.seats[0].delegated,undefined);
  assert(!G.canControlUnit(room.settings,[...room.members.values()],0,convoy));
});
