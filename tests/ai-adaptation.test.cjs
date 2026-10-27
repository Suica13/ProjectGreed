const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const modelOf = (entry) => G.models[`${entry.unitId}__${entry.kitId}`];

test("AI uses map environment and team restrictions while preserving slots, budget and random kits", () => {
  for (const [environment, mapId] of [
    ["ground", "frontier_1v1"],
    ["space", "asteroid_crossing_1v1"],
  ]) {
    for (const bannedFactions of [[], ["EFSF"], ["ZEON"]]) {
      const restrictions = G.formationRestrictions(
        {
          mapId,
          unitCostLimit: 500,
          teamRestrictions: { 0: { bannedFactions, bannedEras: [] } },
        },
        0,
      );
      assert.equal(restrictions.environment, environment);
      const kits = new Set();
      for (let seed = 1; seed <= 40; seed++) {
        const army = G.randomFormation(seed, 3000, restrictions, 6);
        assert.equal(army.length, 6);
        assert.deepEqual(army, G.randomFormation(seed, 3000, restrictions, 6));
        G.validateFormation(army, 3000, 6);
        for (const entry of army) {
          const model = modelOf(entry);
          assert.equal(model.adaptability[environment], 100);
          assert.ok(model.cost <= 500);
          assert.ok(!bannedFactions.includes(model.faction));
          kits.add(entry.kitId);
        }
      }
      assert.ok(kits.size > 1, "weapon kits remain randomized");
    }
  }
  assert.deepEqual(
    G.randomFormation(
      1,
      3000,
      {
        environment: "space",
        bannedEras: ["0079"],
      },
      6,
    ),
    [],
  );
});

// Use a small controlled catalog to cover future units with unusual COST/adaptation combinations.
function withPool(run) {
  const saved = { ...G.models };
  const source = Object.values(saved)[0];
  for (const key of Object.keys(G.models)) delete G.models[key];
  for (const [id, cost, ground] of [
    ["low", 100, 50],
    ["best", 150, 100],
    ["expensive", 250, 100],
    ["incompatible", 25, 0],
  ]) {
    G.models[id + "__test"] = {
      ...source,
      prefabId: id,
      kitId: "test",
      cost,
      ship: false,
      unitTags: [],
      commandAuras: [],
      adaptability: { ground, space: ground },
    };
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(G.models)) delete G.models[key];
    Object.assign(G.models, saved);
  }
}

test("AI reserves enough for a full compatible roster and falls back when budget requires it", () =>
  withPool(() => {
    for (let seed = 0; seed < 40; seed++) {
      const preferred = G.randomFormation(seed, 450, {}, 3);
      assert.equal(preferred.length, 3);
      assert.ok(preferred.every((entry) => entry.unitId === "best"));
      const fallback = G.randomFormation(seed, 400, {}, 3);
      assert.equal(fallback.length, 3);
      assert.equal(
        fallback.filter((entry) => modelOf(entry).adaptability.ground === 100).length,
        2,
      );
      assert.ok(fallback.every((entry) => entry.unitId !== "incompatible"));
    }
    const lowOnly = G.randomFormation(1, 300, { unitCostLimit: 100 }, 3);
    assert.equal(lowOnly.length, 3);
    assert.ok(lowOnly.every((entry) => entry.unitId === "low"));
    assert.deepEqual(G.randomFormation(1, 300, { unitCostLimit: 25 }, 3), []);
  }));

test("AI fleets reserve deployment space for every slot, including 200 percent unit counts and mixed naval forces", () => {
  for (const mapId of ["asteroid_crossing_1v1", "outer_orbit_5v5", "coastal_supply_2v2"]) {
    const settings = { mapId, costLimit: 20000, unitCostLimit: 5000 },
      map = G.getMap(mapId);
    for (const seat of [0, map.spawns.length - 1])
      for (let seed = 1; seed <= 12; seed++) {
        const restrictions = G.formationRestrictions(settings, seat);
        const army = G.randomFormation(seed, 20000, restrictions, 24);
        assert.equal(army.length, 24, mapId + ":" + seat + ":" + seed);
        const formations = map.spawns.map((_, index) => (index === seat ? army : null));
        const game = G.create(false, seed, formations, true, {
          ...settings,
          seatUnitLimits: map.spawns.map(() => 24),
        });
        const occupied = game.units
          .filter((u) => !u.embarked)
          .flatMap((u) => G.cells(u).map((c) => G.key(c.x, c.y)));
        assert.equal(new Set(occupied).size, occupied.length);
        assert.equal(game.units.length, 24);
      }
  }
});
