const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules.js'),{createAttackPlanner}=require('../shared/attack-plans.js');
function fixture(){
 const e={unitId:'RGM_79',kitId:'machine_gun'};
 const g=G.create(false,7,[[e],[e]]);g.fogMode='disabled';g.tiles.forEach(r=>r.fill('plain'));
 const [a,b]=g.units;Object.assign(a,{x:3,y:4,en:99999});
 Object.assign(b,{model:'SalamisClass__standard',x:4,y:4,angle:0,hp:999999,shield:0});
 return {g,a,b,w:G.modelOf(a).weapons[0]};
}
test('adjacent large hull is targetable at farther occupied cells, never outside the hull',()=>{
 const {a,b,w}=fixture(),r={...w,min:2,max:3};
 assert.equal(G.dist(a,b),1);assert(G.inRange(a,b,r));
 assert(!G.inRange(a,b,{...r,aimCell:{x:4,y:4}}));
 assert(G.inRange(a,b,{...r,aimCell:{x:4,y:5}}));
 assert(!G.inRange(a,b,{...r,aimCell:{x:3,y:6}}));
 b.angle=90;assert.deepEqual(G.dimensions(b),{width:3,height:1});
 assert(G.inRange(a,b,{...r,aimCell:{x:5,y:4}}));
});
test('core multiplies protected damage by 1.5; other cells and opt-out do not',()=>{
 const {g,a,b,w}=fixture(),core={x:4,y:5},edge={x:4,y:4};
 assert(G.weakPoint(b,core));assert(!G.weakPoint(b,edge));
 const normal=G.estimate(g,a,b,{...w,aimCell:edge},'evade').damage;
 const weak=G.estimate(g,a,b,{...w,aimCell:core},'evade').damage;
 assert(normal>0);assert(Math.abs(weak-normal*1.5)<=w.attack.strikes.length);
 const m=G.models[b.model];m.weakPoint=false;
 try{assert.equal(G.estimate(g,a,b,{...w,aimCell:core},'evade').damage,normal)}finally{delete m.weakPoint}
});
test('chosen cell survives queued resolution and invalid cells cannot be planned',()=>{
 const {g,a,b,w}=fixture(),room={game:g,matchId:'cells'};let i=0;
 const p=createAttackPlanner(G,()=>String(++i));p.reset(room);
 assert.throws(()=>p.plan(room,a,{...b,aimCell:{x:3,y:6}},[w],0));
 p.plan(room,a,{...b,aimCell:{x:4,y:5}},[w],0);
 assert.deepEqual(a.plan.aimCell,{x:4,y:5});
 const [r]=p.prepare(room);p.choose(room,r.id,'evade',null);
 const events=p.resolve(room).flatMap(b=>b.events);
 assert(events.length);assert.deepEqual(events[0].aimCell,{x:4,y:5});assert.equal(events[0].weakPoint,true);
});
test('2x2 occupied cells remain reachable by a range 2-3 weapon while adjacent',()=>{
 const {a,b,w}=fixture(),m=G.models[b.model],previous=m.footprint;
 m.footprint={width:2,height:2};
 try {
  assert.equal(G.dist(a,b),1);
  assert(G.inRange(a,b,{...w,min:2,max:3,aimCell:{x:5,y:5}}));
  assert(!G.inRange(a,b,{...w,min:2,max:3,aimCell:{x:4,y:4}}));
 }finally{m.footprint=previous}
});
