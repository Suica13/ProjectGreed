const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),Conversion=require('../shared/conversion-rules.cjs');
const cbId=Object.keys(G.models).find(id=>G.models[id].prefabId==='GN_001');
function fixture(id='RGM_79__machine_gun'){
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,9,[[e],[e]],false,{fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;
 const members=Array.from({length:6},(_,i)=>({...structuredClone(g.units[0]),id:'ally-'+i,model:id,hp:G.models[id].hp,x:5,y:5,squadId:'six',squadSlot:i}));
 const enemy=g.units[1];Object.assign(enemy,{x:6,y:5});g.units=[...members,enemy];return {g,members,enemy};
}
test('six CB units fill twelve points while a seventh actual unit is rejected',()=>{
 const {g,members}=fixture(cbId);
 assert(members.every(u=>G.squadCapacity(u,g)===2));assert(G.squadFits(members,g));
 assert.equal(G.squadSize(members,g),6);assert.equal(members.reduce((n,u)=>n+G.squadCapacity(u,g),0),12);
 const extra={...structuredClone(members[0]),id:'extra'};assert.equal(G.squadFits([...members,extra],g),false);
 for(const m of Object.values(G.models).filter(m=>m.tags?.includes('CB')))assert.equal(m.transport.slotCost,2,m.prefabId);
});

test('three front and three rear positions rotate together with the squad facing',()=>{
 const {g,members}=fixture();
 for(const facing of [0,90,180,270,45]){
  members[0].angle=facing;
  const radians=facing*Math.PI/180,forward={x:Math.sin(radians),y:-Math.cos(radians)},right={x:Math.cos(radians),y:Math.sin(radians)};
  const offsets=members.map(u=>G.squadOffset(g,u));
  for(let i=0;i<6;i++){
   const o=offsets[i];assert(Math.abs(o.x*forward.x+o.y*forward.y-(i<3?.18:-.18))<1e-9);
   assert(Math.abs(o.x*right.x+o.y*right.y-(i%3-1)*.24)<1e-9);
  }
  members[4].angle=(facing+90)%360;assert.deepEqual(G.squadOffset(g,members[4]),offsets[4]);
  assert.deepEqual(G.squadOffset(g,members[4],facing),offsets[4]);
 }
});

test('small squads center up to three, form a triangle plus trailing fourth, then use two centered rows',()=>{
 const {g,members}=fixture();
 for(const count of [2,3,4,5,6]){
  g.units=members.slice(0,count);const offsets=g.units.map(u=>G.squadOffset(g,u,0));
  assert.equal(new Set(offsets.map(o=>o.x+','+o.y)).size,count);
  if(count<=3){assert(offsets.every(o=>o.y===0));assert(Math.abs(offsets.reduce((n,o)=>n+o.x,0))<1e-9);}
  if(count===4){assert.equal(offsets[0].x,0);assert(offsets[0].y<offsets[1].y);assert.equal(offsets[1].y,offsets[2].y);assert.equal(offsets[3].x,0);assert(offsets[3].y>offsets[2].y);assert(Math.abs(offsets.slice(0,3).reduce((n,o)=>n+o.y,0))<1e-9);}
  if(count>=5){assert(offsets.slice(0,3).every(o=>o.y===-.18));assert(offsets.slice(3).every(o=>o.y===.18));assert(Math.abs(offsets.slice(3).reduce((n,o)=>n+o.x,0))<1e-9);}
 }
});
test('a swap exchanges the same two-row slots used by melee without spending actions',()=>{
 const {g,members,enemy}=fixture(),[a,,,b]=members;
 const weapon=G.modelOf(a).weapons.find(w=>w.type==='melee'&&!w.pilotRequirements?.length);
 assert(G.canAttack(g,a,enemy,weapon));assert.equal(G.canAttack(g,b,enemy,weapon),false);
 const before=G.squadOffset(g,a,0),other=G.squadOffset(g,b,0);
 assert(before.y<other.y);G.swapSquad(g,a,b);
 assert.deepEqual(G.squadOffset(g,a,0),other);assert.deepEqual(G.squadOffset(g,b,0),before);
 assert.equal(G.canAttack(g,a,enemy,weapon),false);assert(G.canAttack(g,b,enemy,weapon));
 assert.equal(a.moved,false);assert.equal(a.acted,false);assert.equal(new Set(members.map(u=>u.squadSlot)).size,6);
 const state=JSON.stringify(members);assert.throws(()=>G.swapSquad(g,a,enemy));assert.equal(JSON.stringify(members),state);
 members[4].plan={};assert.equal(G.canSwapSquad(g,a,b),false);assert.throws(()=>G.swapSquad(g,a,b));
});
test('exposed passengers consume both actual-unit slots and their CB capacity points',()=>{
 const {g,members}=fixture();const [id,m]=Object.entries(G.models).find(([,m])=>m.hangars?.some(h=>h.kind==='sfs')&&(m.footprint?.width??1)===1);
 const hulls=members.slice(0,3).map(u=>({...u,model:id,hp:m.hp}));
 const passengers=hulls.map((u,i)=>({...members[i+3],model:cbId,embarked:{carrierId:u.id,hangarId:m.hangars.find(h=>h.kind==='sfs').id,exposed:true}}));
 g.units=[...hulls,...passengers];assert.equal(G.squadSize(hulls,g),6);assert(G.squadFits(hulls,g));
 assert.equal(hulls.reduce((n,u)=>n+G.squadCapacity(u,g),0),9);
 G.swapSquad(g,hulls[0],passengers[0]);assert.equal(G.squadRow(g,passengers[0]),'front');assert.equal(G.squadRow(g,hulls[0]),'rear');
 g.units.push({...structuredClone(passengers[0]),id:'seventh'});assert.equal(G.squadFits(hulls,g),false);
});

test('rear accuracy is reduced by ten percent for attacks and counters and follows swaps',()=>{
 const {g,members,enemy}=fixture(),a=members[0],b=members[3];
 const weapon={...G.modelOf(a).weapons.find(w=>w.type!=='melee'),hit:60};
 const evasion=G.squadEvasion(g,enemy);
 for(const counter of [false,true]){
  const front=G.estimate(g,a,enemy,weapon,'counter',counter).hit;
  G.swapSquad(g,a,b);
  const rear=G.estimate(g,a,enemy,weapon,'counter',counter).hit;
  assert(front>rear);assert(Math.abs(rear+evasion-(front+evasion)*.9)<=1);
  G.swapSquad(g,a,b);assert.equal(G.estimate(g,a,enemy,weapon,'counter',counter).hit,front);
 }
});

test('cell evasion includes exposed passengers, excludes enclosed cargo and lost units',()=>{
 const {g,members}=fixture();const [id,m]=Object.entries(G.models).find(([,m])=>m.hangars?.some(h=>h.kind==='sfs')&&(m.footprint?.width??1)===1);
 const hulls=members.slice(0,3).map(u=>({...u,model:id,hp:m.hp}));
 const passengers=hulls.map((u,i)=>({...members[i+3],embarked:{carrierId:u.id,hangarId:m.hangars.find(h=>h.kind==='sfs').id,exposed:true}}));
 g.units=[...hulls,...passengers];
 assert(g.units.every(u=>G.squadEvasion(g,u)===0));
 passengers[2].hp=0;assert.equal(G.squadEvasion(g,hulls[0]),2);assert.equal(G.squadEvasion(g,passengers[0]),2);
 passengers[1].embarked.exposed=false;assert.equal(G.squadEvasion(g,hulls[0]),5);assert.equal(G.squadEvasion(g,passengers[1]),0);
 const ship={...members[0],id:'solo-ship',model:Object.keys(G.models).find(id=>id.startsWith('PegasusClass__')),x:10,y:10,squadId:null};
 g.units.push(ship);assert.equal(G.squadEvasion(g,ship),12);
 ship.facility=true;assert.equal(G.squadEvasion(g,ship),0);
});
test('main melee damage increases by 25 percent before manual changes and does not stack',()=>{
 const rules=Conversion.read(),prefab=structuredClone(G.catalog.prefabs.find(p=>p.id==='RGM_79'));
 const main=prefab.weaponKits[0].weapons.map(id=>prefab.weapons[id]).find(w=>w.type==='melee'&&w.weaponClass!=='ram');assert(main);
 rules.weapons.primaryMeleeDamage=1;Conversion.globals(prefab,rules);const original=main.damageComponents;
 const before=Object.values(original).reduce((n,v)=>n+v,0);rules.weapons.primaryMeleeDamage=1.25;Conversion.globals(prefab,rules);
 assert.equal(Object.values(main.damageComponents).reduce((n,v)=>n+v,0),before*1.25);
 const once=structuredClone(main.damageComponents);Conversion.globals(prefab,rules);assert.deepEqual(main.damageComponents,once);
});
test('the global movement reduction applies after imports and before manual offsets',()=>{
 const rules=Conversion.read();assert.equal(rules.units.finalMoveMultiplier,.75);
 const load=require('../tools/load-catalog.cjs').loadCatalog;
 const source=G.catalog.prefabs.find(p=>p.id==='RGM_79');
 const config=structuredClone(rules);config.units.finalMoveMultiplier=1;
 const baseline=load({embedAssets:false,conversionOverride:config});
 const actual=G.models.RGM_79__machine_gun,previous=baseline.models.RGM_79__machine_gun;
 assert.equal(actual.move,Math.round(previous.move*.75));
 assert(source);assert(Object.values(G.models).filter(m=>m.deployed).every(m=>m.move===0));
});
