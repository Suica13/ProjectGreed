const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadCatalog } = require('../tools/load-catalog.cjs');
const { applyWeaponBalance } = require('../tools/weapon-balance.cjs');
const S = require('../shared/weapon-sequence.js');

test('ramming is reduced by 25 percent and source data stays intact', () => {
  let ramming = 0;
  for (const prefab of loadCatalog().prefabs) {
    const raw = require("../tools/weapon-store.cjs").parse(fs.readFileSync(`assets/units/${prefab.id}/unit.json`, 'utf8'));
    for (const [id, before] of Object.entries(raw.weapons)) {
      if (!id.startsWith('Common_Push_')) continue;
      const after = prefab.weapons[id];
      const factor = 0.5625;
      ramming++;

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
    const meleeOnly = { stats: prefab.stats, weapons: Object.fromEntries(
      Object.entries(prefab.weapons).filter(([id]) => id.startsWith('Common_Push_'))) };
    const once = structuredClone(meleeOnly);
    applyWeaponBalance(meleeOnly);
    assert.deepEqual(meleeOnly.weapons, once.weapons);
  }
  assert.ok(ramming > 100);
});
