const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const G = require('../shared/rules');
const Codec = require('../tools/weapon-store.cjs');
const Conversion = require('../shared/conversion-rules.cjs');
const Classes = require('../shared/weapon-classes.js');
const { applyWeaponBalance } = require('../tools/weapon-balance.cjs');

test('Mobius H has exclusive missile/nuclear loadouts with valid legacy aliases and production', () => {
  const p = G.catalog.prefabs.find(p => p.id === 'TS_MA2_H');
  assert.deepEqual(p.weaponKits.map(k => k.id), ['main_0', 'nuclear']);
  assert.equal(p.kitAliases.standard, 'main_0');
  for (const kit of p.weaponKits) {
    const model = G.models[p.id + '__' + kit.id];
    assert(model);
    assert(model.weapons.some(w => /NukeMS/.test(w.id)) === (kit.id === 'nuclear'));
    assert(model.weapons.some(w => /AntiShipMS/.test(w.id)) === (kit.id === 'main_0'));
    assert(!model.weapons.some(w => /BeamCannon/.test(w.id)));
    assert(require('../shared/economy').productionOffer(p.id, kit.id));
  }
  assert.equal(p.layers.find(l => l.name === 'AntiShipMS').visibleWhen.kit, 'main_0');
  assert.equal(p.layers.find(l => l.name === 'Nuke').visibleWhen.kit, 'nuclear');
});

test('all normal and charged sniper payloads gain 25 percent before final quantization', () => {
  const current = Conversion.read(), previous = structuredClone(current);
  previous.weapons.sniperDamage = 1.25;
  previous.weapons.chargedSniperDamage = 1.5;
  let normal = 0, charged = 0;
  for (const prefab of G.catalog.prefabs) {
    if (!Object.values(prefab.weapons).some(w => Classes.classify(w) === 'sniper' || w.special?.type === 'snipe')) continue;
    const raw = Codec.parse(fs.readFileSync('assets/units/' + prefab.id + '/unit.json', 'utf8'));
    const before = structuredClone(raw), after = structuredClone(raw);
    applyWeaponBalance(before, previous);
    applyWeaponBalance(after, current);
    for (const [id, weapon] of Object.entries(after.weapons)) {
      const chargedShot = weapon.special?.type === 'snipe';
      const sniper = chargedShot || Classes.classify(weapon) === 'sniper';
      if (sniper) { if (chargedShot) charged++; else normal++; }
      const old = before.weapons[id];
      const payloads = w => [w, ...(w.attack?.steps || [])];
      payloads(weapon).forEach((payload, index) => {
        const original = payloads(old)[index];
        for (const [channel, damage] of Object.entries(payload.damageComponents || {})) {
          const expected = original.damageComponents[channel] * (sniper ? 1.25 : 1);
          assert(Math.abs(damage - expected) < .00001, prefab.id + '/' + id + '/' + channel);
        }
      });
      assert.equal(weapon.en, old.en);
      assert.equal(weapon.shotCount, old.shotCount);
    }
  }
  assert(normal >= 8 && charged >= 8, JSON.stringify({normal, charged}));
});
