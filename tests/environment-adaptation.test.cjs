const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
function fixture() {
  const formation = [{ unitId: "RGM_79", kitId: "machine_gun" }];
  const g = G.create(false, 1, [formation, formation]);
  const [a, b] = g.units;
  a.x = 2;
  a.y = 4;
  b.x = 4;
  b.y = 4;
  return { g, a, b };
}
test("water adaptation permits entry and scales accuracy, mobility and movement without modifying catalog", () => {
  const { g, a } = fixture();
  const base = G.models[a.model],
    old = base.adaptability;
  base.adaptability = { ...old, ground: 100, water: 50, air: 80 };
  try {
    g.tiles[a.y][a.x] = "water";
    assert.equal(G.environmentOf(g, a), "water");
    assert.equal(G.terrainCost(g, a, 2, 4), 1);
    const model = G.modelOf(a, g);
    assert.equal(model.accuracy, base.accuracy * 0.5);
    assert.equal(model.mobility, base.mobility * 0.5);
    assert.equal(model.move, base.move * 0.5);
    a.flying = true;
    assert.equal(G.environmentOf(g, a), "air");
    assert.equal(G.modelOf(a, g).accuracy, base.accuracy * 0.8);
    g.environment = "space";
    assert.equal(G.environmentOf(g, a), "space");
  } finally {
    base.adaptability = old;
  }
});
test("hover uses ground adaptation over water; zero water adaptation blocks walkers", () => {
  const { g, a } = fixture(),
    base = G.models[a.model],
    old = base.adaptability,
    movement = base.movementType;
  try {
    base.adaptability = { ...old, water: 0 };
    g.tiles[a.y][a.x] = "water";
    assert.equal(G.terrainCost(g, a, 2, 4), Infinity);
    base.movementType = "hover";
    assert.equal(G.environmentOf(g, a), "ground");
    assert.equal(G.terrainCost(g, a, 2, 4), 1);
  } finally {
    base.adaptability = old;
    base.movementType = movement;
  }
});
test("airborne targets receive no forest or ruin cover", () => {
  const { g, a, b } = fixture();
  b.flying = true;
  const w = G.modelOf(a).weapons[0];
  g.tiles[b.y][b.x] = "plain";
  const plain = G.estimate(g, a, b, w).hit;
  g.tiles[b.y][b.x] = "forest";
  assert.equal(G.estimate(g, a, b, w).hit, plain);
  g.tiles[b.y][b.x] = "ruins";
  assert.equal(G.estimate(g, a, b, w).hit, plain);
});
