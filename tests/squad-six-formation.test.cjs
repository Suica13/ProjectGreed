const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules.js');
function fixture(count=7,unitId="Type61") {
 const e={unitId,kitId:unitId==="Type61"?"standard":"machine_gun"},g=G.create(false,7,[[e],[e]],false,{fogMode:'disabled'});
 const source=g.units[0],enemy=g.units[1];g.tiles.forEach(r=>r.fill('plain'));
 const units=Array.from({length:count},(_,i)=>({...structuredClone(source),id:'ally-'+i,x:5+i%4,y:5+Math.floor(i/4),acted:false,moved:false}));
 Object.assign(enemy,{x:5,y:9});g.units=[...units,enemy];return {g,units,enemy};
}
function stack(g,units){for(let i=0;i<units.length;i++)Object.assign(units[i],{x:5,y:5,squadId:'six',squadSlot:i});}
test('six one-point units fill six points; seventh and excessive capacity cannot join',()=>{
 const {g,units}=fixture();stack(g,units.slice(0,5));
 assert.equal(G.squadCapacity(units[0]),1);assert.equal(G.squadJoinTarget(g,units[5],5,5),units[0]);
 G.joinSquad(g,units[5],units[0]);Object.assign(units[5],{x:5,y:5});
 assert.equal(G.squadMembers(g,units[0]).length,6);assert.equal(G.squadJoinTarget(g,units[6],5,5),null);
 const oldModel=units[0].model;const key='formation-heavy-test';G.models[key]={...G.models[units[0].model],transport:{...G.modelOf(units[0]).transport,slotCost:5}};
 try {units[0].model=key;assert.equal(G.squadFits(units.slice(0,5)),false);}finally{units[0].model=oldModel;delete G.models[key];}
 units[2].hp=0;assert(G.squadJoinTarget(g,units[6],5,5));
});
test('automatic triangles preserve scale and unique offsets for two through six members',()=>{
 const {g,units}=fixture(6);
 assert.equal(G.positionSquad,undefined);
 for(let count=2;count<=6;count++){
  g.units=units.slice(0,count);stack(g,g.units);
  const offsets=g.units.map(u=>G.squadOffset(g,u,0));
  assert.equal(new Set(offsets.map(o=>o.x+','+o.y)).size,count);
  assert(offsets.every(o=>o.scale===1&&Number.isFinite(o.x)&&Number.isFinite(o.y)));
  if(count===3)assert(offsets[1].y<offsets[0].y&&offsets[1].y<offsets[2].y);
 }
});
test('targeting is uniform across living legal candidates regardless of legacy slot',()=>{
 const {g,units}=fixture(6);stack(g,units);const counts=units.map(()=>0);
 for(let i=0;i<30000;i++)counts[units.indexOf(G.squadTarget(g,units))]++;
 assert(counts.every(n=>Math.abs(n/30000-1/6)<.012));
 const candidates=[units[0],...units.slice(3)];let first=0;
 for(let i=0;i<20000;i++)first+=G.squadTarget(g,candidates)===units[0];
 assert(Math.abs(first/20000-.25)<.015);assert.equal(G.squadTarget(g,[]),null);
});
test('live squad counts grant integer final evasion; destroyed members no longer count',()=>{
 const {g,units,enemy}=fixture(6);stack(g,units);
 const weapon=G.modelOf(enemy).weapons.find(w=>w.type!=='melee'&&!w.special);
 const hit=G.estimate(g,enemy,units[0],weapon).hit;
 for(let n=6;n>=1;n--){
   for(let i=0;i<6;i++)units[i].hp=i<n?10000:0;
   const bonus=[0,12,10,7,5,2,0][n];assert.equal(G.squadEvasion(g,units[0]),bonus);
   assert.equal(G.estimate(g,enemy,units[0],weapon).hit,Math.max(0,hit-bonus));
 }
});
test('six cargo launch together and confirm as six separate visual slots',()=>{
 const {g,units}=fixture(6),carrier={...structuredClone(units[0]),id:'carrier',model:Object.keys(G.models).find(id=>id.startsWith('PegasusClass__')),x:10,y:10};
 carrier.hp=G.modelOf(carrier).hp;g.units.push(carrier);
 const hangar=G.hangars.of(carrier)[0];
 units.forEach(u=>u.embarked={carrierId:carrier.id,hangarId:hangar.id,boardRound:null});G.hangars.sync(g);
 const point=G.hangars.launchSquadCells(g,units)[0];assert(point);
 G.hangars.previewLaunchSquad(g,units,point.x,point.y);assert(units.every(u=>u.embarked));
 G.confirmMove(g,units[0]);assert.equal(G.squadMembers(g,units[0]).length,6);
 assert.equal(new Set(units.map(u=>u.squadSlot)).size,6);
});

test('ordinary confirmed plans remain editable and cancellable through the original squad leader',()=>{
 const {createAttackPlanner}=require('../shared/attack-plans');
 const {g,units,enemy}=fixture(3,'RGM_79');stack(g,units);enemy.x=5;enemy.y=6;
 const room={game:g},planner=createAttackPlanner(G);planner.reset(room);
 const original=units[0].model,key='unarmed-formation-root';G.models[key]={...G.models[original],weapons:[]};units[0].model=key;
 try {
   planner.plan(room,units[0],enemy,null,0);
   assert.equal(units[0].plan,undefined);assert.equal(units[0].squadOrder,true);
   planner.plan(room,units[0],enemy,null,0,'shooting');
   assert(room.plans.every(p=>p.combatMode==='shooting'));
   planner.cancel(room,units[0]);assert.equal(room.plans.length,0);assert(units.every(u=>!u.acted&&!u.plan&&!u.squadOrder));
 } finally {units[0].model=original;delete G.models[key];}
});

test('three ordinary MS exhaust six capacity points despite remaining portrait slots',()=>{
 const {g,units}=fixture(4,'RGM_79');stack(g,units.slice(0,3));
 assert.equal(G.squadCapacity(units[0]),2);
 assert.equal(G.squadFits(units.slice(0,3)),true);
 assert.equal(G.squadFits(units),false);
 assert.equal(G.squadJoinTarget(g,units[3],5,5),null);
});
