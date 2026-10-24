const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const land = new Set(["MS_06J", "MS_09", "RGM_79_G", "RX_79_G"]);
test("explicit map environments and per-unit adaptation distinguish ground-only and general-purpose units", () => {
  for (const p of G.catalog.prefabs)
    assert.deepEqual(p.stats.adaptability, {
      ground: p.id === "MS_09R" ? 50 : 100,
      space: land.has(p.id) ? 50 : 100,
    });
  for (const m of Object.values(G.catalog.maps))
    assert.equal(
      m.environment,
      [
        "orbital_debris_2v2",
        "asteroid_crossing_1v1",
        "colony_wreck_3v3",
        "outer_orbit_5v5",
      ].includes(m.id)
        ? "space"
        : "ground",
    );
  for (const [id, model] of Object.entries(G.models)) {
    const ground = G.modelOf({ model: id, environment: "ground" }),
      space = G.modelOf({ model: id, environment: "space" });
    assert.equal(space.move, ground.move * (model.adaptability.space / model.adaptability.ground));
    assert.equal(
      space.mobility,
      ground.mobility * (model.adaptability.space / model.adaptability.ground),
    );
    assert.equal(space.hp, ground.hp);
    assert.equal(space.cost, ground.cost);
    assert.equal(space.weapons[0].damage, ground.weapons[0].damage);
  }
});
test("space movement preserves fractional budgets, uses effective mobility for evasion and survives snapshots", () => {
  const e = { unitId: "RX_79_G", kitId: "machine_gun" },
    gm = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[e], [gm], null, null], false, { mapId: "orbital_debris_2v2" }),
    [a, b] = g.units;
  g.tiles = g.tiles.map((row) => row.map(() => "plain"));
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 20, y: 20 });
  assert.equal(g.environment, "space");
  assert.equal(a.environment, "space");
  assert.equal(G.modelOf(a).move, 2.5);
  assert.equal(G.reachable(g, a).has("12,10"), true);
  assert.equal(G.reachable(g, a).has("13,10"), false);
  assert.throws(() => G.move(g, a, 13, 10));
  const w = { ...G.modelOf(b).weapons[0], hit: 50 };
  assert.ok(G.estimate(g, b, a, w).hit > G.estimate(g, b, { ...a, environment: "ground" }, w).hit);
  const copy = JSON.parse(JSON.stringify(g));
  assert.equal(G.modelOf(copy.units[0]).move, 2.5);
});
test("adaptation combines with AI and backpack penalties once without changing catalog values", () => {
  const u = { model: "RX_79_G__machine_gun", performance: 1.25, environment: "ground" };
  const ground = G.modelOf(u);
  u.environment = "space";
  const space = G.modelOf(u);
  assert.equal(space.move, ground.move * 0.5);
  assert.equal(space.mobility, ground.mobility * 0.5);
  u.brokenParts = { backpack: true };
  assert.equal(G.modelOf(u).move, Math.max(1, Math.floor(space.move * 0.75)));
  assert.equal(G.modelOf(u).mobility, space.mobility);
  u.environment = "ground";
  assert.equal(G.modelOf(u).move, Math.floor(ground.move * 0.75));
  assert.deepEqual(G.models[u.model].adaptability, { ground: 100, space: 50 });
});
