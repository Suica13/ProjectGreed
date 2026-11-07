const test = require("node:test"),
  assert = require("node:assert/strict");
const Schema = require("../shared/catalog-editor-schema.js"),
  Sequence = require("../shared/weapon-sequence.js"),
  { editorFixture } = require("./catalog-editor-fixture.cjs");
test("base and independent payload damage can be edited separately without changing shots", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const data = f.store.getWeapon("ZN_120mmMGWithGrenadeLauncher__lv1"),
    w = data.weapon;
  const group = Schema.payloadGroups(w)[0],
    index = group.indices[0];
  assert(group.shots > 0);
  const before = structuredClone(w),
    base = Object.values(w.damageComponents).reduce((a, b) => a + b, 0);
  const grenade = Object.values(w.attack.steps[index].damageComponents).reduce((a, b) => a + b, 0);
  Schema.setDamage(w, base + 25, { preserveSteps: true });
  assert.deepEqual(
    w.attack.steps[index].damageComponents,
    before.attack.steps[index].damageComponents,
  );
  Schema.setStepDamage(w, group.indices, grenade + 500);
  assert.equal(w.damagePerShot, base + 25);
  f.store.saveWeapon(data);
  const saved = f.store.getWeapon(data.ref).weapon;
  assert.equal(saved.damagePerShot, base + 25);
  assert.equal(
    Object.values(saved.attack.steps[index].damageComponents).reduce((a, b) => a + b, 0),
    grenade + 500,
  );
  const registry = f.read("shared/editor-adjustments.json");
  assert.equal(
    registry.weapons[data.ref][`/attack/steps/${index}/damageComponents/shell`],
    (data.adjustments[`/attack/steps/${index}/damageComponents/shell`] || 0) + 500,
  );
  assert.deepEqual(
    saved.attack.steps.map((s) => [s.shots, s.delay, s.repeat, s.muzzleIndex]),
    before.attack.steps.map((s) => [s.shots, s.delay, s.repeat, s.muzzleIndex]),
  );
  const unit = f.store.getUnit("MS_06F_Stutzer");
  unit.id = unit.unit.id;
  const id = Object.keys(unit.unit.weapons).find((id) => id.includes("120mmMGWithGrenadeLauncher"));
  assert(id);
  const weapon = unit.unit.weapons[id],
    payload = Schema.payloadGroups(weapon)[0];
  const previous = structuredClone(weapon.damageComponents),
    old = weapon.attack.steps[payload.indices[0]].damageComponents.shell;
  Schema.setStepComponentDamage(weapon, payload.indices, "shell", old + 250);
  f.store.saveUnit(unit);
  const actual = f.store.getUnit(unit.id).unit.weapons[id];
  assert.deepEqual(actual.damageComponents, previous);
  assert.equal(actual.attack.steps[payload.indices[0]].damageComponents.shell, old + 250);
  assert.equal(Sequence.compile(actual).shotCount, Sequence.compile(weapon).shotCount);
});

test("multiplier-only payloads are discoverable and can become independent", () => {
  const weapon = {
    type: "shell",
    damageComponents: { shell: 500 },
    attack: { steps: [{ shots: 3 }, { shots: 1, damageMultiplier: 2 }] },
  };
  const group = Schema.payloadGroups(weapon)[0];
  assert.deepEqual(group.indices, [1]);
  assert.equal(group.shots, 1);
  Schema.setStepDamage(weapon, group.indices, 750);
  Schema.setDamage(weapon, 600, { preserveSteps: true });
  assert.deepEqual(weapon.attack.steps[1].damageComponents, { shell: 750 });
  assert.equal(weapon.attack.steps[1].damageMultiplier, 2);
  assert.deepEqual(weapon.damageComponents, { shell: 600 });
});
