const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const land = new Set(["MS_06J", "MS_09", "RGM_79_G", "RX_79_G"]);
test("explicit map environments and per-unit adaptation distinguish ground-only and general-purpose units", () => {
  for (const p of G.catalog.prefabs.filter((p) => !p.mechanics))
    assert.deepEqual(
      { ground: p.stats.adaptability.ground, space: p.stats.adaptability.space },
      {
        ground: p.id === "SalamisClass" ? 0 : p.id === "MS_09R" ? 50 : 100,
        space: land.has(p.id) ? 50 : 100,
      },
    );
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
    assert.equal(space.move, (model.move * model.adaptability.space) / 100);
    assert.equal(space.mobility, (model.mobility * model.adaptability.space) / 100);
    assert.equal(space.hp, ground.hp);
    assert.equal(space.cost, ground.cost);
    assert.equal(space.weapons[0]?.damage, ground.weapons[0]?.damage);
  }
});
test("space movement applies adaptation, uses effective mobility for evasion and survives snapshots", () => {
  const e = { unitId: "RX_79_G", kitId: "machine_gun" },
    gm = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[e], [gm], null, null], false, { mapId: "orbital_debris_2v2" }),
    [a, b] = g.units;
  g.tiles = g.tiles.map((row) => row.map(() => "plain"));
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 20, y: 20 });
  assert.equal(g.environment, "space");
  assert.equal(a.environment, "space");
  assert.equal(G.modelOf(a).move, 3);
  assert.equal(G.reachable(g, a).has("12,10"), true);
  assert.equal(G.reachable(g, a).has("13,10"), true);
  assert.throws(() => G.move(g, a, 14, 10));
  const w = { ...G.modelOf(b).weapons[0], hit: 50 };
  assert.ok(
    G.estimate(g, b, a, w).hit >
      G.estimate({ ...g, environment: "ground" }, b, { ...a, environment: "ground" }, w).hit,
  );
  const copy = JSON.parse(JSON.stringify(g));
  assert.equal(G.modelOf(copy.units[0]).move, 3);
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
  assert.equal(G.models[u.model].adaptability.ground, 100);
  assert.equal(G.models[u.model].adaptability.space, 50);
});

test("all units expose environment and terrain values, preserve native provenance and default atmosphere to zero", () => {
  for (const p of G.catalog.prefabs) {
    for (const key of [
      "ground",
      "space",
      "water",
      "air",
      "atmosphere",
      "mountain",
      "forest",
      "snow",
      "desert",
      "rubble",
    ])
      assert(Number.isFinite(p.stats.adaptability[key]), p.id + "/" + key);
    assert.equal(p.stats.adaptability.atmosphere, 0, p.id);
    assert.equal(p.stats.adaptability.mountain, p.sourceStats.adaptability.mountain, p.id);
    for (const terrain of ["forest", "snow", "desert", "rubble"])
      assert.equal(p.stats.adaptability[terrain], 75, p.id + "/" + terrain);
    assert.equal(p.stats.adaptability.water, p.sourceStats.adaptability.water, p.id);
    assert.equal(p.stats.adaptability.air, p.sourceStats.adaptability.air, p.id);
  }
  assert.equal(G.models.RGM_79__machine_gun.adaptability.water, 50);
  assert.equal(G.models.RGM_79__machine_gun.adaptability.air, 10);
  const rick = G.catalog.prefabs.find((p) => p.id === "MS_09R");
  assert.equal(rick.stats.adaptability.ground, 50);
  assert.equal(rick.sourceStats.adaptability.ground, 25);
  const acguy = G.catalog.prefabs.find((p) => p.id === "MSM_04");
  assert.equal(acguy.stats.adaptability.water, 110);
});
