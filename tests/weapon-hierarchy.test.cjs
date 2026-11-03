const test = require("node:test"),
  assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Classes = require("../shared/weapon-classes.js"),
  Conversion = require("../shared/conversion-rules.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const catalog = loadCatalog();

test("every weapon uses type-only classification with no limb taxonomy or multipliers", () => {
  assert.equal(Classes.mainClass, undefined);
  assert.equal(Classes.mainLabels, undefined);
  for (const p of catalog.prefabs)
    for (const [id, w] of Object.entries(p.weapons)) assert(Classes.valid(Classes.classify(w, id)));
  const p = catalog.prefabs.find((p) => p.id === "RX_78_4");
  assert.equal(Classes.classify(p.weapons.Common_ArmBR_Pink), "beam_gun");
  assert.equal(p.weapons.Common_ArmBR_Pink.damagePerShot, 3250 * 0.75);
  assert.equal(p.weapons.Common_ArmBR_Pink_L.damagePerShot, 3250 * 0.75);
  for (const key of ["hand", "body", "wrist", "head", "internal", "leg"])
    assert.equal(catalog.conversionRules.weaponClasses[key], undefined);
});

test("group base values and AP, EN, accuracy and range multipliers all affect compiled weapons", () => {
  const config = Conversion.read();
  Object.assign(config.weaponClasses.machine_gun, {
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
  assert.deepEqual([w.min, w.max], [1, 4]);
  assert(w.attack.strikes.every((s) => Math.abs((s.accuracy ?? w.hit) - 88) < 1e-8));
  const other = changed.models.RX_78_2__kit_1.weapons.find((w) => w.id === "EF_RX_78_2_BR");
  assert.equal(other.actionCost, 4);
});

test("group configuration saves atomically, preserves manual offsets and rejects incomplete or invalid paths", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const offsets = f.read("shared/editor-adjustments.json");
  const d = f.store.getConversion();
  d.rules.weaponClasses.missile.baseEN = 25;
  d.rules.weaponClasses.missile.baseAP = 1.5;
  const saved = f.store.saveConversion(d);
  assert(saved.auditLog);
  assert.equal(f.store.getUnit("RX_80PR").unit.weapons.EF_RX_80PR_LegMS.en, 25);
  assert.equal(f.store.getUnit("RX_80PR").unit.weapons.EF_RX_80PR_LegMS.actionCost, 3);
  assert.deepEqual(f.read("shared/editor-adjustments.json"), offsets);
  const revision = f.store.revision(),
    invalid = f.store.getConversion();
  invalid.rules.weaponClasses.missile.baseEN = -0.5;
  assert.throws(() => f.store.saveConversion(invalid));
  assert.equal(f.store.revision(), revision);
  delete invalid.rules.weaponClasses.beam_rifle;
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
  Object.assign(config.weaponClasses.irradiation, {
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
  assert.deepEqual([skill.minRange, skill.range], [1, 4]);
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
