const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules.js'),Sequence=require('../shared/weapon-sequence.js'),policy=require('../shared/unit-roles.json');
test('every prefab and weapon kit has an audited combat role; known native categories and base forms agree',()=>{
  for(const p of G.catalog.prefabs){assert(policy.units[p.id],p.id);assert(['normal','general','support','raid'].includes(p.combatRole),p.id);for(const kit of p.weaponKits)assert.equal(G.models[p.id+'__'+kit.id].combatRole,policy.units[kit.variantUnitId||p.id].role,p.id+'/'+kit.id);}
  const roles=Object.fromEntries(G.catalog.prefabs.map(p=>[p.id,p.combatRole]));
  for(const [id,role] of Object.entries({RGM_79:'general',RX_77_2:'support',MS_07B:'raid',Medea:'normal',Type61:'normal',WhiteBase:'normal'}))assert.equal(roles[id],role,id);
  for(const [from,to] of [['MSZ_006','MSZ_006_MA'],['RGZ_91_MA','RGZ_91'],['FA_78_1','FA_78_1_NA']])assert.equal(roles[from],roles[to]);
});
function fixture(){
  const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'}),[a,b]=g.units,base=G.models[a.model];
  g.tiles.forEach(row=>row.fill('plain'));
  for(const [index,u] of g.units.entries())Object.assign(u,{model:'role-test-'+index,x:5+index,y:5,hp:1000000,en:100000,shield:0,pilot:{stats:G.pilots.baseStats()}});
  for(let i=0;i<2;i++)G.models['role-test-'+i]={...base,combatRole:'normal',hp:1000000,accuracy:100,mobility:100,attackBonuses:{shooting:0,melee:0,beam:0,shell:0},defenses:Object.fromEntries(['beam','shell','melee','dp','sp'].map(k=>[k,{percent:0,flat:0}])),shield:{...base.shield,hp:0}};
  const weapon=Sequence.compile({...base.weapons[0],id:'role-weapon',type:'beam',en:0,min:1,max:10,hit:60,sourceHit:60,damagePerShot:10000,damageComponents:{beam:10000},requiredParts:[],antiSize:{},targetModifiers:{},attack:{steps:[{delay:0,shots:1}]}});
  return {g,a,b,weapon,cleanup(){delete G.models['role-test-0'];delete G.models['role-test-1'];}};
}
const setRole=(unit,role)=>{G.models[unit.model]={...G.models[unit.model],combatRole:role};};
test('all sixteen matchups grant only the defender 10% resistance and five evasion points against a countered attacker',()=>{
 const f=fixture();try{
  const baseline=G.estimate(f.g,f.a,f.b,f.weapon),beats={general:'support',support:'raid',raid:'general'};
  for(const attack of ['normal','general','support','raid'])for(const defend of ['normal','general','support','raid']){
   setRole(f.a,attack);setRole(f.b,defend);
   const advantage=beats[attack]===defend,protectedTarget=beats[defend]===attack,result=G.estimate(f.g,f.a,f.b,f.weapon);
   assert.equal(G.combatRoleAdvantage(G.modelOf(f.a),G.modelOf(f.b)),advantage,attack+' -> '+defend);
   assert.equal(result.hit,Math.max(0,baseline.hit-(protectedTarget?5:0)));
   assert.equal(result.damage,Sequence.roundDamage(baseline.damage*(protectedTarget?0.9:1)));
  }
  setRole(f.a,'support');setRole(f.b,'general');
  const counter=G.estimate(f.g,f.a,f.b,f.weapon,'counter',true);
  setRole(f.b,'normal');const plainCounter=G.estimate(f.g,f.a,f.b,f.weapon,'counter',true);
  assert.equal(counter.hit,Math.max(0,plainCounter.hit-5));
  setRole(f.b,'general');const max=G.estimate(f.g,f.a,f.b,{...f.weapon,counterExposureMultiplier:10});assert.equal(max.hit,95);
  const min=G.estimate(f.g,f.a,f.b,{...f.weapon,counterExposureMultiplier:0});assert.equal(min.hit,0);
 }finally{f.cleanup();}
});
test('real combat applies role damage through the same authority as the preview',()=>{
 const f=fixture();try{
  setRole(f.a,'support');setRole(f.b,'general');
  const weapon={...f.weapon,hit:1000,hitScale:10},expected=G.estimate(f.g,f.a,f.b,weapon),before=f.b.hp;
  const events=G.fight(f.g,f.a,f.b,weapon,'counter',null,false);
  assert.equal(events[0].damage,expected.damage);assert.equal(f.b.hp,before-expected.damage);assert.equal(events[0].hitChance,expected.hit);
 }finally{f.cleanup();}
});
test('ongoing fire applies its source role once and ignores missing sources',()=>{
 const f=fixture();try{
  setRole(f.a,'support');setRole(f.b,'general');f.g.team=f.b.team;
  const ignite=sourceId=>{f.b.hp=1000000;f.b.burning={sourceId,hpPercent:1,expiresRound:f.g.round+2};};
  ignite(f.a.id);const bonus=G.tickBurning(f.g).find(e=>e.type==='burn');assert.equal(bonus.damage,9000);
  ignite('missing-source');const plain=G.tickBurning(f.g).find(e=>e.type==='burn');assert.equal(plain.damage,10000);
 }finally{f.cleanup();}
});
