const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules');
function fixture(id){
 const m=Object.values(G.models).find(m=>m.prefabId===id);
 const g=G.create(false,1,[[{unitId:id,kitId:m.kitId}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999});
 g.tiles.forEach(r=>r.fill('plain'));g.deployment=null;
 const [u,enemy]=g.units;Object.assign(u,{x:8,y:8});Object.assign(enemy,{x:9,y:8});return {g,u,enemy};
}
test('every transform and armor-purge skill is free, including legacy consuming source definitions',()=>{
 let count=0;for(const m of Object.values(G.models))for(const s of m.skills)if(['transform','armor_purge'].includes(s.type)){
  assert.equal(s.consumeAction,false,m.id+'/'+s.id);count++;
 }assert(count>30);
});
test('transform, weapon change and armor purge retain both movement and attack opportunities',()=>{
 for(const [id,type]of [['GN_003','transform'],['MS_06R_TB','transform'],['FA_78_1_TB','armor_purge']]){
  const {g,u,enemy}=fixture(id),skill=G.unitSkills(u).find(s=>s.type===type);
  const hpRatio=u.hp/G.modelOf(u).hp;G.useSkill(g,u,skill.id,u.x,u.y);
  assert.equal(u.acted,false,id);assert.equal(u.moved,false,id);
  assert.equal(u.hp/G.modelOf(u).hp,hpRatio,id);
  assert(G.reachable(g,u).size>1,id);
  assert(G.modelOf(u).weapons.some(w=>G.canAttack(g,u,enemy,w)),id);
  if(type==='transform')assert(G.unitSkills(u).filter(s=>s.type==='transform').every(s=>!G.canUseSkill(g,u,s.id)),id);
 }
});
test('changing form after moving keeps movement spent, and cannot bypass an ended action',()=>{
 for(const moved of [false,true]){
  const {g,u}=fixture('GN_003');u.moved=moved;G.useSkill(g,u,'Transform',u.x,u.y);
  assert.equal(u.moved,moved);assert.equal(u.acted,false);
 }
 const {g,u}=fixture('GN_003');u.acted=true;const before=JSON.stringify(u);
 assert(!G.canUseSkill(g,u,'Transform'));assert.throws(()=>G.useSkill(g,u,'Transform',u.x,u.y));assert.equal(JSON.stringify(u),before);
});
