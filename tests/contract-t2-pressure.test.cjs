const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/contract-mode'),F=require('../shared/contract-forces');
const {createRoomEngine}=require('../shared/room-engine');
function battle(t,era,n,environment,seed=1936384585){
 let serial=0;const errors=[];
 const engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>seed,aiDelayMs:999999,send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});
 t.after(()=>engine.close());const ws={readyState:1},unitId=environment==='space'?'ColumbusClass':'Medea',model=G.models[unitId+'__standard'];
 engine.join(ws,{mode:'create',room:'PRESSURE',roomMode:'sweep',characterFaction:'PMC',inventory:{[unitId]:1},licenses:{[unitId]:true},storedUnits:[{id:'stock',unitId,kitId:'standard',hp:model.hp,en:model.en}]});
 const room=engine.rooms.get('PRESSURE');
 const act=(action,fields={})=>engine.action(ws,{id:'req'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
 act('configure_room',{...room.settings,sweepEra:era,sweepDifficulty:n,sweepEnvironment:environment,sweepFaction:'ZEON',sweepAlliedFaction:'EFSF'});
 act('start_game',{formation:[{unitId,kitId:'standard',stockId:'stock'}]});act('confirm_formation');
 assert.equal(room.phase,'deployment',errors.join('\n'));assert.deepEqual(errors,[]);
 return room;
}
test('T2 patrol reinforcements retain cumulative rounding and stop at the live cap',t=>{
 const room=battle(t,'UC_0079_T2',6,'ground'),g=room.game;
 room.phase='idle';g.team=0;g.winner=null;g.deployment=g.deployment.map(()=>true);
 for(const u of g.units){if(u.team>0)u.hp=0;else {u.deployed=true;delete u.deploymentStaged;}}
 for(const o of g.contract.objectives)o.status='completed';
 const alive=()=>g.units.filter(u=>u.team>0&&u.hp>0&&!u.facility);
 const cap=C.config(6,'UC_0079_T2').patrolLimit;
 for(let turn=0;turn<160;turn++){g.round+=2;C.poll(room,G);assert(alive().length<=cap);}
 assert.equal(alive().length,cap);
 const before=g.units.length,quota=g.contract.reinforcementBaseCount;
 for(let turn=0;turn<8;turn++){g.round+=2;C.poll(room,G);}
 assert.equal(g.units.length,before);assert.equal(g.contract.reinforcementBaseCount,quota);
 alive()[0].hp=0;
 for(let turn=0;turn<4;turn++){g.round+=2;C.poll(room,G);}
 assert.equal(alive().length,cap);
});
test('same-N T2 pressure is independent of player cost, pilots, rewards and later eras',()=>{
 for(let n=1;n<=6;n++){
  const t1=C.config(n,'UC_0079_T1'),t2=C.config(n,'UC_0079_T2');
  assert.equal(t2.relativePressure,n>=3?1.25:1);assert.equal(t1.relativePressure,1);
  assert.equal(t2.initialEnemyCount,Math.round(t1.initialEnemyCount*(n>=3?1.25:1)));
  assert.equal(t2.patrolLimit,Math.floor(t2.initialEnemyCount*1.5));
 }
 assert.deepEqual([3,4,5,6].map(n=>C.config(n,'UC_0079_T2').costLimit),[9000,13500,18000,22500]);
 for(const era of ['CE_0071_T1','UC_0087_T1','UC_0087_T2','UC_0093_T1'])assert.equal(F.eraPressure(era),1);
 for(const n of [3,4,5,6])for(const players of [1,3,5]){
  const room={settings:{sweepDifficulty:n,sweepEra:'UC_0079_T2'},game:{contract:{players}}};
  const expected=Math.round(1000*(1+.25*(players-1))*F.difficultyScale(n)*1.25/25)*25;
  assert.equal(F.budget(room,1000),expected);assert.equal(F.budget(room,1000,true),expected);
 }
});
test('actual T2 spawns apply pressure once, retain native HP and allow partial final squads',t=>{
 for(const environment of ['ground','space'])for(const n of [3,4,5,6])for(const era of ['UC_0079_T1','UC_0079_T2']){
  if(environment==='space'&&era==='UC_0079_T1')continue; // No T1 space contract in the current lobby.
  const room=battle(t,era,n,environment),enemies=room.game.units.filter(u=>u.team>0&&!u.facility&&!G.modelOf(u).facility);
  assert.equal(enemies.length,C.config(n,era).initialEnemyCount,`${era} ${environment} N${n}`);
  for(const u of enemies)assert.equal(u.hp,G.modelOf(u).hp);
 }
});
