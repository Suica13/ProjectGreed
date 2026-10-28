const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
test("native reaction and accuracy match the original MOD including ships", () => {
  const expected = {
    SalamisClass: [50, 105],
    RX_78_1: [134, 124],
    FF_X7: [140, 115],
    RGM_79: [115, 115],
    RGC_80: [105, 120],
    RGM_79L: [140, 110],
    MS_06F: [105, 105],
    MS_09: [100, 115],
    RGM_79_G: [115, 115],
    MS_06J: [95, 110],
    MS_06K: [90, 110],
    MS_14A: [125, 125],
    RX_79_G: [120, 110],
    MS_06F2: [105, 115],
    MS_09R: [110, 115],
  };
  assert.ok(G.catalog.prefabs.length >= Object.keys(expected).length);
  for (const p of G.catalog.prefabs.filter((p) => Object.hasOwn(expected, p.id))) {
    assert.deepEqual([p.stats.mobility, p.stats.accuracy], expected[p.id], p.id);
    assert.deepEqual(
      [p.sourceStats.reaction, p.sourceStats.accuracy],
      [expected[p.id][0], expected[p.id][1]],
    );
    for (const kit of p.weaponKits) {
      const m = G.models[p.id + "__" + kit.id];
      assert.equal(m.mobility, p.stats.mobility);
      assert.equal(m.accuracy, p.stats.accuracy);
    }
  }
  assert.equal(G.models.MS_14A__machine_gun.weapons[0].hit, 100);
});
function duel() {
  const g = G.create(false, 1, [
    [{ unitId: "MS_14A", kitId: "machine_gun" }],
    [{ unitId: "MS_09", kitId: "machine_gun" }],
  ]);
  g.tiles = g.tiles.map((row) => row.map(() => "plain"));
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 3 });
  Object.assign(b, { x: 3, y: 3 });
  return {
    g,
    a,
    b,
    w: { ...G.modelOf(a).weapons[0], hit: 60, antiSize: { small: { damage: 1, accuracy: 1 } } },
  };
}
test("unit accuracy multiplies ranged and melee base hit before cover, mobility, counter and evade", () => {
  const { g, a, b, w } = duel();
  assert.equal(G.estimate(g, a, b, w).hit, 75);
  assert.equal(G.estimate(g, a, b, { ...w, type: "melee" }).hit, 75);
  assert.equal(G.estimate(g, a, b, w, "defend").hit, 75);
  assert.equal(G.estimate(g, a, b, w, "counter", true).hit, 56.25);
  assert.equal(G.estimate(g, a, b, w, "evade").hit, 53.75);
  assert.equal(G.estimate(g, a, b, w, "evade", true).hit, 36.5625);
  g.tiles[b.y][b.x] = "forest";
  assert.equal(G.estimate(g, a, b, w).hit, 65);
  g.tiles[b.y][b.x] = "rubble";
  assert.equal(G.estimate(g, a, b, w).hit, 50);
  assert.equal(G.estimate(g, a, b, { ...w, hit: 100 }).hit, 100);
  assert.equal(G.estimate(g, a, b, { ...w, hit: 0 }, "evade").hit, 0);
});
test("accuracy applies once to AI, survives snapshots and does not inherit defender adaptation or head damage", () => {
  const { g, a, b, w } = duel();
  a.performance = 1.25;
  assert.equal(G.estimate(g, a, b, w).hit, 75);
  assert.equal(G.estimate(g, a, b, G.weaponStats(w, a)).hit, 75);
  const clone = JSON.parse(JSON.stringify(g));
  assert.equal(G.estimate(clone, clone.units[0], clone.units[1], w).hit, 75);
  a.brokenParts = { head: true };
  assert.equal(G.modelOf(a).accuracy, 125);
  assert.equal(G.estimate(g, a, b, w).hit, 75);
  assert.equal(G.models.MS_14A__machine_gun.accuracy, 125);
});

test("all ship accuracy coefficients match native values without a bonus", () => {
  for (const p of G.catalog.prefabs.filter((p) => p.stats.ship)) {
    assert.ok(Math.abs(p.stats.accuracy - p.sourceStats.accuracy) < 1e-8, p.id);
    assert.equal(p.stats.accuracyMultiplier, undefined);
  }
});
