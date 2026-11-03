const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const Conversion = require("../shared/conversion-rules.cjs");
const Auto = require("../shared/automatic-fire.js");
const {loadCatalog} = require("../tools/load-catalog.cjs");
const rules = Conversion.read(), previous = structuredClone(rules);
previous.weapons.damage = 1; previous.units.move = 1;
const empty = {schemaVersion:1,units:{},weapons:{},prices:{}};
const before = loadCatalog({conversionOverride:previous,adjustmentsOverride:empty});
const after = loadCatalog({adjustmentsOverride:empty});
test("all imported units halve base movement while retaining tactical additions",()=>{
  for(const p of after.prefabs){
    const bonus = Number.isFinite(p.sourceStats?.tacticalMoveBeforeBonus) ? (p.stats.ship?3:1) : 0;
    for(const [id,m] of Object.entries(after.models).filter(([,m])=>m.prefabId===p.id)){
      assert.equal(m.move,p.stats.deployed?0:Math.max(1,Math.round((before.models[id].move-bonus)*.5)+bonus),id);
    }
  }
});
test("all weapon damage channels receive global 0.75 before existing damage rounding",()=>{
  let count=0;
  for(const [id,m] of Object.entries(after.models))for(const w of m.weapons){
    const old=before.models[id].weapons.find(x=>x.id===w.id);
    // Both catalogs round source components to 25; rounding the unrounded
    // payload at the new scale may differ by one damage step.
    assert.ok(Math.abs(w.damagePerShot-old.damagePerShot*.75)<=25,id+"/"+w.id);
    assert.equal(w.attack.shots.length,old.attack.shots.length);
    count++;
  }
  assert.ok(count>1000);
});
test("weapon classifications no longer impose fixed volley counts",()=>{
  assert.equal(Auto.rounds,undefined);
  assert.equal(typeof Auto.plan,"function");
});

test("pilot cost uses only the formation budget, never the per-chassis cost limit",()=>{
  const pilot=G.pilots.custom({...G.pilots.createCustom("custom-budget-pilot","Budget"),level:10});
  const entry={unitId:"RGM_79",kitId:"machine_gun",customPilot:pilot};
  const chassis=G.formationModel(entry).cost, pc=G.pilots.cost(pilot);
  assert.ok(pc>0);
  const plan=G.planFormation([entry],chassis+pc,{unitCostLimit:chassis});
  assert.deepEqual(plan.disabled,[]);
  assert.equal(plan.totalCost,chassis+pc);
  assert.equal(G.formationModel(entry).cost,chassis);
  assert.deepEqual(G.planFormation([entry],chassis+pc-1,{unitCostLimit:chassis}).disabled,[0]);
  assert.deepEqual(G.planFormation([entry],chassis+pc,{unitCostLimit:chassis-1}).disabled,[0]);
});
