const test=require("node:test"), assert=require("node:assert/strict");
const G=require("../shared/rules"), Conversion=require("../shared/conversion-rules.cjs");
const Codec=require("../tools/weapon-store.cjs"), Adjust=require("../shared/catalog-adjustments.cjs");
const {applyWeaponBalance}=require("../tools/weapon-balance.cjs");

test("a COST-only capture preserves raw weapon metadata and numeric baselines",()=>{
  const raw=Codec.expandPrefab(require("../assets/units/Medea/unit.json"),require("../assets/weapons.json").definitions);
  const current=applyWeaponBalance(structuredClone(raw));
  const next=structuredClone(current);next.stats.cost-=75;
  const captured=Adjust.capture(raw,current,next);
  assert.deepEqual(captured.source,raw);
  assert.deepEqual(captured.deltas,{"/stats/cost":-75});
});

test("requested transport and deployed-form final COSTs match every kit",()=>{
  const expected={Medea:250,Medea_DeployState:250,FatUncle:250,FatUncle_DeployState:250,
    MedeaKai:300,MedeaKai_DeployState:300,FatUncleKai:300,FatUncleKai_DeployState:300,
    ColumbusClassKai:350,PazockClass:350};
  for(const [id,cost] of Object.entries(expected)){
    const prefab=G.catalog.prefabs.find(p=>p.id===id);assert(prefab,id);
    assert.equal(prefab.stats.cost,cost,id);
    for(const kit of prefab.weaponKits)assert.equal(G.models[id+"__"+kit.id].cost,cost,id);
  }
});

test("all ships use native accuracy times 80 percent, before existing faction/global/editor modifiers",()=>{
  const deltas=Adjust.read();let checked=0;
  for(const p of G.catalog.prefabs.filter(p=>p.stats.ship)){
    const native=p.sourceStats.accuracy;
    const faction=p.sourceStats.shipFactionAccuracyMultiplier??1;
    const expected=Math.round(Math.round(native*0.8*faction*Conversion.read().units.accuracy)+(deltas.units[p.id]?.["/stats/accuracy"]??0));
    assert.equal(p.stats.accuracy,expected,p.id);
    assert.equal(p.stats.accuracyMultiplier,0.8,p.id);
    for(const kit of p.weaponKits)assert.equal(G.models[p.id+"__"+kit.id].accuracy,expected,p.id);
    checked++;
  }
  assert(checked>=50);
});

test("native-anchored ship accuracy is idempotent and supports live global conversion changes",()=>{
  const rules=Conversion.read(), library=require("../assets/weapons.json").definitions;
  for(const id of ["SalamisClass","MusaiClass","ColumbusClassKai"]){
    const p=Codec.expandPrefab(require(`../assets/units/${id}/unit.json`),library);
    applyWeaponBalance(p,rules);const snapshot=structuredClone(p);
    applyWeaponBalance(p,rules);assert.deepEqual(p,snapshot,id);
    const changed=structuredClone(rules);changed.units.shipAccuracy=0.9;changed.units.accuracy=1.1;
    applyWeaponBalance(p,changed);
    assert.equal(p.stats.accuracy,Math.round(p.sourceStats.accuracy*(p.sourceStats.shipFactionAccuracyMultiplier??1)*0.9*1.1));
  }
  const p=Codec.expandPrefab(require("../assets/units/RGM_79/unit.json"),library);
  applyWeaponBalance(p,rules);assert.equal(p.stats.accuracy,115);
});
