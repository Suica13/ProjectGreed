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
test("all fourteen preset maps hold independent full twelve-unit formations without overlapping spawn zones", () => {
  assert.equal(Object.keys(G.catalog.maps).length, 14);
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

test("ten new maps have distinct layouts, balanced teams, connected routes and contrasting cover density", () => {
  const maps = Object.values(G.catalog.maps).filter(
    (m) => m.appearance && m.id !== "forest_front_5v5",
  );
  assert.equal(maps.length, 10);
  assert.deepEqual(
    [1, 2, 3].map((n) => maps.filter((m) => m.playersPerTeam === n).length),
    [4, 3, 3],
  );
  assert.equal(new Set(maps.map((m) => JSON.stringify(m.tiles))).size, 10);
  const cover = (m) =>
    m.tiles.flat().filter((t) => ["forest", "rubble"].includes(t)).length / (m.width * m.height);
  assert.ok(cover(G.getMap("new_york_ruins_1v1")) > 0.3);
  assert.ok(cover(G.getMap("new_york_crossfire_3v3")) > 0.3);
  assert.ok(cover(G.getMap("open_dunes_1v1")) < 0.02);
  assert.ok(cover(G.getMap("desert_highway_3v3")) < 0.03);
  assert.ok(
    cover(G.getMap("desert_depots_2v2")) > 0.03 && cover(G.getMap("desert_depots_2v2")) < 0.1,
  );
  for (const map of maps) {
    const [spawn] = map.spawns,
      visited = new Set([spawn.x + "," + spawn.y]),
      queue = [[spawn.x, spawn.y]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
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
        if (!visited.has(key)) {
          visited.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    assert.equal(
      visited.size,
      map.tiles.flat().filter((t) => Number.isFinite(G.terrain[t].cost)).length,
      map.id,
    );
    for (let y = 0; y < map.height; y++)
      assert.deepEqual(map.tiles[y], [...map.tiles[y]].reverse(), map.id);
    for (const lang of ["zh", "en", "ja"]) assert.ok(map.localization[lang].description.length > 0);
    for (const kind of Object.keys(G.terrain)) {
      const style = G.terrainStyle(map.id, kind);
      assert.equal(style.cost, G.terrain[kind].cost);
      assert.equal(style.cover, G.terrain[kind].cover);
      assert.equal(style.color, map.appearance.colors[kind]);
    }
  }
});

test("forest front supports five players per team and maps are ordered by ascending capacity", () => {
  const map = G.getMap("forest_front_5v5"),
    maps = Object.values(G.catalog.maps);
  assert.equal(map.playersPerTeam, 5);
  assert.equal(map.spawns.length, 10);
  assert.deepEqual(
    map.spawns.map((s) => s.team),
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  );
  const capacities = maps.map((m) => m.spawns.length);
  assert.deepEqual(
    capacities,
    [...capacities].sort((a, b) => a - b),
  );
  const seen = new Set([map.spawns[0].x + "," + map.spawns[0].y]),
    queue = [[map.spawns[0].x, map.spawns[0].y]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
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
        queue.push([nx, ny]);
      }
    }
  }
  assert.equal(
    seen.size,
    map.tiles.flat().filter((t) => Number.isFinite(G.terrain[t].cost)).length,
  );
  assert.ok(
    map.tiles.flat().filter((t) => t === "forest").length / (map.width * map.height) > 0.25,
  );
  for (const row of map.tiles) assert.deepEqual(row, [...row].reverse());
});
