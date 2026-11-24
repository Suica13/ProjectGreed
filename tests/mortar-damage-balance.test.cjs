const test=require("node:test"),assert=require("node:assert/strict");
const {loadCatalog}=require("../tools/load-catalog.cjs"),Classes=require("../shared/weapon-classes");
const rules=require("../shared/conversion-rules.json"),previous=structuredClone(rules);
previous.weaponClasses.mortar.damage=.75;
previous.weaponClasses.cannon.damage=rules.weaponClasses.cannon.damage;
previous.weapons.mortarHitOffset=rules.weapons.mortarHitOffset;
previous.weapons.cannonHitOffset=rules.weapons.cannonHitOffset;
const adjustmentsOverride={schemaVersion:1,units:{},weapons:{},prices:{}};
const before=loadCatalog({embedAssets:false,conversionOverride:previous,adjustmentsOverride}),after=loadCatalog({embedAssets:false,adjustmentsOverride});
test("mortars use 1.00 instead of 0.75 while retaining accuracy and native firing chains",()=>{
  let count=0;
  const oldUnits=new Map(before.prefabs.map(p=>[p.id,p]));
  for(const p of after.prefabs)for(const [id,w] of Object.entries(p.weapons)) {
    const old=oldUnits.get(p.id).weapons[id],mortar=Classes.classify(w,id)==="mortar";
    const cannon=Classes.classify(w,id)==='cannon';
    const ratio=mortar?1/.75:1;
    const hitDelta=0;
    assert(Math.abs(w.damagePerShot-old.damagePerShot*ratio)<1e-6,p.id+"/"+id);
    for(const [channel,value] of Object.entries(w.damageComponents))
      assert(Math.abs(value-old.damageComponents[channel]*ratio)<1e-6,p.id+"/"+id+"/"+channel);
    assert.deepEqual(w.nativePayload,old.nativePayload);
    assert.equal(w.en,old.en);assert.equal(w.attackRounds,old.attackRounds);
    assert.deepEqual([w.min,w.max,w.hit],[old.min,old.max,old.hit+hitDelta]);
    for(const [index,step] of (w.attack.steps||[]).entries())if(step.accuracy!==undefined)
      assert.equal(step.accuracy,old.attack.steps[index].accuracy+hitDelta);
    const firing=weapon=>weapon.attack.steps.map(step=>[step.shots,step.repeat,step.delay,step.muzzleIndex]);
    assert.deepEqual(firing(w),firing(old));
    if(mortar)count++;
  }
  assert(count>=29);
  for(const model of Object.values(after.models))for(const weapon of model.weapons)
    if(Classes.classify(weapon)==="mortar")assert.equal(weapon.damage%25,0);
});
