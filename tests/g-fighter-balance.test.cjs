const test=require("node:test"),assert=require("node:assert/strict"),G=require("../shared/rules");
function output(id,distance) {
  const p=G.catalog.prefabs.find(p=>p.id===id);
  const game=G.create(false,1,[[{unitId:id,kitId:p.weaponKits[0].id}],
    [{unitId:"RGM_79",kitId:"machine_gun"}]],false,
    {costLimit:99999,unitCostLimit:99999,fogMode:"disabled"});
  game.tiles.forEach(row=>row.fill("plain"));game.deployment=null;
  const [actor,target]=game.units;
  Object.assign(actor,{x:5,y:5});Object.assign(target,{x:5+distance,y:5});
  return G.firePlan(game,actor,target).weapons.reduce((total,w)=>total+
    w.attack.strikes.reduce((sum,strike)=>sum+
      Object.values(strike.damageComponents||w.damageComponents).reduce((s,n)=>s+n,0)*
      (strike.damageMultiplier??1),0),0);
}
test("G Fighter gains 25 percent output with 25-point damage quantization",()=>{
  assert.deepEqual([1,2,3].map(d=>output("FF_X7Bst",d)),[16200,25800,9600]);
  assert.deepEqual([1,2,3].map(d=>output("G_Fighter",d)),[25200,40200,15000]);
});
test("the imported G Fighter derivative gains output without changing its native firing chain",()=>{
  const family=G.catalog.prefabs.filter(p=>p.source.includes("/G_Fighter/"));
  assert.deepEqual(family.map(p=>p.id).sort(),["G_Bull_Easy","G_Fighter"]);
  assert.equal(output("G_Bull_Easy",1),15450);
  assert.equal(output("G_Bull_Easy",2),15450);
  const m=Object.values(G.models).find(m=>m.prefabId==="G_Fighter");
  assert.equal(m.weapons.find(w=>w.id==="EF_G_Fighter_BR").shotCount,2);
  assert.equal(m.weapons.find(w=>w.id==="Common_DoubleMS_G_Fighter").shotCount,6);
  assert.equal(m.cost,700);
});
