const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
test("ship AA stays ordinary range 1-2 weapon with native ports and projectiles", () => {
  let total = 0;
  for (const m of Object.values(G.models)) {
    assert(!m.skills.some((s) => s.id === "ShipAntiAirVolley"));
    for (const w of m.weapons.filter((w) => w.rangeRole === "ship_anti_air")) {
      total++;
      assert.equal(w.min, 1);
      assert.equal(w.max, 2);
      assert(w.projectile?.asset);
      assert(w.muzzle.mounts.length);
    }
  }
  assert(total >= 48);
});
