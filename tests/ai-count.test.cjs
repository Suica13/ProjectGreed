const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
test("AI count percentage defaults to 100, validates discrete options and is independent of COST and difficulty", () => {
  assert.deepEqual(G.validateAISettings(), { difficulty: "medium", fill: 100, countPercent: 100 });
  for (const limit of [3, 7, 12])
    for (const countPercent of G.aiCountPercentages)
      for (const fill of [50, 100, 150])
        for (const difficulty of ["easy", "medium", "hard"]) {
          const config = { difficulty, fill, countPercent };
          assert.equal(
            G.aiUnitLimit(limit, config),
            Math.max(1, Math.floor((limit * countPercent) / 100)),
          );
          assert.equal(G.aiBudget(5000, config), (5000 * fill) / 100);
        }
  assert.deepEqual(
    G.armyPercentages,
    Array.from({ length: 12 }, (_, i) => (i + 1) * 25),
  );
  for (const percentage of G.armyPercentages) {
    const settings = G.validateArmySettings({
      difficulty: Math.min(percentage, 200),
      fill: percentage,
      countPercent: percentage,
    });
    assert.equal(G.aiPerformance[settings.difficulty], Math.min(percentage, 200) / 100);
  }
  for (const field of ["difficulty", "fill", "countPercent"])
    for (const value of [0, 24, 26, 301, "300", null, NaN])
      assert.throws(() => G.validateArmySettings({ [field]: value }));
  for (const countPercent of [0, 24, 49, 51, 110, 201, 301, "200", null, NaN])
    assert.throws(() => G.validateAISettings({ countPercent }));
  assert.throws(() =>
    G.validateFormation(
      Array(G.catalog.formation.maxUnits + 1).fill({ unitId: "MS_06F", kitId: "machine_gun" }),
      Infinity,
    ),
  );
});
test("AI percentage respects faction, era, per-unit COST and available budget when filling up to 36 units", () => {
  for (const bannedFactions of [[], ["EFSF"], ["ZEON"]])
    for (const countPercent of G.aiCountPercentages)
      for (const fill of [50, 100, 150]) {
        const config = { countPercent, fill },
          cap = G.aiUnitLimit(12, config),
          budget = G.aiBudget(5000, config),
          restrictions = { unitCostLimit: 500, bannedFactions };
        const minimum = Math.min(
          ...Object.values(G.models)
            .filter((m) => !G.restrictionReason(m, restrictions))
            .map((m) => m.cost),
        );
        for (let seed = 1; seed < 20; seed++) {
          const army = G.randomFormation(seed, budget, restrictions, cap);
          assert.equal(army.length, Math.min(cap, Math.floor(budget / minimum)));
          assert.equal(G.planFormation(army, budget, restrictions, cap).disabled.length, 0);
        }
      }
  assert.deepEqual(G.randomFormation(1, 10000, { bannedEras: ["0079"] }, 24), []);
});
test("every preset map deploys full 300-percent AI armies at every spawn without overlap", () => {
  const entry = { unitId: "MS_06F", kitId: "machine_gun" };
  for (const map of Object.values(G.catalog.maps)) {
    const formations = map.spawns.map(() => Array(36).fill(entry));
    const g = G.create(false, 1, formations, true, {
      mapId: map.id,
      costLimit: 6000,
      seatUnitLimits: map.spawns.map(() => 36),
    });
    assert.equal(g.units.length, map.spawns.length * 36);
    assert.equal(new Set(g.units.map((u) => u.x + "," + u.y)).size, g.units.length);
    for (let seat = 0; seat < map.spawns.length; seat++)
      assert.equal(G.confirmDeployment(g, seat), seat === map.spawns.length - 1);
  }
});
