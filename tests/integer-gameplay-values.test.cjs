const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const P = G.pilots;

test("ACE growth and legacy fractional profiles normalize without losing rank, XP or records", () => {
  let checked = 0;
  for (const source of P.catalog.aces.filter(a => a.price)) {
    const seed = P.createAce(source.id);
    for (let level = 0; level <= source.maxLevel; level++) {
      const legacy = Object.fromEntries(Object.entries(source.baseStats).map(([key, base]) =>
        [key, level === source.maxLevel ? source.maxStats[key] :
          base > 0 ? base * (source.maxStats[key] / base) ** (level / source.maxLevel) : 0]));
      const value = P.custom({ ...seed, level, experience: 123456,
        stats: legacy, record: { ...seed.record, kills: 7 } });
      assert.equal(value.level, level);
      assert.equal(value.experience, 123456);
      assert.equal(value.record.kills, 7);
      assert(Object.values(value.stats).every(Number.isInteger));
      assert.deepEqual(P.custom(value), value, "save/reload must remain stable");
      for (const key of Object.keys(value.stats))
        assert.equal(value.stats[key], Math.round(legacy[key]));
      checked++;
    }
  }
  assert(checked > 100);
});

test("buffed custom pilot attributes are integers and the original allocation remains untouched", () => {
  const skill = P.catalog.customSkills.find(s => s.statMultipliers?.shooting);
  assert(skill);
  const pilot = P.custom({ ...P.createCustom("custom-integer-pilot", "整数驾驶员", P.catalog.portraits[0].id),
    level: 6, selectedSkillId: skill.id,
    stats: { ...P.baseStats(), shooting: 121 } });
  const unit = { pilot, pilotBuffs: { [skill.id]: true } };
  const effective = P.of(unit);
  assert.equal(effective.stats.shooting, Math.round(121 * skill.statMultipliers.shooting));
  assert(Object.values(effective.stats).every(Number.isInteger));
  assert.equal(pilot.stats.shooting, 121);
  assert.equal(P.of(unit), effective, "cached reads must not apply the buff twice");
});

test("compiled weapon values and pilot-adjusted budgets/forecast are integer gameplay values", () => {
  for (const model of Object.values(G.models)) {
    for (const key of ["hp", "en", "cost", "move", "speed", "mobility", "accuracy", "actionPoints"])
      assert(Number.isInteger(model[key]), model.prefabId + "/" + key);
    for (const weapon of model.weapons) {
      for (const key of ["hit", "min", "max", "en", "actionCost"])
        assert(Number.isInteger(weapon[key]), model.prefabId + "/" + weapon.id + "/" + key);
      assert.equal(weapon.damage % 25, 0);
    }
  }
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles.forEach(row => row.fill("plain"));
  const [a, b] = game.units;
  Object.assign(a, { x: 5, y: 5 }); Object.assign(b, { x: 6, y: 5 });
  assert(Number.isInteger(G.modelOf(a).move));
  assert(Number.isInteger(G.modelOf(a).actionPoints));
  for (const weapon of G.automaticWeapons(game, a, b)) {
    const forecast = G.estimate(game, a, b, weapon);
    assert(Number.isInteger(forecast.hit));
    assert.equal(forecast.damage % 25, 0);
  }
});
