const test = require('node:test'), assert = require('node:assert/strict');
const Conversion = require('../shared/conversion-rules.cjs');
const Classes = require('../shared/weapon-classes.js');
const {applyWeaponBalance} = require('../tools/weapon-balance.cjs');
const Codec = require('../tools/weapon-store.cjs');

test('machine guns remove their extra damage penalty without changing the global, vulcan or close-defense factors', () => {
  const rules = Conversion.read(), defaults = Classes.defaultRules();
  assert.equal(rules.weapons.damage, .75);
  for (const config of [rules.weaponClasses, defaults]) {
    assert.equal(config.machine_gun.damage, 1);
    assert.equal(config.small_vulcan.damage, .75);
    assert.equal(config.close_defense.damage, .75);
  }
  const raw = Codec.expandPrefab(require('../assets/units/RGM_79/unit.json'), require('../assets/weapons.json').definitions);
  for (const ship of [false, true]) {
    const current = structuredClone(raw), old = structuredClone(raw), previous = structuredClone(rules);
    current.stats.ship = old.stats.ship = ship;
    previous.weaponClasses.machine_gun.damage = .75;
    applyWeaponBalance(old, previous); applyWeaponBalance(current, rules);
    let changed = 0;
    for (const [id, weapon] of Object.entries(current.weapons)) {
      if (Classes.classify(weapon, id) === 'machine_gun') {
        changed++;
        assert(Math.abs(weapon.damagePerShot - old.weapons[id].damagePerShot * 4 / 3) < 1e-6, id);
      } else assert.equal(weapon.damagePerShot, old.weapons[id].damagePerShot, id);
      assert.deepEqual(weapon.nativePayload, raw.weapons[id].nativePayload);
    }
    assert(changed > 0);
    const once = structuredClone(current);
    applyWeaponBalance(current, rules);
    assert.deepEqual(current, once, 'reloading must not bake in another damage multiplier');
  }
});
