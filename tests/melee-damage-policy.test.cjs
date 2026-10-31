const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadCatalog } = require('../tools/load-catalog.cjs');
const { applyWeaponBalance } = require('../tools/weapon-balance.cjs');
const S = require('../shared/weapon-sequence.js');

test('all melee weapons gain only 10 percent, ramming stays native, and source data stays intact', () => {
  let melee = 0, beamMelee = 0, ramming = 0;
  for (const prefab of loadCatalog().prefabs) {
    const raw = require("../tools/weapon-store.cjs").parse(fs.readFileSync(`assets/units/${prefab.id}/unit.json`, 'utf8'));
    for (const [id, before] of Object.entries(raw.weapons)) {
      if (before.type !== 'melee' && before.category !== 'melee') continue;
      const after = prefab.weapons[id];
      const factor = id.startsWith('Common_Push_') ? 1 : 1.1;
      if (factor === 1) ramming++; else melee++;
      if (Object.entries(before.damageComponents).some(([k,v]) => /beam/i.test(k) && v > 0)) beamMelee++;
      assert.ok(Math.abs(after.damagePerShot - before.damagePerShot * factor) < 1e-7, prefab.id + '/' + id);
      assert.equal(after.beamDamageScale ?? 1, 1);
      const expected = structuredClone(before);
      for (const payload of [expected, ...expected.attack.steps]) {
        for (const key of ['damage', 'damagePerShot']) if (Number.isFinite(payload[key])) payload[key] *= factor;
        if (payload.damageComponents) for (const key of Object.keys(payload.damageComponents)) payload.damageComponents[key] *= factor;
      }
      assert.equal(S.compile(after).damage, S.compile(expected).damage, prefab.id + '/' + id);
      assert.deepEqual(after.nativePayload, before.nativePayload);
      assert.equal(after.en, before.en);
      assert.equal(after.actionCost, before.actionCost);
    }
    const once = structuredClone(prefab);
    applyWeaponBalance(prefab);
    assert.deepEqual(prefab, once);
  }
  assert.ok(melee > 100 && beamMelee > 50 && ramming > 100);
});
