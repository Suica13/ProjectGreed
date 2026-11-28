const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/contact-tasks'),K=require('../shared/contract-mode'),{createRoomEngine}=require('../shared/room-engine');
function fixture(t,number){
 const task=C.byId.get('efsf-'+number);let serial=0;const errors=[];
 const engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>1936384585,aiDelayMs:999999,send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});t.after(()=>engine.close());
 const ws={readyState:1},unitId=task.environment==='space'?'ColumbusClass':'Medea',model=G.models[unitId+'__standard'],formation=[{unitId,kitId:'standard',stockId:'stock'}];
 engine.join(ws,{mode:'create',room:'TEST'+number,roomMode:'sweep',characterFaction:'PMC',contactTasks:[{id:task.id,status:'accepted',progressVersion:3}],inventory:{[unitId]:5},licenses:{[unitId]:true},storedUnits:[{id:'stock',unitId,kitId:'standard',hp:model.hp,en:model.en}]});
 const room=engine.rooms.get('TEST'+number),act=(action,fields={})=>engine.action(ws,{id:'req'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
 act('configure_room',{...room.settings,sweepEra:task.era,sweepEnvironment:task.environment||'ground',sweepDifficulty:task.difficulty,sweepFaction:task.enemyFaction||'ZEON',sweepAlliedFaction:task.enemyFaction==='NONE'?'NONE':task.enemyFaction==='EFSF'?'ZEON':'EFSF'});
 act('start_game',{formation});act('confirm_formation');assert.equal(room.phase,'deployment',errors.join('\n'));
 act('auto_place_deployment');act('confirm_deployment');
 const player=room.game.units.find(u=>u.team===0&&!u.contractAlly),objective=room.game.contract.objectives.find(o=>o.contactTaskId===task.id);
 return {room,task,player,objective,act};
}
test('every ordinary federal task can be entered in contract mode with its authored event',t=>{
 for(const task of C.tasks.filter(t=>t.contactId==='efsf'&&!t.missionId)){
  const f=fixture(t,task.number);assert(K.commissionProgress(f.room,G,f.room.seats[0]));
  if(task.kind!=='kills')assert(f.objective,task.id);assert(C.eligible(task,f.room.settings));
 }
});
test('recon records live targets, escort has an actual exit route, Kashin damage invalidates completion',t=>{
 const f=fixture(t,16);for(const id of f.objective.targets){const target=f.room.game.units.find(u=>u.id===id);Object.assign(f.player,{x:target.x-1,y:target.y});K.poll(f.room,G);}assert.equal(f.objective.status,'completed');
 const e=fixture(t,22),ship=e.room.game.units.find(u=>u.id===e.objective.protected[0]);Object.assign(e.player,{x:ship.x-1,y:ship.y});K.poll(e.room,G);assert.equal(e.objective.status,'active');assert(K.aiOrder(e.room.game,G,ship).goal);Object.assign(ship,{x:e.objective.exit.x+2,y:e.objective.exit.y+2});K.poll(e.room,G);assert.equal(e.objective.status,'completed');
 const k=fixture(t,26);for(const id of k.objective.targets)k.room.game.units.find(u=>u.id===id).hp=0;k.room.game.units.find(u=>u.id===k.objective.forbidDamage[0]).shield--;K.poll(k.room,G);assert.equal(k.objective.status,'failed');assert.deepEqual(K.commissionProgress(k.room,G,k.room.seats[0]),[]);
});
test('document recovery is a separate interaction after defeating the squad',t=>{
 const f=fixture(t,3);for(const id of f.objective.targets)f.room.game.units.find(u=>u.id===id).hp=0;K.poll(f.room,G);assert.equal(f.objective.type,'salvage');assert.equal(f.objective.status,'available');assert.deepEqual(K.commissionProgress(f.room,G,f.room.seats[0]),[]);
});
