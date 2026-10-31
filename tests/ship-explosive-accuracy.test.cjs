const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");

test("ship explosive cannons apply one additional accuracy factor, while other weapons keep native hit", () => {
  let explosive = 0, ordinary = 0;
  for (const prefab of G.catalog.prefabs.filter(p => p.stats.ship)) {
    assert.equal(prefab.stats.accuracy, Number((prefab.sourceStats.accuracy * .65 * (prefab.tags.includes("EFSF") ? 1.1 : 1)).toFixed(6)), prefab.id);
    for (const [id, weapon] of Object.entries(prefab.weapons)) {
      const payload = weapon.nativePayload || {};
      const affected = ["cannon", "mortar"].includes(weapon.category) &&
        (payload.ProjectileExplosionRange > 0 || payload.ProjectileBlastRange > 0);
      assert.equal(weapon.hit, weapon.sourceHit * (affected ? .8 : 1), prefab.id + "/" + id);
      assert.equal(weapon.shipExplosiveAccuracyMultiplier, affected ? .8 : undefined);
      if (affected) explosive++; else ordinary++;
    }
  }
  assert(explosive > 0 && ordinary > 0);
});
