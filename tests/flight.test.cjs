const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
for (const id of ["MS_07H", "MS_07H8"])
  test(id + " flight spends one AP, keeps movement, checks parts and terrain", () => {
    const m = Object.values(G.models).find((m) => m.prefabId === id);
    const g = G.create(
      false,
      1,
      [[{ unitId: id, kitId: m.kitId }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    g.tiles.forEach((r) => r.fill("plain"));
    const u = g.units[0];
    Object.assign(u, { x: 10, y: 10 });
    for (const part of ["head", "backpack", "leftArm", "rightArm", "leftLeg", "rightLeg"]) {
      u.brokenParts = { [part]: true };
      assert.equal(G.canUseSkill(g, u, "flight_stance"), false);
    }
    u.brokenParts = {};
    u.actionPoints = 0;
    assert.equal(G.canUseSkill(g, u, "flight_stance"), false);
    u.actionPoints = 5;
    G.useSkill(g, u, "flight_stance", u.x, u.y);
    assert.equal(u.actionPoints, 4);
    assert.equal(u.moved, false);
    assert.equal(u.acted, false);
    assert.equal(G.modelOf(u).movementType, "air");
    g.tiles[10][11] = "water";
    g.tiles[10][12] = "rock";
    assert.equal(G.terrainCost(g, u, 11, 10), 1);
    assert.equal(G.terrainCost(g, u, 12, 10), 1);
    assert(G.reachable(g, u).has(G.key(12, 10)));
    g.tiles[u.y][u.x] = "water";
    assert.equal(G.canUseSkill(g, u, "flight_stance"), false);
    g.tiles[u.y][u.x] = "plain";
    G.useSkill(g, u, "flight_stance", u.x, u.y);
    assert.equal(u.flying, false);
    assert.equal(u.actionPoints, 3);
    assert.equal(u.moved, false);
    assert.equal(G.terrainCost(g, u, 11, 10), Infinity);
  });
