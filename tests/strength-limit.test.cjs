const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules.js');

test('unit strength permits 25 to 200 percent while other army ratios retain their range', () => {
  assert.deepEqual(G.strengthPercentages, [25, 50, 75, 100, 125, 150, 175, 200]);
  for (const difficulty of G.strengthPercentages) {
    assert.equal(G.validateArmySettings({ difficulty }).difficulty, difficulty);
    assert.equal(G.aiPerformance[difficulty], difficulty / 100);
  }
  for (const difficulty of [225, 250, 275, 300]) {
    assert.throws(() => G.validateAISettings({ difficulty }));
    assert.throws(() => G.validateArmySettings({ difficulty }));
    assert.equal(G.aiPerformance[difficulty], undefined);
  }
  assert.equal(G.validateArmySettings({ fill: 300, countPercent: 300, unitCostPercent: 300 }).fill, 300);
  const formations = [[{ unitId: 'RGM_79', kitId: 'machine_gun' }], [{ unitId: 'MS_06F', kitId: 'machine_gun' }]];
  assert.doesNotThrow(() => G.create(false, 1, formations, false, { performances: [2, 2] }));
  assert.throws(() => G.create(false, 1, formations, false, { performances: [2.25, 1] }));
});
