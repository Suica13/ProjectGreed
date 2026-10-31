const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadCatalog } = require('../tools/load-catalog.cjs');
const { applyWeaponLevelLabels } = require('../tools/weapon-level-labels.cjs');
const catalog = loadCatalog();

test('all compiled weapon names show their native grade from Lv2 in every language', () => {
  let graded = 0;
  for (const prefab of catalog.prefabs) for (const weapon of Object.values(prefab.weapons)) {
    assert.ok(Number.isInteger(weapon.level) && weapon.level >= 1);
    assert.equal(typeof weapon.levelSource, 'string');
  }
  for (const model of Object.values(catalog.models)) for (const weapon of model.weapons) {
    for (const name of [weapon.name, ...Object.values(weapon.localization || {}).map(l => l.name)]) {
      if (weapon.level >= 2) {
        assert.ok(name.endsWith('Lv.' + weapon.level), model.prefabId + '/' + weapon.id + ': ' + name);
        assert.equal((name.match(/Lv\.\d+/g) || []).length, 1);
      } else assert.doesNotMatch(name, /Lv\.1(?:\D|$)/);
    }
    if (weapon.level >= 2) graded++;
  }
  assert.ok(graded > 100);
  const prefab = structuredClone(catalog.prefabs[0]);
  const once = JSON.stringify(prefab);
  applyWeaponLevelLabels(prefab);
  assert.equal(JSON.stringify(prefab), once);
});

test('Unit 4 and Bst use equal grade-2 wrist guns without beam-rifle scaling', () => {
  for (const model of Object.values(catalog.models).filter(m => ['RX_78_4', 'RX_78_4_Bst'].includes(m.prefabId))) {
    for (const id of ['Common_ArmBR_Pink', 'Common_ArmBR_Pink_L']) {
      const w = model.weapons.find(w => w.id === id);
      assert.equal(w.level, 2);
      assert.equal(w.damagePerShot, 3250);
      assert.equal(w.shotCount, 3);
      assert.equal(w.damage, 9750);
      assert.equal(w.beamDamageScale ?? 1, 1);
    }
    const raw = JSON.parse(fs.readFileSync(`assets/units/${model.prefabId}/unit.json`, 'utf8'));
    assert.equal(raw.weapons.Common_ArmBR_Pink_L.nativePayload.BeamDamage, 3750);
  }
});
