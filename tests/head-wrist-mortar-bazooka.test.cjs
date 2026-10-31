const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const Conversion = require("../shared/conversion-rules.cjs");
const Codec = require("../tools/weapon-store.cjs");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const catalog = loadCatalog();

test("head vulcans and wrist guns have final 3 AP and 1–2 range without changing other arm weapons", () => {
  let count = 0;
  for (const model of Object.values(catalog.models))
    for (const w of model.weapons)
      if (Conversion.isHeadOrWrist(w)) {
        assert.deepEqual([w.actionCost, w.min, w.max], [3, 1, 2], model.prefabId + "/" + w.id);
        count++;
      }
  assert(count > 100);
  for (const sourceName of [
    "Common_ArmBeamSaber_B",
    "Common_DoubleVulcan_FF_4",
    "Common_SingleVulcan_RX_79_G",
    "Common_DoubleVulcan_MS_MSM_04N",
    "EF_FA_78_1_BR",
  ])
    assert.equal(Conversion.isHeadOrWrist({ sourceName }), false, sourceName);
});

test("mortar accuracy scales by 1.10, all bazookas by 1.25, and FA781 keeps its 1.5 beam-rifle scale", () => {
  let mortars = 0,
    bazookas = 0,
    beamBazookas = 0;
  for (const p of catalog.prefabs) {
    const raw = Codec.parse(
      fs.readFileSync(path.join(__dirname, "../assets/units", p.id, "unit.json")),
    );
    for (const [id, before] of Object.entries(raw.weapons)) {
      const after = p.weapons[id];
      if (before.category === "mortar") {
        assert.equal(after.hit, before.hit * 1.1, p.id + "/" + id);
        for (let i = 0; i < before.attack.steps.length; i++)
          if (before.attack.steps[i].accuracy !== undefined)
            assert.equal(after.attack.steps[i].accuracy, before.attack.steps[i].accuracy * 1.1);
        mortars++;
      }
      if (before.category === "bazooka") {
        assert.equal(after.damagePerShot, before.damagePerShot * 1.25, p.id + "/" + id);
        assert.equal(after.beamDamageScale ?? 1, 1);
        assert.deepEqual(after.nativePayload, before.nativePayload);
        bazookas++;
        if (before.type === "beam") beamBazookas++;
      }
    }
  }
  assert(mortars > 10 && bazookas > 50 && beamBazookas > 0);
  const fa = catalog.prefabs.find((p) => p.id === "FA_78_1");
  for (const id of ["EF_FA_78_1_BR", "EF_FA_78_1_BR_R"]) {
    assert.equal(fa.weapons[id].damagePerShot, 7500);
    assert.equal(fa.weapons[id].classDamageScale, 1.5);
  }
});

test("fractional AP conversion and repeated changes to classification rules preserve native data", () => {
  const config = Conversion.read();
  config.weapons.ap = 1.25;
  config.weapons.accuracy = 0.9;
  config.units.ap = 1.05;
  const custom = loadCatalog({ conversionOverride: config });
  assert(Object.values(custom.models).some((m) => m.weapons.some((w) => w.actionCost % 1 === 0.5)));
  assert(custom.prefabs.some((p) => p.stats.actionPoints % 1 === 0.5));
  for (const p of custom.prefabs) {
    const saved = structuredClone(p);
    applyWeaponBalance(p, config);
    assert.deepEqual(p, saved, p.id);
  }
  const p = structuredClone(
    custom.prefabs.find((p) => Object.values(p.weapons).some((w) => w.category === "mortar")),
  );
  for (const group of Object.values(config.weaponClasses)) group.mortar.accuracy = 1.2;
  applyWeaponBalance(p, config);
  const saved = structuredClone(p);
  applyWeaponBalance(p, config);
  assert.deepEqual(p, saved);
  for (const n of [0, 0.25, 1.75, 2.25]) assert(Number.isInteger(Conversion.roundAP(n) * 2));
});
