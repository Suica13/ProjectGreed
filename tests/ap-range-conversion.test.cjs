const test = require("node:test"),
  assert = require("node:assert/strict");
const { loadCatalog } = require("../tools/load-catalog.cjs"),
  Conversion = require("../shared/conversion-rules.cjs");
const rules = Conversion.read(),
  previous = structuredClone(rules);
previous.weapons.ap = 1;
previous.weapons.rangeBonus = 0;
previous.weapons.sniperRangeBonus = 0;
const before = loadCatalog({ conversionOverride: previous }),
  after = loadCatalog();
test("all imported weapon AP doubles exactly once and range gains preserve minimums and native payloads", () => {
  let count = 0,
    snipers = 0,
    charged = 0;
  for (const [id, model] of Object.entries(after.models))
    for (const weapon of model.weapons) {
      const old = before.models[id].weapons.find((w) => w.id === weapon.id);
      assert(old, id + "/" + weapon.id);
      const shortRange = Conversion.isHeadOrWrist(weapon);
      assert.equal(weapon.actionCost, shortRange ? 3 : old.actionCost * 2, id + "/" + weapon.id);
      const sniper = weapon.category === "sniper" || weapon.special?.type === "snipe";
      assert.equal(weapon.max, shortRange ? 2 : old.max + (sniper ? 2 : 1), id + "/" + weapon.id);
      assert.equal(weapon.min, shortRange ? 1 : old.min);
      assert.equal(weapon.en, old.en, id + "/" + weapon.id + " EN");
      assert.equal(weapon.damage, old.damage);
      assert.deepEqual(weapon.nativePayload, old.nativePayload);
      count++;
      if (sniper) snipers++;
      if (weapon.special?.type === "snipe") charged++;
    }
  assert(count > 1000);
  assert(snipers > 0);
  assert(charged > 0);
});
test("weapon skills share AP/range conversion while support and pilot skills keep their own contracts", () => {
  let count = 0,
    utility = 0;
  for (const prefab of after.prefabs)
    for (const skill of prefab.skills || []) {
      const old = before.prefabs
        .find((p) => p.id === prefab.id)
        .skills.find((s) => s.id === skill.id);
      if (skill.sourceWeapon || skill.reconMode === "camera" || skill.type === "beam_diffusion") {
        assert.equal(skill.actionCost, old.actionCost * 2, prefab.id + "/" + skill.id);
        assert.equal(skill.range, old.range + 1);
        assert.equal(skill.minRange, old.minRange);
        count++;
      } else {
        assert.equal(skill.actionCost, old.actionCost, prefab.id + "/" + skill.id);
        utility++;
      }
    }
  assert(count > 5);
  assert(utility > 100);
});
