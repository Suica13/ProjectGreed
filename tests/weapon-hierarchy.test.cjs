const test = require("node:test"),
  assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Classes = require("../shared/weapon-classes.js"),
  Conversion = require("../shared/conversion-rules.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const catalog = loadCatalog();

test("every weapon exposes a main/subclass path and the named built-in weapons use the correct mounts", () => {
  for (const p of catalog.prefabs)
    for (const [id, w] of Object.entries(p.weapons)) {
      assert(Classes.validMain(Classes.mainClass(w, id)), p.id + "/" + id);
      assert(Classes.valid(Classes.classify(w, id)), p.id + "/" + id);
    }
  for (const [unit, id, main, sub] of [
    ["RX_78_4", "Common_ArmBR_Pink", "wrist", "beam"],
    ["RX_78_2", "EF_RX_78_2_BR", "hand", "beam"],
    ["RX_79_BD_1", "EF_RX_79_BD_ChestMS_Line", "internal", "missile"],
    ["RX_79_G", "Common_SingleVulcan_RX_79_G", "internal", "small_vulcan"],
    ["MSM_07", "ZN_MSM_07_BG", "internal", "beam"],
    ["RX_80PR", "EF_RX_80PR_LegMS", "leg", "missile"],
    ["RX_78_2", "Common_DoubleVulcan_MS", "head", "small_vulcan"],
  ]) {
    const w = catalog.prefabs.find((p) => p.id === unit).weapons[id];
    assert.deepEqual([Classes.mainClass(w), Classes.classify(w)], [main, sub]);
  }
  for (const main of Object.keys(Classes.mainLabels)) {
    assert.equal(catalog.conversionRules.weaponClasses[main].bazooka.damage, 1.25);
    assert.equal(catalog.conversionRules.weaponClasses[main].machine_gun.damage, 0.75);
    assert.equal(catalog.conversionRules.weaponClasses[main].mortar.accuracy, 1.1);
  }
  assert.equal(catalog.conversionRules.weaponClasses.hand.beam.damage, 1.5);
  assert.equal(catalog.conversionRules.weaponClasses.wrist.beam.damage, 0.75);
});

test("both wrist beam guns lose exactly 25 percent before the shared 25-point quantization", () => {
  for (const unit of ["RX_78_4", "RX_78_4_Bst"]) {
    const p = catalog.prefabs.find((p) => p.id === unit);
    assert.equal(p.weapons.Common_ArmBR_Pink.damagePerShot, 3250 * 0.75);
    assert.equal(p.weapons.Common_ArmBR_Pink_L.damagePerShot, 3250 * 0.75);
    const model = Object.values(catalog.models).find((m) => m.prefabId === unit);
    for (const w of model.weapons.filter((w) => Classes.wristBeam(w))) {
      assert.equal(w.damagePerShot, 2450);
      assert.equal(w.actionCost, 3);
      assert.equal(w.min, 1);
      assert.equal(w.max, 2);
    }
  }
});

test("group base values and AP, EN, accuracy and range multipliers all affect compiled weapons", () => {
  const config = Conversion.read();
  Object.assign(config.weaponClasses.hand.machine_gun, {
    baseAP: 2.5,
    baseEN: 9,
    baseHit: 80,
    minRange: 1,
    maxRange: 5,
    ap: 1.2,
    en: 1.5,
    accuracy: 1.1,
    range: 1.2,
    rangeBonus: 1,
  });
  const changed = loadCatalog({ conversionOverride: config });
  const w = changed.models.RGM_79__machine_gun.weapons.find((w) => w.id === "EF_90mmMG");
  assert.equal(w.actionCost, 6);
  assert.equal(w.en, 14);
  assert.equal(w.hit, 88);
  assert.deepEqual([w.min, w.max], [1, 8]);
  assert(w.attack.strikes.every((s) => Math.abs((s.accuracy ?? w.hit) - 88) < 1e-8));
  const other = changed.models.RX_78_2__kit_1.weapons.find((w) => w.id === "EF_RX_78_2_BR");
  assert.equal(other.actionCost, 4);
});

test("group configuration saves atomically, preserves manual offsets and rejects incomplete or invalid paths", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const offsets = f.read("shared/editor-adjustments.json");
  const d = f.store.getConversion();
  d.rules.weaponClasses.leg.missile.baseEN = 25;
  d.rules.weaponClasses.leg.missile.baseAP = 1.5;
  const saved = f.store.saveConversion(d);
  assert(saved.auditLog);
  assert.equal(f.store.getUnit("RX_80PR").unit.weapons.EF_RX_80PR_LegMS.en, 25);
  assert.equal(f.store.getUnit("RX_80PR").unit.weapons.EF_RX_80PR_LegMS.actionCost, 3);
  assert.deepEqual(f.read("shared/editor-adjustments.json"), offsets);
  const revision = f.store.revision(),
    invalid = f.store.getConversion();
  invalid.rules.weaponClasses.leg.missile.baseEN = -0.5;
  assert.throws(() => f.store.saveConversion(invalid));
  assert.equal(f.store.revision(), revision);
  delete invalid.rules.weaponClasses.head.beam;
  assert.throws(() => f.store.saveConversion(invalid));
});

test("LegR and LegL are right and left legs in the import naming policy", () => {
  const result = spawnSync(
    "python",
    [
      "-c",
      `import sys;sys.path.insert(0,'tools');from native_weapon_names import label
assert label('Common_LegR_MS',{'type':'shell'})[0]=='右腿导弹发射器'
assert label('Common_LegL_BR',{'type':'beam'})[0]=='左腿光束枪'
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("percentage-EN weapon skills honor fixed group EN/AP overrides in authoritative skill execution", () => {
  const G = require("../shared/rules.js");
  const config = Conversion.read();
  Object.assign(config.weaponClasses.body.irradiation, {
    baseEN: 30,
    en: 2,
    baseAP: 2.5,
    baseHit: 75,
    minRange: 2,
    maxRange: 6,
  });
  const changed = loadCatalog({ conversionOverride: config });
  const key = Object.keys(changed.models).find(
    (key) => changed.models[key].prefabId === "RX_78_4_Bst",
  );
  const skill = changed.models[key].skills.find((skill) => skill.type === "irradiation");
  assert.equal(skill.enCost, 60);
  assert.equal(skill.actionCost, 5);
  assert.equal(skill.baseHit, 75);
  assert.deepEqual([skill.minRange, skill.range], [2, 7]);
  const original = G.models[key];
  G.models[key] = { ...original, skills: [skill] };
  try {
    const g = G.create(
      false,
      1,
      [
        [{ unitId: original.prefabId, kitId: original.kitId }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    g.fogMode = "disabled";
    g.tiles.forEach((row) => row.fill("plain"));
    const unit = g.units[0];
    Object.assign(unit, { x: 5, y: 8 });
    const before = unit.en,
      ap = unit.actionPoints;
    assert(G.canUseSkill(g, unit, skill.id));
    const target = G.skillTargets(g, unit, skill.id)[0];
    assert(target);
    G.useSkill(g, unit, skill.id, target.x, target.y);
    assert.equal(unit.en, before - 60);
    assert.equal(unit.actionPoints, ap - 5);
  } finally {
    G.models[key] = original;
  }
});
