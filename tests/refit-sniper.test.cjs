const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules.js"),Sequence=require("../shared/weapon-sequence.js");
test("all charged sniper attacks deal half their native damage including per-step payloads",()=>{
  let count=0;
  for(const p of G.catalog.prefabs)for(const w of Object.values(p.weapons))if(w.special?.type === "snipe") {
    count++;
    const native=structuredClone(w);Object.assign(native,native.sniperDamageBeforeHalving);
    for(const step of native.attack.steps)if(step.sniperDamageBeforeHalving)step.damageComponents=step.sniperDamageBeforeHalving;
    const reduced=Sequence.compile(w),original=Sequence.compile(native);
    const total=w=>w.attack.strikes.reduce((sum,s)=>sum+Object.values(s.damageComponents || w.damageComponents).reduce((a,b)=>a+b,0)*(s.damageMultiplier ?? 1),0);
    assert.equal(total(reduced),total(original)*.5,p.id);
    assert.equal(reduced.en,original.en);assert.equal(reduced.shotCount,original.shotCount);
  }
  assert.equal(count,8);
});
