const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");

test("ship medium-target accuracy is 75 percent except anti-air guns and anti-MS missiles", () => {
  let changed = 0, excluded = 0;
  assert.equal(G.unitSize(G.models.RGM_79__beam_spray), "medium");
  for (const prefab of G.catalog.prefabs.filter(p => p.stats.ship)) {
    for (const [id, weapon] of Object.entries(prefab.weapons)) {
      const exempt = weapon.rangeRole === "ship_anti_air" ||
        /Turret_?AA(?:_|$)/.test(id) || /(?:^|_)AMS(?:_|$)/.test(id);
      assert.equal(weapon.antiSize?.medium?.accuracy ?? 1, exempt ? 1 : .75, prefab.id + "/" + id);
      assert.equal(weapon.antiSize?.medium?.damage ?? 1, 1);
      if (exempt) excluded++; else changed++;
    }
  }
  for (const model of Object.values(G.models).filter(m => m.ship))
    for (const weapon of model.weapons) {
      const exempt = weapon.rangeRole === "ship_anti_air" ||
        /Turret_?AA(?:_|$)/.test(weapon.id) || /(?:^|_)AMS(?:_|$)/.test(weapon.id);
      assert.equal(weapon.antiSize?.medium?.accuracy ?? 1, exempt ? 1 : .75, model.prefabId + "/" + weapon.id);
    }
  assert(changed > 0 && excluded > 0);
});
