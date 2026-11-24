const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loadCatalog}=require('../tools/load-catalog.cjs'),Conversion=require('../shared/conversion-rules.cjs');
const {applyWeaponBalance}=require('../tools/weapon-balance.cjs'),Codec=require('../tools/weapon-store.cjs');
const rules=Conversion.read(),catalog=loadCatalog({embedAssets:false});
const neutral=loadCatalog({embedAssets:false,conversionOverride:{...rules,gbo2:{hp:1,shield:1,move:1,uniqueDamage:1,mountain:0}}});
const pref=id=>catalog.prefabs.find(p=>p.id===id);
const deltas=require('../shared/editor-adjustments.json').units;
test('GBO2 global policy doubles current HP, shields and movement, uses 75 percent mountain and explicit COST',()=>{
 for(const id of ['GN_001','GN_002','GN_003','GN_003_MA','GN_005']){
  const p=pref(id),base=neutral.prefabs.find(p=>p.id===id);
  assert.equal(p.stats.cost,1500);for(const key of ['hp','move']){const d=deltas[id]?.['/stats/'+key]||0;assert.equal(p.stats[key]-d,(base.stats[key]-d)*2);}
  assert.equal(p.shield.hp,base.shield.hp*2);assert.equal(p.stats.adaptability.mountain,75);
  for(const reference of p.gbo2Conversion.reference.units){
   const m=Object.values(catalog.models).find(m=>m.prefabId===reference&&m.cost===p.gbo2Conversion.reference.cost);
   assert(m);for(const key of ['mobility','accuracy'])assert.equal(p.stats[key]-(deltas[id]?.['/stats/'+key]||0),m[key]);
  }
 }
 assert.deepEqual(pref('RGM_79'),neutral.prefabs.find(p=>p.id==='RGM_79'));
 assert.deepEqual(pref('Mission_SpaceShuttle'),neutral.prefabs.find(p=>p.id==='Mission_SpaceShuttle'));
 assert.equal(pref('Mission_SpaceShuttle').stats.hp,300000);
});
test('same-name sabers reference common templates, keep native timing and do not receive unique-weapon scaling',()=>{
 const definitions=JSON.parse(fs.readFileSync('assets/weapons.json','utf8')).definitions;
 for(const id of ['GN_001','GN_002','GN_003','GN_005']){
  const p=pref(id),raw=JSON.parse(fs.readFileSync(`assets/units/${id}/unit.json`,'utf8'));
  const reused=Object.entries(p.weapons).filter(([,w])=>w.gbo2SharedRef);assert(reused.length>0,id);
  for(const [key,w]of reused){
   assert.equal(raw.weapons[key].ref,w.gbo2SharedRef);assert(!w.gbo2DamageScale);
   const expected={id:'reference',source:'reference',stats:{hp:1,en:1,move:1,mobility:100,accuracy:100},weapons:{weapon:structuredClone(definitions[w.gbo2SharedRef])},skills:[]};
   applyWeaponBalance(expected,rules,definitions);
   assert.deepEqual(w.damageComponents,expected.weapons.weapon.damageComponents);
   assert.equal(w.nativeTiming.entry,raw.weapons[key].overrides.nativeTiming.entry);
  }
 }
});
test('unique weapons scale every component and scripted strike by 3, with no stacking on repeated policy application',()=>{
 for(const p of catalog.prefabs.filter(p=>p.id.startsWith('GN_'))){
  const baseline=neutral.prefabs.find(x=>x.id===p.id);
  for(const [key,w]of Object.entries(p.weapons))if(!w.gbo2SharedRef&&!w.derivedSnipe){
   for(const [channel,value]of Object.entries(baseline.weapons[key].damageComponents)){const d=deltas[p.id]?.['/weapons/'+key+'/damageComponents/'+channel]||0;assert(Math.abs((w.damageComponents[channel]-d)-(value-d)*3)<1e-8);}
   for(const [i,step]of w.attack.steps.entries())for(const [channel,value]of Object.entries(baseline.weapons[key].attack.steps[i].damageComponents||{}))assert.equal(step.damageComponents[channel],value*3);
  }
 }
 const raw=JSON.parse(fs.readFileSync('assets/units/GN_001/unit.json','utf8')),p=Codec.expandPrefab(raw);
 applyWeaponBalance(p,rules);const once=structuredClone(p);applyWeaponBalance(p,rules);
 assert.deepEqual(p.stats,once.stats);assert.deepEqual(p.weapons,once.weapons);assert.deepEqual(p.shield,once.shield);
});
test('Virtue irradiation receives its explicit post-policy boost and remains a mutually exclusive skill',()=>{
 const p=pref('GN_005'),skill=p.skills.find(s=>s.id==='Irradiation');
 assert.equal(skill.damageComponents.beamAP,38250);assert(skill.damageComponents.beamAP>=1275*10);
 assert(!catalog.models.GN_005__default.weapons.some(w=>w.id.includes('BurstMode')));
 assert.equal(p.stats.gnField.capacity,10000);
});

test('future GBO2 packages inherit scoped rules and same-COST references',()=>{
 const p=Codec.expandPrefab(JSON.parse(fs.readFileSync('assets/units/GN_002/unit.json','utf8')));
 p.id='GBO2_Future';p.source='GundamWars_BattleOperation2_V6/Units/BattleUnits/Future/Future.ini';p.stats.cost=1250;
 applyWeaponBalance(p,rules,undefined,{adjustments:{schemaVersion:1,units:{},weapons:{},prices:{}}});
 assert.equal(p.stats.hp,48000);assert.equal(p.stats.adaptability.mountain,75);
 assert.equal(p.gbo2Conversion.reference.cost,1250);assert(p.gbo2Conversion.reference.units.length>1);
 assert(p.stats.mobility>100);assert(p.stats.accuracy>100);
});
