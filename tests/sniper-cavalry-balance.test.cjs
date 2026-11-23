const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const Conversion = require("../shared/conversion-rules.cjs");
const Adjust = require("../shared/catalog-adjustments.cjs");
const {loadCatalog} = require("../tools/load-catalog.cjs");
const tree = require("../shared/development-tree.json");

test("all ordinary and charged sniper weapons have a three-cell minimum", () => {
  let count = 0;
  for (const model of Object.values(G.models)) for (const weapon of model.weapons) {
    if (weapon.category !== "sniper" && weapon.special?.type !== "snipe") continue;
    count++;
    assert.equal(weapon.min, 3, model.prefabId + "/" + weapon.id);
    const actor = {model:model.prefabId+"__"+model.kitId,x:10,y:10,hp:model.hp};
    assert(!G.inRange(actor, {x:12,y:10}, weapon));
    assert(G.inRange(actor, {x:13,y:10}, weapon));
  }
  assert(count >= 20);
});

test("charged sniper damage including editor exceptions falls by 25 percent, ordinary damage stays fixed", () => {
  const conversion = Conversion.read(), adjustments = Adjust.read();
  conversion.weapons.chargedSniperDamage = 1.875;
  conversion.weaponClasses.sniper.minRange = -1;
  const unit = adjustments.units.ZGMF_LRR704B;
  for (const field of ["damagePerShot","damageComponents/beam","damageComponents/beamAP"])
    unit["/weapons/ZGMF_LRR704B_LBR_Sniper_Aim/"+field] /= .75;
  const shared = adjustments.weapons.AEUG_MSZ_006C1_BeamSmartGun_Sniper_Aim__lv1;
  for (const field of ["/damagePerShot","/damageComponents/beam","/damageComponents/beamAP"]) shared[field] /= .75;
  const previous = loadCatalog({embedAssets:false, conversionOverride:conversion, adjustmentsOverride:adjustments});
  let charged = 0;
  for (const [id,model] of Object.entries(G.models)) for (const weapon of model.weapons) {
    const old = previous.models[id].weapons.find(w => w.id === weapon.id);
    const ratio = weapon.special?.type === "snipe" ? .75 : 1;
    if (ratio !== 1) charged++;
    const currentPayloads = [weapon,...(weapon.attack?.steps || [])];
    const oldPayloads = [old,...(old.attack?.steps || [])];
    currentPayloads.forEach((payload,index) => {
      for (const [channel,value] of Object.entries(payload.damageComponents || {})) {
        const expected = oldPayloads[index].damageComponents[channel] * ratio;
        assert(Math.abs(value - expected) <= (ratio === 1 ? 0 : 25), `${id}/${weapon.id}/${index}/${channel}`);
      }
    });
    assert.equal(weapon.en, old.en);
    assert.equal(weapon.max, old.max);
  }
  assert(charged >= 8);
});

test("Pale Rider Cavalry and HADES belong to the G4 plan and 0079T2", () => {
  const old = tree.EFSF.find(node => node.id === "Tech_EFSF_0079_PaleRiderProject");
  const g4 = tree.EFSF.find(node => node.id === "Tech_EFSF_0079_T2_G4Plan");
  assert(!old.unlocks.includes("RX_80PR_2"));
  assert(g4.unlocks.includes("RX_80PR_2"));
  assert.equal(g4.unlocks.filter(id=>id==="RX_80PR_2").length,1);
  for (const id of ["RX_80PR_2","RX_80PR_2_HADES"]) {
    const prefab = G.catalog.prefabs.find(p=>p.id===id);
    assert(prefab.tags.includes(g4.era));
    assert(!prefab.tags.includes("UC_0079_T1"));
  }
});
