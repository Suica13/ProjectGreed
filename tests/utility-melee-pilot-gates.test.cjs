const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules.js');
const Classes = require('../shared/weapon-classes.js');

test('heat rods, sea serpents and both super hammer variants are usable without pilot thresholds', () => {
  const sources = new Set();
  for (const model of Object.values(G.models)) {
    for (const weapon of model.weapons.filter(Classes.pilotGateExempt)) {
      sources.add(weapon.sourceName || weapon.id);
      assert(!weapon.pilotRequirements?.length, model.prefabId + '/' + weapon.id);
      assert.notEqual(weapon.maxUsesPerTurn, 1);
    }
  }
  for (const source of ['ZN_MS_07B_HeatRod', 'TITANS_SeaSerpent', 'EF_SHM', 'EF_SHM_ACE'])
    assert(sources.has(source), source);
  assert(!Classes.pilotGateExempt({ type: 'melee', sourceName: 'EF_BeamSaber_A' }));
});
