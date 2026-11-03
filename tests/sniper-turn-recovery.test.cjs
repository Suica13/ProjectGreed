const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),{createRoomEngine}=require('../shared/room-engine');

test('every charged sniper uses its real rifle projectile and preserves native helper data',()=>{
 let count=0;
 for(const model of Object.values(G.models))for(const weapon of model.weapons){
  if(weapon.special?.type!=='snipe')continue;
  const base=model.weapons.find(w=>w.id===weapon.special.baseWeapon);assert(base);
  assert.equal(weapon.projectile.texture,base.projectile.texture);
  assert.equal(weapon.projectile.speed,base.projectile.speed);
  assert(!/LockTarget/.test(weapon.projectile.texture));assert(weapon.projectile.speed>1);
  count++;
 }
 assert(count>=6);
});

test('a charged sniper returns to the same action phase and other units can move and attack',t=>{
 let sequence=0;
 const engine=createRoomEngine({rules:G,randomId:()=>String(++sequence),randomToken:()=>String(++sequence),randomSeed:()=>1,send:()=>{}});
 t.after(()=>engine.close());
 const clients=[{readyState:1},{readyState:1}];
 engine.join(clients[0],{mode:'create',room:'SNIPER',name:'sniper',characterFaction:'PMC'});
 engine.join(clients[1],{mode:'join',room:'SNIPER',name:'defender',characterFaction:'PMC'});
 const room=engine.rooms.get('SNIPER');
 const model=Object.values(G.models).find(m=>m.prefabId==='MS_06F_Sniper');
 const rifle={unitId:model.prefabId,kitId:model.kitId},ally={unitId:'RGM_79',kitId:'machine_gun'};
 room.game=G.create(false,1,[[rifle,ally],[{unitId:'Type61',kitId:'standard'}]],false,{fogMode:'disabled',costLimit:99999,unitCostLimit:99999});
 room.game.tiles.forEach(r=>r.fill('plain'));room.game.deployment=null;
 Object.assign(room,{started:true,matchId:'sniper',phase:'idle',activeSeats:[true,true],turnDone:[false,false],turnNotBefore:0,plans:[],planSequence:0,responses:[],reactions:[],pending:null});
 const [a,friend,b]=room.game.units;
 Object.assign(a,{x:5,y:5});Object.assign(friend,{x:7,y:5});Object.assign(b,{x:9,y:5,hp:1000000});
 const act=(seat,action,fields={})=>{
  room.turnNotBefore=0;
  return engine.action(clients[seat],{id:'req-'+ ++sequence,revision:room.revision,round:room.game.round,matchId:room.matchId,action,...fields});
 };
 const ack=()=>{const batchId=room.playback.id;for(let seat=0;seat<2;seat++)act(seat,'playback_ready',{batchId});};
 const skill=G.modelOf(a).weapons.find(w=>w.special?.type==='snipe');
 act(0,'attack',{unitId:a.id,targetId:b.id,weaponId:skill.id,single:true});
 act(0,'end_turn');assert(a.snipeOrder);assert.equal(room.game.team,1);
 act(1,'end_turn');assert.equal(room.game.team,0);assert.equal(room.phase,'reaction');
 act(1,'respond',{reactionId:room.pending.id,response:'defend'});
 assert.equal(room.phase,'playback');assert.equal(room.playback.resumeTurn,true);
 assert(Math.max(...room.combatBatch.flatMap(b=>b.events.map(e=>e.impactAt)))<10);
 ack();assert.equal(room.phase,'idle');assert.equal(room.game.round,3);assert.equal(room.turnDone[0],false);
 assert.equal(friend.acted,false);assert.equal(friend.moved,false);
 const cell=[...G.reachable(room.game,friend).values()].find(p=>p.path.length&&p.x===8&&p.y===5);assert(cell);
 act(0,'move',{unitId:friend.id,x:cell.x,y:cell.y,single:true});
 act(0,'confirm_move',{unitId:friend.id});
 act(0,'attack',{unitId:friend.id,targetId:b.id,single:true});assert(friend.plan);
 act(0,'end_turn');act(1,'respond',{reactionId:room.pending.id,response:'defend'});ack();
 act(1,'end_turn');assert.equal(room.game.team,0);assert.equal(room.game.round,5);
 assert.equal(friend.acted,false);assert(G.reachable(room.game,friend).size>1);
 act(0,'attack',{unitId:friend.id,targetId:b.id,single:true});assert(friend.plan);
});
