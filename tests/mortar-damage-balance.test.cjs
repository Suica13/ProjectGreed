const test=require("node:test"),assert=require("node:assert/strict");
const {loadCatalog}=require("../tools/load-catalog.cjs"),Classes=require("../shared/weapon-classes");
const rules=require("../shared/conversion-rules.json"),previous=structuredClone(rules);
previous.weaponClasses.mortar.damage/=1.25;
const before=loadCatalog({embedAssets:false,conversionOverride:previous}),after=loadCatalog({embedAssets:false});
test("all mortar payloads gain 25 percent while other weapons and native firing chains stay unchanged",()=>{
  let count=0;
  const oldUnits=new Map(before.prefabs.map(p=>[p.id,p]));
  for(const p of after.prefabs)for(const [id,w] of Object.entries(p.weapons)) {
    const old=oldUnits.get(p.id).weapons[id],mortar=Classes.classify(w,id)==="mortar";
    assert(Math.abs(w.damagePerShot-old.damagePerShot*(mortar?1.25:1))<1e-6,p.id+"/"+id);
    for(const [channel,value] of Object.entries(w.damageComponents))
      assert(Math.abs(value-old.damageComponents[channel]*(mortar?1.25:1))<1e-6,p.id+"/"+id+"/"+channel);
    assert.deepEqual(w.nativePayload,old.nativePayload);
    assert.equal(w.en,old.en);assert.equal(w.attackRounds,old.attackRounds);
    assert.deepEqual([w.min,w.max,w.hit],[old.min,old.max,old.hit]);
    const firing=weapon=>weapon.attack.steps.map(step=>[step.shots,step.repeat,step.delay,step.muzzleIndex]);
    assert.deepEqual(firing(w),firing(old));
    if(mortar)count++;
  }
  assert(count>=29);
  for(const model of Object.values(after.models))for(const weapon of model.weapons)
    if(Classes.classify(weapon)==="mortar")assert.equal(weapon.damage%25,0);
});
