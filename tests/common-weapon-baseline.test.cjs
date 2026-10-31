const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { editorFixture } = require("./catalog-editor-fixture.cjs");

test("common head vulcan uses converted 3 AP baseline and stores only final-value offsets", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const ref = f.read("assets/units/RX_78_2/unit.json").weapons.Common_DoubleVulcan_MS.ref;
  const originalLibrary = f.read("assets/weapons.json");
  assert.equal(originalLibrary.definitions[ref].actionCost, 1);
  const initial = f.store.getWeapon(ref);
  assert.equal(initial.baseline.actionCost, 3);
  const previousOffset = f.read("shared/editor-adjustments.json").weapons[ref]?.["/actionCost"] || 0;
  assert.equal(initial.weapon.actionCost, 3 + previousOffset);
  assert.equal(f.store.saveWeapon(initial).noChanges, true);
  assert.deepEqual(f.read("assets/weapons.json"), originalLibrary);

  const draft = f.store.getWeapon(ref);
  draft.weapon.actionCost = 2;
  f.store.saveWeapon(draft);
  assert.equal(f.read("shared/editor-adjustments.json").weapons[ref]["/actionCost"], -1);
  assert.equal(f.store.getWeapon(ref).weapon.actionCost, 2);
  assert.equal(f.store.getUnit("RX_78_2").unit.weapons.Common_DoubleVulcan_MS.actionCost, 2);
  assert.deepEqual(f.read("assets/weapons.json"), originalLibrary);

  const rules = f.read("shared/conversion-rules.json");
  rules.weapons.headWristAP = 4;
  fs.writeFileSync(path.join(f.root, "shared/conversion-rules.json"), JSON.stringify(rules));
  const rebased = f.store.getWeapon(ref);
  assert.equal(rebased.baseline.actionCost, 4);
  assert.equal(rebased.weapon.actionCost, 3);
  assert.equal(f.store.getUnit("RX_78_2").unit.weapons.Common_DoubleVulcan_MS.actionCost, 3);
  assert.equal(f.store.saveWeapon(rebased).noChanges, true);
  assert.deepEqual(f.read("assets/weapons.json"), originalLibrary);
});
