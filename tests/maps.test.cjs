const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const entry = { unitId: "RGM_79", kitId: "machine_gun" };
test("enemy orthogonal zones cost at least three; allies, diagonal units and dead enemies do not exert control", () => {
  const g = G.create(false, 1, [[entry], [entry]]),
    [a, b] = g.units;
  g.tiles = Array.from({ length: 18 }, () => Array(24).fill("plain"));
  Object.assign(a, { x: 2, y: 4 });
  Object.assign(b, { x: 5, y: 4 });
  assert.equal(G.movementCost(g, a, 4, 4), 3);
  assert.equal(G.movementCost(g, a, 4, 3), 1);
  assert.equal(G.reachable(g, a).get("4,4").cost, 4);
  assert.ok(!G.reachable(g, a).has("5,3"), "two threatened entries exceed five movement");
  g.tiles[4][4] = "forest";
  assert.equal(G.movementCost(g, a, 4, 4), 3);
  g.tiles[4][4] = "rock";
  assert.equal(G.movementCost(g, a, 4, 4), Infinity);
  g.tiles[4][4] = "plain";
  g.units.push({ ...b, id: "extra", x: 4, y: 3 });
  assert.equal(G.movementCost(g, a, 4, 4), 3, "zones do not stack");
  g.units.pop();
  b.hp = 0;
  assert.equal(G.movementCost(g, a, 4, 4), 1);
  b.hp = 1;
  b.team = 0;
  assert.equal(G.movementCost(g, a, 4, 4), 1);
});
test("all nine preset maps hold independent full twelve-unit formations without overlapping spawn zones", () => {
  assert.equal(Object.keys(G.catalog.maps).length, 9);
  for (const map of Object.values(G.catalog.maps)) {
    const formations = Array.from({ length: map.spawns.length }, () => Array(12).fill(entry));
    const before = JSON.stringify(map);
    const g = G.create(false, 1, formations, true, { mapId: map.id, costLimit: 7200 });
    assert.equal(g.units.length, map.spawns.length * 12);
    assert.equal(new Set(g.units.map((u) => u.x + "," + u.y)).size, g.units.length);
    assert.equal(G.mapWidth(g), map.width);
    assert.equal(G.mapHeight(g), map.height);
    for (const [seat, spawn] of map.spawns.entries()) {
      const own = g.units.filter((u) => G.ownerOf(u) === seat);
      assert.equal(own.length, 12);
      assert.ok(own.every((u) => u.team === spawn.team));
      const cells = G.deploymentCells(g, seat);
      assert.ok(own.every((u) => cells.some((c) => c.x === u.x && c.y === u.y)));
      if (seat > 1) assert.throws(() => G.deploy(g, seat, g.units[0].id, cells[0].x, cells[0].y));
      assert.equal(G.confirmDeployment(g, seat), seat === map.spawns.length - 1);
    }
    g.tiles[0][0] = "rubble";
    assert.equal(JSON.stringify(map), before, "each match clones map terrain");
  }
});
test("room budget validation has bounds and every formation is checked against its supplied budget", () => {
  for (const bad of [
    null,
    NaN,
    Infinity,
    -1,
    0,
    Math.min(...Object.values(G.models).map((m) => m.cost)) - 1,
    100000,
    3600.5,
  ])
    assert.throws(() => G.validateCostLimit(bad));
  assert.equal(G.validateCostLimit(7200), 7200);
  assert.throws(() =>
    G.validateFormation([entry, entry], G.models.RGM_79__machine_gun.cost * 2 - 1),
  );
  assert.equal(
    G.validateFormation([entry, entry], G.models.RGM_79__machine_gun.cost * 2).length,
    2,
  );
  assert.throws(() => G.create(false, 1, [[entry], [entry]], true, { mapId: "crossroads_2v2" }));
  for (const id of ["unknown", "__proto__", "constructor", "toString", null, {}])
    assert.throws(() => G.getMap(id));
});

test("nine asymmetric maps are capacity-sorted, connected and offer sparse cover or contiguous woods", () => {
  const maps = Object.values(G.catalog.maps);
  assert.deepEqual(
    maps.map((m) => m.playersPerTeam),
    [1, 1, 2, 2, 3, 3, 3, 5, 5],
  );
  assert.deepEqual(G.defaultRoomSettings(), {
    mapId: "frontier_1v1",
    costLimit: 3000,
    unitLimit: 6,
    unitCostLimit: 500,
    bannedFactions: [],
    bannedEras: [],
    teamRestrictions: [
      { bannedFactions: [], bannedEras: [] },
      { bannedFactions: [], bannedEras: [] },
    ],
  });
  assert.equal(new Set(maps.map((m) => JSON.stringify(m.tiles))).size, 9);
  for (const map of maps) {
    assert.ok(
      map.tiles.some((row) => JSON.stringify(row) !== JSON.stringify([...row].reverse())),
      map.id,
    );
    assert.notDeepEqual(map.tiles, [...map.tiles].reverse(), map.id);
    assert.notDeepEqual(
      map.tiles,
      [...map.tiles].reverse().map((row) => [...row].reverse()),
      map.id,
    );
    const start = map.spawns[0],
      seen = new Set([start.x + "," + start.y]),
      queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const { x, y } = queue[i];
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (
          nx < 0 ||
          ny < 0 ||
          nx >= map.width ||
          ny >= map.height ||
          !Number.isFinite(G.terrain[map.tiles[ny][nx]].cost)
        )
          continue;
        const key = nx + "," + ny;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    assert.equal(
      seen.size,
      map.tiles.flat().filter((t) => Number.isFinite(G.terrain[t].cost)).length,
      map.id,
    );
    for (const language of ["zh", "en", "ja"]) assert.ok(map.localization[language].description);
    for (const kind of Object.keys(G.terrain))
      assert.equal(G.terrainStyle(map.id, kind).color, map.appearance.colors[kind]);
  }
  const forest = G.getMap("frontline_3v3");
  assert.ok(
    forest.tiles.flat().filter((t) => t === "forest").length > forest.width * forest.height * 0.25,
  );
  assert.ok(
    G.getMap("open_dunes_1v1")
      .tiles.flat()
      .filter((t) => t === "rubble").length < 10,
  );
});

test("friendly units can be crossed in a single-cell corridor but never used as destinations", () => {
  for (const ownerSeat of [0, 2]) {
    const g = G.create(false, 1, [[entry, entry], [entry]]),
      [a, ally, enemy] = g.units;
    g.tiles = Array.from({ length: G.mapHeight(g) }, () => Array(G.mapWidth(g)).fill("rock"));
    for (let x = 2; x <= 6; x++) g.tiles[4][x] = "plain";
    Object.assign(a, { x: 2, y: 4 });
    Object.assign(ally, { x: 3, y: 4, ownerSeat });
    Object.assign(enemy, { x: 20, y: 15 });
    const reachable = G.reachable(g, a);
    assert.equal(reachable.has("3,4"), false);
    assert.equal(reachable.get("5,4").cost, 3);
    assert.deepEqual(reachable.get("5,4").path, [
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ]);
    assert.throws(() => G.move(g, a, 3, 4));
    G.move(g, a, 5, 4);
    assert.deepEqual([a.x, a.y, ally.x, ally.y], [5, 4, 3, 4]);
    G.undo(g, a);
    ally.team = 1;
    assert.equal(G.reachable(g, a).has("5,4"), false, "enemies still block traversal");
  }
});
