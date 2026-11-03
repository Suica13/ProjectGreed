const test = require("node:test"),
  assert = require("node:assert/strict");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
test("common and unit-specific rounds save as additive adjustments, are audited, and follow future baseline changes", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const unit = f.store.getUnit("RGM_79"),
    id = "EF_90mmMG";
  unit.id = unit.unit.id;
  assert.equal(unit.unit.weapons[id].attackRounds, 2);
  unit.unit.weapons[id].attackRounds = 4;
  f.store.saveUnit(unit);
  const ref = f.read("assets/units/RGM_79/unit.json").weapons[id].ref;
  assert.equal(
    f.read("shared/editor-adjustments.json").units.RGM_79["/weapons/" + id + "/attackRounds"],
    2,
  );
  const common = f.store.getWeapon(ref);
  common.weapon.attackRounds = 3;
  f.store.saveWeapon(common);
  assert.equal(f.store.getWeapon(ref).weapon.attackRounds, 3);
  assert.equal(f.store.getUnit("RGM_79").unit.weapons[id].attackRounds, 5);
  assert.equal(
    f.catalog().models.RGM_79__machine_gun.weapons.find((w) => w.id === id).attackRounds,
    5,
  );
  const invalid = f.store.getWeapon(ref);
  invalid.weapon.attackRounds = 1.5;
  assert.throws(() => f.store.saveWeapon(invalid), /整数/);
  const unchanged = f.store.getWeapon(ref);
  unchanged.weapon.attackRounds = -1;
  assert.throws(() => f.store.saveWeapon(unchanged), /整数/);
});
