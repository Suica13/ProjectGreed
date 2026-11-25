const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),Classes=require('../shared/weapon-classes');
const {createAttackPlanner}=require('../shared/attack-plans');
function fixture(){
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;
 const [a,b]=g.units;Object.assign(a,{x:8,y:8,squadSlot:0});Object.assign(b,{x:9,y:8,squadSlot:0});return {g,a,b};
}
test('every ship occupies one cell in every direction',()=>{
 let count=0;for(const [id,m]of Object.entries(G.models))if(m.ship){
  count++;assert.deepEqual(m.footprint,{width:1,height:1},id);
  for(const angle of [0,90,180,270])assert.equal(G.cells({model:id,x:5,y:5,angle}).length,1,id);
 }assert(count>20);
});
test('ship move bonus is reversible, non-stacking and excludes all Medea and FatUncle variants',()=>{
 const conversion=require('../shared/conversion-rules.cjs'),rules=conversion.read();let excluded=0,included=0;
 for(const source of G.catalog.prefabs.filter(p=>(p.stats.ship||/^(?:Medea|FatUncle)/i.test(p.id))&&!p.stats.deployed)){
  const p=structuredClone(source);rules.units.shipMoveBonus=0;conversion.globals(p,rules);const move=p.stats.move;
  rules.units.shipMoveBonus=1;conversion.globals(p,rules);
  const exception=/^(?:Medea|FatUncle)/i.test(p.id);exception?excluded++:included++;
  assert.equal(p.stats.move,move+(exception?0:1),p.id);
  conversion.globals(p,rules);assert.equal(p.stats.move,move+(exception?0:1),p.id);
 }assert(excluded>=4&&included>10);
});
test('ships freely adjust previews but confirmation consumes movement; moved ships can correct heading',()=>{
 const e={unitId:'SalamisClass',kitId:'standard'},enemy={unitId:'RGM_79',kitId:'machine_gun'};
 const g=G.create(false,1,[[e],[enemy]],false,{mapId:'asteroid_crossing_1v1',costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;const [a,b]=g.units;Object.assign(a,{x:8,y:8});
 Object.assign(b,{x:25,y:25});
 const budget=()=>Math.max(...[...G.reachable(g,a).values()].map(p=>p.cost));
 const full=budget(),angle=a.angle;
 for(const direction of [1,1,-1,1,1,1]){assert(G.canRotate(g,a,direction));G.previewRotate(g,a,direction);assert.equal(a.angle,angle);assert.equal(budget(),full);}
 assert.equal(a.pendingMove.angle,angle);G.cancelMove(g,a);assert.equal(a.angle,angle);assert.equal(budget(),full);
 G.previewRotate(g,a,0,0,137);assert.equal(a.pendingMove.angle,137);
 G.confirmMove(g,a);assert.equal(a.angle,137);assert.equal(a.pendingMove,undefined);assert(a.moved&&a.rotated);
 const point=[...G.reachable(g,a).values()].find(p=>p.path.length===1);assert(point);
 assert.throws(()=>G.move(g,a,point.x,point.y));assert.throws(()=>G.previewMove(g,a,point.x,point.y));assert.equal(G.canRotate(g,a,1),false);
 a.moved=false;a.rotated=false;G.move(g,a,point.x,point.y);assert(G.canRotate(g,a,1));
 G.previewRotate(g,a,0,0,23);G.confirmMove(g,a);assert.equal(a.angle,23);assert(a.moved&&a.rotated);
 for(const invalid of [-1,360,NaN,Infinity,'20'])assert.equal(G.canRotate(g,{...a,rotated:false},0,invalid),false);
});

test('ship movement previews and authority face the final path segment; cancellation keeps the old heading',()=>{
 const e={unitId:'SalamisClass',kitId:'standard'},enemy={unitId:'RGM_79',kitId:'machine_gun'};
 for(const [dx,dy,heading] of [[0,-1,0],[1,0,90],[0,1,180],[-1,0,270]]){
  const g=G.create(false,1,[[e],[enemy]],false,{mapId:'asteroid_crossing_1v1',costLimit:99999,fogMode:'disabled'});
  g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;const [ship,other]=g.units;
  Object.assign(ship,{x:8,y:8,angle:90});Object.assign(other,{x:25,y:25});
  G.previewMove(g,ship,8+dx,8+dy);assert.equal((ship.pendingMove.angle+360)%360,heading);assert.equal(ship.angle,90);
  G.cancelMove(g,ship);assert.equal(ship.angle,90);
  G.previewMove(g,ship,8+dx,8+dy);G.confirmMove(g,ship);assert.equal((ship.angle+360)%360,heading);assert.equal(ship.rotated,undefined);
 }
});

test('deployment accepts repeated free ship angles without consuming first-turn movement',()=>{
 const e={unitId:'SalamisClass',kitId:'standard'},enemy={unitId:'RGM_79',kitId:'machine_gun'};
 const g=G.create(false,1,[[e],[enemy]],false,{mapId:'asteroid_crossing_1v1',costLimit:99999,fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=[false,false];g.spawns=G.getMap(g.mapId).spawns;
 g.deploymentAreas=G.getMap(g.mapId).spawns.map(()=>({x:0,y:0,width:G.mapWidth(g),height:G.mapHeight(g)}));
 const [ship,other]=g.units;Object.assign(ship,{x:8,y:8,angle:90});Object.assign(other,{x:25,y:25});
 for(const angle of [137,23,271]){G.rotate(g,ship,0,angle);assert.equal(ship.angle,angle);assert(!ship.rotated&&!ship.moved);}
});
test('rear units retain shooting but cannot attack or counter in melee',()=>{
 const {g,a,b}=fixture(),m=G.modelOf(a),gun=m.weapons.find(w=>w.type!=='melee'),sword=m.weapons.find(w=>w.type==='melee'&&!w.pilotRequirements?.length);
 a.squadSlot=3;assert.equal(G.squadRow(g,a),'rear');assert.equal(G.canAttack(g,a,b,sword),false);assert(G.canAttack(g,a,b,gun));
 assert.equal(G.canCounter(g,a,b,sword),false);a.squadSlot=2;assert(G.canAttack(g,a,b,sword));
});

test('server validates free ship rotation, deduplicates confirmation and prevents movement afterward',t=>{
 const {createRoomEngine}=require('../shared/room-engine');let serial=0;const errors=[];
 const engine=createRoomEngine({rules:G,randomId:()=>`rotation-${++serial}`,randomToken:()=>`token-${++serial}`,randomSeed:()=>1,send:(_,message)=>{if(message.type==='error')errors.push(message);}});
 t.after(()=>engine.close());const clients=[{readyState:1},{readyState:1}];
 engine.join(clients[0],{mode:'create',room:'ROTATION',characterFaction:'PMC'});
 engine.join(clients[1],{mode:'join',room:'ROTATION',characterFaction:'PMC'});
 const room=engine.rooms.get('ROTATION'),e={unitId:'SalamisClass',kitId:'standard'},enemy={unitId:'RGM_79',kitId:'machine_gun'};
 const g=G.create(false,1,[[e],[enemy]],false,{mapId:'asteroid_crossing_1v1',costLimit:99999,fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;const [ship,other]=g.units;
 Object.assign(ship,{x:8,y:8,angle:0});Object.assign(other,{x:25,y:25});
 Object.assign(room,{game:g,started:true,matchId:'rotation-match',phase:'idle',activeSeats:[true,true],turnDone:[false,false],turnNotBefore:0,plans:[],planSequence:0,responses:[],reactions:[],pending:null});
 room.settings={...room.settings,mapId:g.mapId,fogMode:'disabled'};
 const act=(seat,action,fields={})=>{const msg={id:`request-${++serial}`,revision:room.revision,round:g.round,phase:room.phase,matchId:room.matchId,action,...fields};engine.action(clients[seat],msg);return msg;};
 room.phase='deployment';g.deployment=[false,false];g.spawns=G.getMap(g.mapId).spawns;g.deploymentAreas=g.spawns.map(()=>({x:0,y:0,width:G.mapWidth(g),height:G.mapHeight(g)}));
 for(const angle of [137,23]){act(0,'rotate',{unitId:ship.id,angle});assert.equal(ship.angle,angle);assert(!ship.rotated&&!ship.moved);}
 room.phase='idle';g.deployment=null;ship.angle=0;
 act(0,'rotate',{unitId:ship.id,direction:1});assert.equal(ship.pendingMove.angle,90);
 const click=act(0,'rotate',{unitId:ship.id,direction:1});assert.equal(ship.pendingMove.angle,180);
 engine.action(clients[0],click);assert.equal(ship.pendingMove.angle,180);
 assert.throws(()=>act(1,'rotate',{unitId:ship.id,direction:1}));assert.equal(ship.pendingMove.angle,180);
 assert.throws(()=>act(0,'rotate',{unitId:other.id,direction:1}));
 act(0,'cancel_move',{unitId:ship.id});assert.equal(ship.angle,0);
 const point=[...G.reachable(g,ship).values()].find(p=>p.path.length===1);assert(point);G.move(g,ship,point.x,point.y);
 assert.throws(()=>act(0,'rotate',{unitId:ship.id,angle:360}));assert.equal(ship.pendingMove,undefined);
 const final=act(0,'rotate',{unitId:ship.id,angle:137});assert.equal(ship.angle,137);assert.equal(ship.pendingMove,undefined);assert(ship.moved&&ship.rotated);
 engine.action(clients[0],final);assert.equal(ship.angle,137);
 assert.throws(()=>act(0,'rotate',{unitId:ship.id,angle:50}));assert.equal(ship.angle,137);
 assert.throws(()=>G.previewMove(g,ship,point.x+1,point.y));
});
test('ordinary melee gains one round while special attacks and defender replies stay limited',()=>{
 const base={type:'melee',weaponClass:'melee',slot:'primary'};
 assert.equal(Classes.rounds(base),2);assert.equal(Classes.rounds({...base,attackRounds:3}),4);
 assert.equal(Classes.rounds({...base,attackRounds:0}),0);
 for(const extra of [{slot:'skill'},{weaponClass:'ram'},{pilotRequirements:[{stat:'melee',value:125}]},{special:{type:'snipe'}}])
  assert.equal(Classes.rounds({...base,...extra}),1);
 const {g,a}=fixture(),auto=require('../shared/automatic-fire');
 assert.equal(auto.roundCount(G,g,a,base),2);assert.equal(auto.roundCount(G,g,a,base,true),1);
});
for(const shots of [1,3])test(`a front unit continues melee across squad deaths with ${shots} strikes per round`,()=>{
 const {g,a,b}=fixture(),base=G.modelOf(a),sword=structuredClone(base.weapons.find(w=>w.type==='melee'&&Classes.classify(w)==='melee'&&!w.pilotRequirements?.length));
 Object.assign(sword,{id:'follow-sword',sourceName:'follow-sword',hit:10000,sourceHit:10000,en:7,attackRounds:1,damage:1000000,damagePerShot:1000000,damageComponents:{melee:1000000},requiredParts:[],pilotRequirements:[]});
 if(shots>1){
  const strike=sword.attack.strikes[0];sword.attack.shots=[0,.3,.6];sword.attack.duration=1;
  sword.attack.strikes=Array.from({length:shots},(_,i)=>({...structuredClone(strike),at:i*.3,shotIndex:i,hitIndex:0}));
  sword.attack.muzzleIndices=Array(shots).fill(0);sword.attack.muzzleShotIndices=[0,1,2];sword.shotCount=shots;
 }
 const id='melee-follow-fixture';G.models[id]={...base,weapons:[sword],partsBreakable:false,shield:{...base.shield,hp:0}};
 try{
  a.model=id;a.en=1000;b.hp=1;b.shield=0;b.squadId='victims';
  const others=Array.from({length:shots===1?1:3},(_,i)=>({...structuredClone(b),id:'victim-'+i,squadSlot:i+1}));g.units.push(...others);
  let serial=0;const room={game:g},planner=createAttackPlanner(G,()=>String(++serial));planner.reset(room);planner.plan(room,a,b,null,0,'melee');
  planner.prepare(room);while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');
  const battles=planner.resolve(room).filter(x=>x.events.some(e=>e.type==='melee'));
  assert.equal(b.hp,0);assert(others.every(u=>u.hp===0));assert.equal(a.en,986);
  const pairs=[...new Map(battles.map(x=>[x.meleeExchange.id,x.meleeExchange])).values()];
  assert.equal(new Set(pairs.map(p=>p.defender)).size,others.length+1);
  const ordered=pairs.sort((a,b)=>a.start-b.start);
  for(let i=1;i<ordered.length;i++){assert.equal(ordered[i].previousId,ordered[i-1].id);assert.equal(ordered[i-1].retreat,0);}
  assert.equal(ordered.at(-1).retreat,.35);
 }finally{delete G.models[id];}
});
