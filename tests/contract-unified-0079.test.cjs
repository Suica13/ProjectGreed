const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/contract-mode'),F=require('../shared/contract-forces'),T=require('../shared/contact-tasks');
const {createRoomEngine}=require('../shared/room-engine');
function battle(n,environment,faction='ZEON',seed=1936384585){
 let serial=0;const errors=[];
 const engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>seed,aiDelayMs:999999,send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});
 const ws={readyState:1},unitId=environment==='space'?'ColumbusClass':'Medea',model=G.models[unitId+'__standard'];
 engine.join(ws,{mode:'create',room:'UNIFIED',roomMode:'sweep',characterFaction:'PMC',inventory:{[unitId]:1},licenses:{[unitId]:true},storedUnits:[{id:'stock',unitId,kitId:'standard',hp:model.hp,en:model.en}]});
 const room=engine.rooms.get('UNIFIED');
 const act=(action,fields={})=>engine.action(ws,{id:'req'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
 try{
 act('configure_room',{...room.settings,sweepEra:'UC_0079_T1',sweepDifficulty:n,sweepEnvironment:environment,sweepFaction:faction,sweepAlliedFaction:faction==='NONE'?'NONE':faction==='ZEON'?'EFSF':'ZEON'});
 act('start_game',{formation:[{unitId,kitId:'standard',stockId:'stock'}]});act('confirm_formation');
 assert.deepEqual(errors,[]);assert.equal(room.phase,'deployment');return {room,close:()=>engine.close()};
 }catch(e){engine.close();throw e;}
}
test('unified ladder has a fixed fleet cap, population plateau and finite rewards',()=>{
 assert.equal(C.difficulties.length,10);
 assert.deepEqual(C.difficulties.map(d=>C.config(d.id).initialEnemyCount),[9,12,18,24,30,30,30,30,30,33]);
 for(let n=1;n<=10;n++){
  const d=C.config(n);assert.equal(d.fleetLimit,5);assert.equal(d.events,Math.min(n,5));
  const settings={mode:'sweep',sweepEra:'UC_0079_T1',sweepDifficulty:n};
  const allowed=G.armyRestrictions({...G.defaultRoomSettings(),...settings},{}).allowedEras;
  assert.deepEqual(allowed,['UC_0079_T1','UC_0079_T2','CE_0071_T1','AD_2307_T1']);
  const reward=C.reward({settings,game:{contract:{objectives:Array.from({length:d.events},()=>({status:'completed'}))}}},G);
  for(const k of ['money','supplies','technology','experience'])assert(Number.isFinite(reward[k])&&reward[k]>0);
 }
});
test('ground formations gradually replace T1 with T2 without changing per-head population budgets',()=>{
 for(const faction of ['EFSF','ZEON'])for(let n=5;n<=10;n++){
  const s={sweepEra:'UC_0079_T1',sweepEnvironment:'ground',sweepFaction:faction,sweepDifficulty:n};
  const formations=F.formations(s,G),total=formations.reduce((a,f)=>a+f.weight,0);
  const late=formations.filter(f=>f.kits.every(k=>k.every(m=>m.tags.includes('UC_0079_T2')&&!m.tags.includes('UC_0079_T1'))));
  assert(Math.abs(late.reduce((a,f)=>a+f.weight,0)/total-F.t2Share(n))<1e-9);
  assert(formations.every(f=>f.budget===f.units.length*25));
 }
});
for(const environment of ['ground','space'])for(const faction of ['EFSF','ZEON'])test(`real authority population and era checks ${environment} ${faction}`,()=>{
 const rows=[];
 for(let n=1;n<=10;n++){
  const f=battle(n,environment,faction);
  try{const enemies=f.room.game.units.filter(u=>u.team>0&&!u.facility&&!G.modelOf(u).facility);
   assert.equal(enemies.length,C.config(n).initialEnemyCount,`N${n}`);
   if(n<=5)assert(enemies.every(u=>G.modelOf(u).tags.includes('UC_0079_T1')));
   rows.push({n,count:enemies.length,t2:enemies.filter(u=>G.modelOf(u).tags.includes('UC_0079_T2')).length,cost:Math.round(enemies.reduce((s,u)=>s+G.modelOf(u).cost,0)/enemies.length)});
   for(const u of enemies)assert.equal(u.hp,G.modelOf(u).hp);
  }finally{f.close();}
 }
 console.log(environment,faction,JSON.stringify(rows));
});
test('contact gates use unified 0079 and retain accepted progress',()=>{
 for(const [first,last] of [['efsf-17','efsf-28'],['zeon-13','zeon-21'],['anaheim-7','anaheim-12']]){
  assert.equal(T.byId.get(first).difficulty,5);
  assert.equal(T.byId.get(last).difficulty,10);
 }
 for(const t of T.tasks.filter(t=>!t.missionId&&t.era==='UC_0079_T1')){
  assert(t.difficulty>=1&&t.difficulty<=10);
  const settings={mode:'sweep',sweepEra:'UC_0079_T1',sweepFaction:t.enemyFaction||'ZEON',sweepEnvironment:t.environment||'ground',sweepDifficulty:t.difficulty};
  assert(T.eligible(t,settings),t.id);
  assert(!T.eligible(t,{...settings,sweepDifficulty:t.difficulty-1}),t.id);
  const saved={id:t.id,status:'accepted',progress:Math.min(1,t.required),...(t.progressVersion?{progressVersion:t.progressVersion}:{})};
  assert.equal(T.normalize([saved])[0].progress,saved.progress);
 }
});
test('N10 intervention adds ten percent after the intervention population multiplier',()=>{
 const counts=[];for(const n of [5,10]){const f=battle(n,'ground','NONE');try{counts.push(f.room.game.units.filter(u=>u.team>0&&!u.facility&&!G.modelOf(u).facility).length);}finally{f.close();}}
 assert.equal(counts[1],Math.round(counts[0]*1.1));
});
test('ordinary patrols obey the plateau live cap and resume after losses',()=>{
 for(const n of [5,6,9,10]){const f=battle(n,'ground');try{
  const {room}=f,g=room.game;room.phase='idle';g.team=0;g.winner=null;g.deployment=g.deployment.map(()=>true);
  for(const u of g.units){if(u.team>0)u.hp=0;else{u.deployed=true;delete u.deploymentStaged;}}
  for(const o of g.contract.objectives)o.status='completed';
  const alive=()=>g.units.filter(u=>u.team>0&&u.hp>0&&!u.facility);
  const cap=C.config(n).patrolLimit;
  for(let turn=0;turn<80;turn++){g.round+=2;C.poll(room,G);assert(alive().length<=cap);}
  const before=alive().length;assert(before>=cap-2);
  for(const u of alive().slice(0,6))u.hp=0;
  for(let turn=0;turn<16;turn++){g.round+=2;C.poll(room,G);}
  assert(alive().length>before-6);assert(alive().length<=cap);
 }finally{f.close();}}
});
