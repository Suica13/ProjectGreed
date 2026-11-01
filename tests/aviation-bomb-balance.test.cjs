const test=require("node:test"),assert=require("node:assert/strict");
const {loadCatalog}=require("../tools/load-catalog.cjs"),Classes=require("../shared/weapon-classes");
const rules=require("../shared/conversion-rules.json"),beforeRules=structuredClone(rules);
for(const group of Object.values(beforeRules.weaponClasses))group.bomb.damage/=.75;
const options={adjustmentsOverride:{schemaVersion:1,units:{},weapons:{},prices:{}}};
const before=loadCatalog({...options,conversionOverride:beforeRules}),after=loadCatalog(options);
test("all aviation bomb payloads lose 25 percent while other weapons and native firing data stay unchanged",()=>{
 let count=0;
 for(const p of after.prefabs){
  const old=before.prefabs.find(other=>other.id===p.id);
  for(const [id,w]of Object.entries(p.weapons)){
   const b=old.weapons[id],bomb=Classes.classify(w,id)==='bomb';
   assert.equal(w.damagePerShot,b.damagePerShot*(bomb?.75:1),p.id+"/"+id);
   assert.deepEqual(w.nativePayload,b.nativePayload);
   assert.equal(w.actionCost,b.actionCost);assert.equal(w.en,b.en);
   assert.deepEqual(w.attack.steps.map(s=>[s.shots,s.repeat,s.delay]),b.attack.steps.map(s=>[s.shots,s.repeat,s.delay]));
   if(bomb)count++;
  }
 }
 assert(count>=6);
 for(const m of Object.values(after.models))for(const w of m.weapons)if(Classes.classify(w)==='bomb')assert.equal(w.damage%25,0);
});
