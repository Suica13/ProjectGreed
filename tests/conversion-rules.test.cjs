const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const Conversion = require("../shared/conversion-rules.cjs");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");
const Codec = require("../tools/weapon-store.cjs");
const Schema = require("../shared/catalog-editor-schema.js");
test("conversion settings apply before additive unit offsets and log every affected unit", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const unit = f.store.getUnit("RX_78_2");
  unit.id = unit.unit.id;
  const beam = Object.keys(unit.unit.weapons).find(
    (id) => unit.unit.weapons[id].category === "beam_rifle",
  );
  const raw = f.read("assets/units/RX_78_2/unit.json");
  const base = Codec.expandPrefab(raw, f.read("assets/weapons.json").definitions).weapons[beam]
    .damagePerShot;
  const hp = unit.unit.stats.hp;
  Schema.setDamage(unit.unit.weapons[beam], unit.unit.weapons[beam].damagePerShot + 500);
  unit.unit.stats.hp += 500;
  f.store.saveUnit(unit);
  const offsets = f.read("shared/editor-adjustments.json");
  const rules = f.store.getConversion();
  rules.rules.weaponClasses.hand.beam.damage = 1.35;
  rules.rules.weapons.ap = 1.5;
  rules.rules.units.hp = 1.1;
  const result = f.store.saveConversion(rules, { ip: "127.0.0.1" });
  const current = f.store.getUnit(unit.id);
  assert.equal(current.unit.weapons[beam].damagePerShot, base * 1.35 + 500);
  assert.equal(current.unit.stats.hp, Math.ceil(hp * 1.1) + 500);
  assert.equal(
    Object.values(current.unit.weapons).find((w) => w.category === "machine_gun").actionCost,
    3,
  );
  assert.deepEqual(f.read("shared/editor-adjustments.json"), offsets);
  assert.deepEqual(f.read("assets/units/RX_78_2/unit.json").stats, raw.stats);
  const log = f.read(result.auditLog);
  assert.equal(log.operation, "conversion-rules");
  assert(log.units.some((u) => u.id === unit.id));
  assert(log.files.some((row) => row.file === Conversion.file));
  assert.throws(() => f.store.saveConversion(rules), /其他编辑/);
  const same = f.store.getConversion();
  assert.equal(f.store.saveConversion(same).noChanges, true);
});
test("invalid global fields and failed validation cannot change rules or generate a successful log", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const before = f.store.revision();
  for (const mutate of [
    (d) => (d.rules.weapons.ap = 0),
    (d) => (d.rules.units.hp = -1),
    (d) => (d.rules.weapons.machineGunAP = 1.5),
    (d) => (d.rules.extra = 1),
    (d) => delete d.rules.units,
  ]) {
    const d = f.store.getConversion();
    mutate(d);
    assert.throws(() => f.store.saveConversion(d));
    assert.equal(f.store.revision(), before);
  }
  const failing = require("../tools/catalog-editor-store.cjs").createEditorStore(f.root, () => {
    throw Error("injected failure");
  });
  const d = failing.getConversion();
  d.rules.weapons.ap = 1.1;
  assert.throws(() => failing.saveConversion(d), /injected failure/);
  assert.equal(f.store.revision(), before);
  assert(!fs.existsSync(path.join(f.root, "server-data/editor-changes")));
});
test("classification exclusions and repeated conversion remain correct with non-default multipliers", () => {
  const config = Conversion.read();
  config.weaponClasses.hand.beam.damage = 1.35;
  config.weapons.ap = 1.4;
  config.weapons.damage = 1.2;
  config.units.hp = 1.1;
  config.units.ap = 1.2;
  const library = require("../assets/weapons.json").definitions;
  for (const id of ["RX_78_4", "MS_06F", "SalamisClass", "MA_05"]) {
    const raw = require("../assets/units/" + id + "/unit.json");
    const unit = Codec.expandPrefab(raw, library);
    applyWeaponBalance(unit, config);
    const snapshot = structuredClone(unit);
    applyWeaponBalance(unit, config);
    assert.deepEqual(unit, snapshot, id);
    for (const weapon of Object.values(unit.weapons))
      assert(Number.isInteger(weapon.actionCost * 2));
  }
});

test("saving a unit while global skill damage is active preserves original skill payloads", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const before = f.read("assets/units/ApsarasII/unit.json");
  const config = f.store.getConversion();
  config.rules.weapons.damage = 1.25;
  f.store.saveConversion(config);
  const d = f.store.getUnit("ApsarasII");
  d.id = d.unit.id;
  d.unit.stats.hp += 500;
  f.store.saveUnit(d);
  assert.deepEqual(f.read("assets/units/ApsarasII/unit.json").skills, before.skills);
});
