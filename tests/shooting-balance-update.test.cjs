const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),P=G.pilots,C=require('../shared/conversion-rules.cjs'),W=require('../shared/weapon-classes'),Codec=require('../tools/weapon-store.cjs'),fs=require('node:fs');
const raw=id=>Codec.parse(fs.readFileSync(`assets/units/${id}/unit.json`,'utf8'));
test('linear shooting includes ordinary sniper, charged smart gun, blast mortar and irradiation at 50/100/200 points',()=>{
 for(const shooting of [50,100,200]){
  const mods=P.modifiers({pilot:{stats:{...P.baseStats(),shooting}}});
  for(const weapon of [{category:'sniper',type:'shell'},{sourceName:'BeamSmartGun',special:{type:'snipe'},type:'beam'},{category:'mortar',special:{type:'blast'},type:'shell'},{category:'irradiation',type:'beam'}]) assert.equal(P.weaponDamageModifier(mods,weapon),shooting/100);
  assert.equal(P.weaponDamageModifier(mods,{category:'rifle',type:'shell'}),1+(shooting-100)*.0025);
 }
});
test('shoulder beam cannon scaling covers every damage component and is idempotent, abdomen cannon excluded',()=>{
 for(const id of ['RX_77_4','MS_14C','MSN_02']){
  const base=raw(id),rules=C.read(),old=structuredClone(rules);old.weapons.shoulderBeamCannonDamage=1;
  const before=C.globals(structuredClone(base),old),after=C.globals(structuredClone(base),rules);
  for(const [key,w]of Object.entries(after.weapons)){
   const ratio=W.shoulderBeamCannon(w,after)?1.5:1;
   const payloads=x=>[x,...x.attack?.steps||[]];
   payloads(w).forEach((p,i)=>{for(const [channel,value]of Object.entries(p.damageComponents||{}))assert(Math.abs(value-payloads(before.weapons[key])[i].damageComponents[channel]*ratio)<=25,`${id}/${key}/${channel}`);});
  }
  const again=C.globals(structuredClone(after),rules);assert.deepEqual(again.weapons,after.weapons);
 }
});
test('all MA base and kit COSTs scale once and retain editable baseline',()=>{
 let count=0;const rules=C.read();
 for(const prefab of G.catalog.prefabs.filter(p=>p.unitTags?.includes('MA'))){
  const base=raw(prefab.id),old=structuredClone(rules);old.units.maCost=1;
  const before=C.globals(structuredClone(base),old),after=C.globals(structuredClone(base),rules);
  assert.equal(after.stats.cost,Math.round(before.stats.cost*1.5/25)*25,prefab.id);
  after.weaponKits.forEach((k,i)=>assert.equal(k.cost,Math.round(before.weaponKits[i].cost*1.5/25)*25));
  assert.equal(C.globals(structuredClone(after),rules).stats.cost,after.stats.cost);
  assert.equal(C.globals(structuredClone(after),old).stats.cost,before.stats.cost);count++;
 }assert(count>10);
});
test('charged sniper derives two full ordinary volleys and RX-78-6 exposes paired mortar skill',()=>{
 let count=0;
 for(const p of G.catalog.prefabs)for(const w of Object.values(p.weapons))if(w.special?.type==='snipe'){
  assert.equal(w.chargedSniperPolicy.multiplier,2);count++;
 }
 assert(count>10);assert.equal(C.read().weapons.sniperDamage,1.5625*1.25);
 const m=G.models.RX_78_6__standard,w=m.weapons.find(w=>w.id==='Common_DoubleCannon_NoStop');
 assert(w);assert.equal(W.classify(w),'mortar');assert.equal(w.slot,'skill');assert.equal(w.special.type,'blast');assert.equal(w.noCounter,true);assert(w.attack.strikes.length>=2);
});
test('irradiation action itself uses the same linear pilot multiplier',()=>{
 const damage=shooting=>{
  const model=Object.values(G.models).find(m=>m.prefabId==='RX_78_4_Bst');
  const g=G.create(false,1,[[{unitId:model.prefabId,kitId:model.kitId}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{fogMode:'disabled',costLimit:99999,unitCostLimit:99999});
  g.tiles.forEach(r=>r.fill('plain'));const [a,b]=g.units;
  Object.assign(a,{x:3,y:8,pilot:{stats:{...P.baseStats(),shooting,accuracy:200}}});Object.assign(b,{x:6,y:8,hp:10000000,shield:0,pilot:{stats:P.baseStats()}});
  const skill=G.unitSkills(a).find(s=>s.type==='irradiation');
  const result=G.useSkill(g,a,skill.id,4,8);return result.hits.find(h=>h.unitId===b.id).damage;
 };
 const first=damage(100),second=damage(200);assert(first>0);assert(Math.abs(second/first-2)<.01);
});
