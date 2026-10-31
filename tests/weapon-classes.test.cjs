const test = require("node:test"),
  assert = require("node:assert/strict");
const Classes = require("../shared/weapon-classes.js"),
  Conversion = require("../shared/conversion-rules.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");
const Codec = require("../tools/weapon-store.cjs");
const { editorFixture } = require("./catalog-editor-fixture.cjs");

test("every weapon has a valid balance class, including skill weapons and physical rifles", () => {
  const catalog = loadCatalog();
  let count = 0;
  for (const model of Object.values(catalog.models))
    for (const weapon of model.weapons) {
      assert(Classes.valid(Classes.classify(weapon)), model.prefabId + "/" + weapon.id);
      assert(Classes.rules(weapon, catalog.conversionRules).length >= 6);
      count++;
    }
  assert(count > 1000);
  for (const [sourceName, category, type, expected] of [
    ["Common_ArmBR_Pink", "beam_rifle", "beam", "wrist"],
    ["Common_ArmBeamSaber_B", "melee", "melee", "melee"],
    ["Common_DoubleVulcan_MS", "machine_gun", "shell", "head_vulcan"],
    ["Common_DoubleVulcan_FF_4", "machine_gun", "shell", "small_vulcan"],
    ["SalamisClass_Turret_AA", "machine_gun", "shell", "close_defense"],
    ["Common_Grenade_A", "other", "shell", "grenade"],
    ["EF_LongRifle", "beam_rifle", "shell", "rifle"],
    ["Common_Push_A", "melee", "melee", "ram"],
  ])
    assert.equal(Classes.classify({ sourceName, category, type }), expected);
  assert.equal(Classes.classify({ type: "irradiation" }), "irradiation");
});

test("explicit classes control balance without changing source damage channels or firing steps", () => {
  const raw = Codec.expandPrefab(
    require("../assets/units/RX_78_2/unit.json"),
    require("../assets/weapons.json").definitions,
  );
  const source = raw.weapons.EF_RX_78_2_BR;
  for (const [kind, scale, cost, range] of [
    ["wrist", 1, 3, 2],
    ["beam_rifle", 1.5, 4, 4],
    ["machine_gun", 0.75, 4, 4],
    ["bazooka", 1.25, 6, 4],
    ["sniper", 1, 4, 5],
  ]) {
    const p = structuredClone(raw);
    p.weapons.EF_RX_78_2_BR.weaponClass = kind;
    applyWeaponBalance(p);
    const weapon = p.weapons.EF_RX_78_2_BR;
    assert.equal(weapon.damagePerShot, source.damagePerShot * scale);
    assert.equal(weapon.actionCost, cost);
    assert.equal(weapon.max, range);
    assert.equal(weapon.type, source.type);
    assert.deepEqual(weapon.nativePayload, source.nativePayload);
    assert.deepEqual(
      weapon.attack.steps.map((s) => [s.shots, s.delay, s.muzzleIndex]),
      source.attack.steps.map((s) => [s.shots, s.delay, s.muzzleIndex]),
    );
    const saved = structuredClone(p);
    applyWeaponBalance(p);
    assert.deepEqual(p, saved);
  }
  assert.throws(() => Classes.classify({ weaponClass: "invalid" }), /classification/);
});

test("common and unit-specific classifications persist, rebase, audit and reject invalid values atomically", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const ref = f.read("assets/units/RX_78_2/unit.json").weapons.EF_RX_78_2_BR.ref;
  const before = f.store.getWeapon(ref),
    source = structuredClone(before.weapon);
  before.weapon.weaponClass = "wrist";
  const saved = f.store.saveWeapon(before);
  assert(saved.auditLog);
  assert.equal(f.read("assets/weapons.json").definitions[ref].weaponClass, "wrist");
  assert.equal(f.read("assets/weapons.json").definitions[ref].damagePerShot, source.damagePerShot);
  assert.equal(f.store.getUnit("RX_78_2").unit.weapons.EF_RX_78_2_BR.actionCost, 3);
  const unit = f.store.getUnit("RX_78_2");
  unit.id = unit.unit.id;
  unit.unit.weapons.EF_RX_78_2_BR.weaponClass = "sniper";
  f.store.saveUnit(unit);
  assert.equal(f.store.getUnit("RX_78_2").unit.weapons.EF_RX_78_2_BR.max, 5);
  assert.equal(f.read("assets/weapons.json").definitions[ref].weaponClass, "wrist");
  const invalid = f.store.getWeapon(ref),
    revision = f.store.revision();
  invalid.weapon.weaponClass = "unknown";
  assert.throws(() => f.store.saveWeapon(invalid), /classification/);
  assert.equal(f.store.revision(), revision);
  assert.equal(Object.keys(f.read("shared/editor-adjustments.json").weapons[ref] || {}).length, 0);
});

test("irradiation templates support classification-only edits without baking converted skill payloads", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const [ref, original] = Object.entries(f.read("assets/weapons.json").definitions).find(
    ([, w]) => w.sourceWeapon && w.type === "irradiation",
  );
  const data = f.store.getWeapon(ref);
  data.weapon.weaponClass = "wrist";
  f.store.saveWeapon(data);
  assert.deepEqual(f.read("assets/weapons.json").definitions[ref], {
    ...original,
    weaponClass: "wrist",
  });
  const skill = f
    .catalog()
    .prefabs.flatMap((p) => p.skills || [])
    .find((s) => s.sourceWeapon === original.sourceWeapon);
  assert.equal(skill.actionCost, 3);
  assert.equal(skill.range, 2);
  const invalid = f.store.getWeapon(ref);
  invalid.weapon.actionCost += 1;
  assert.throws(() => f.store.saveWeapon(invalid), /仅支持/);
});
