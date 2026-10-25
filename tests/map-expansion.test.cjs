const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const G = require("../shared/rules.js");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const baseline = require("./map-expansion-baseline.json");

test("all maps reserve ship-sized side strips and preserve every original battlefield tile", () => {
  for (const map of Object.values(G.catalog.maps).filter((m) => baseline[m.id])) {
    const before = baseline[map.id],
      expansion = map.deploymentExpansion;
    assert.equal(map.width, before.width + 28, map.id);
    assert.equal(expansion.version, 2);
    assert.equal(map.height, Math.max(before.height, map.playersPerTeam * 18));
    assert.equal(expansion.baseWidth, before.width);
    assert.equal(expansion.addedLeft + expansion.addedRight, map.width - before.width);
    assert.ok(Math.abs(expansion.addedLeft - expansion.addedRight) <= 1);
    const battlefield = map.tiles
      .slice(expansion.addedTop, expansion.addedTop + before.height)
      .map((row) => row.slice(expansion.addedLeft, expansion.addedLeft + before.width));
    assert.equal(
      createHash("sha256").update(JSON.stringify(battlefield)).digest("hex"),
      before.terrainHash,
    );
    for (const row of map.tiles) {
      assert.ok(row.slice(0, expansion.addedLeft).every((t) => t === "plain"));
      assert.ok(row.slice(expansion.addedLeft + before.width).every((t) => t === "plain"));
    }
    const seen = new Set();
    for (let seat = 0; seat < map.spawns.length; seat++) {
      const cells = G.deploymentCells({ tiles: map.tiles, mapId: map.id }, seat);
      const team = G.seatTeam(seat),
        area = map.deploymentAreas[seat];
      assert.ok(cells.length >= 234, map.id + ":" + seat);
      assert.equal(cells.length, area.width * area.height);
      assert.ok(cells.some((c) => c.x === map.spawns[seat].x && c.y === map.spawns[seat].y));
      for (const cell of cells) {
        assert.ok(
          team === 0 ? cell.x < expansion.addedLeft : cell.x >= expansion.addedLeft + before.width,
        );
        const key = G.key(cell.x, cell.y);
        assert.ok(!seen.has(key), map.id + ": overlap at " + key);
        seen.add(key);
      }
    }
    assert.equal(
      seen.size,
      map.deploymentAreas.reduce((n, area) => n + area.width * area.height, 0),
    );
    for (let seat = 0; seat < map.deploymentAreas.length; seat++) {
      const strip = seat % 2 === 0 ? expansion.addedLeft : expansion.addedRight;
      const area = map.deploymentAreas[seat];
      assert.equal(area.width, Math.round(strip * 0.9));
      assert.equal(area.x, seat % 2 === 0 ? 0 : map.width - area.width);
    }
  }
});

test("expanded strips fit a Salamis plus 23 mobile suits at every space-map spawn in either roster order", () => {
  const ms = { unitId: "MS_06F", kitId: "machine_gun" },
    ship = { unitId: "SalamisClass", kitId: "standard" };
  for (const map of Object.values(G.catalog.maps).filter((m) => m.environment === "space"))
    for (const shipFirst of [true, false]) {
      const army = Array(23).fill(ms);
      if (shipFirst) army.unshift(ship);
      else army.push(ship);
      const game = G.create(
        false,
        1,
        map.spawns.map(() => army),
        true,
        {
          mapId: map.id,
          costLimit: 99999,
          seatUnitLimits: map.spawns.map(() => 24),
        },
      );
      assert.equal(game.units.length, map.spawns.length * 24);
      const occupied = new Set();
      for (const unit of game.units) {
        assert.ok(G.fits(game, unit, unit.x, unit.y, unit.angle, false, G.ownerOf(unit)));
        for (const cell of G.cells(unit)) {
          assert.ok(!occupied.has(G.key(cell.x, cell.y)));
          occupied.add(G.key(cell.x, cell.y));
        }
      }
      for (let seat = 0; seat < map.spawns.length; seat++) G.confirmDeployment(game, seat);
    }
});

test("deployment rejects the old battlefield and another player's strip while ordinary movement can enter the battlefield", () => {
  const map = G.getMap("crossroads_2v2"),
    entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(
    false,
    1,
    map.spawns.map(() => [entry]),
    true,
    { mapId: map.id },
  );
  const own = game.units.find((u) => u.ownerSeat === 0),
    teammateArea = map.deploymentAreas[2];
  assert.throws(() => G.deploy(game, 0, own.id, map.deploymentExpansion.addedLeft, own.y));
  assert.throws(() => G.deploy(game, 0, own.id, teammateArea.x, teammateArea.y));
  const edge = { x: map.deploymentAreas[0].width - 1, y: own.y };
  G.deploy(game, 0, own.id, edge.x, edge.y);
  for (let seat = 0; seat < map.spawns.length; seat++) G.confirmDeployment(game, seat);
  assert.ok(G.reachable(game, own).has(G.key(edge.x + 1, edge.y)));
});

test("catalog rejects malformed, undersized or overlapping rectangular deployment areas", () => {
  const map = G.getMap("frontier_1v1");
  const filename = path.resolve("assets/maps/.deployment-test-" + randomUUID() + ".json");
  const ref = "maps/" + path.basename(filename);
  try {
    for (const mutate of [
      (m) => m.deploymentAreas.pop(),
      (m) => (m.deploymentExpansion.addedLeft = 100),
      (m) => (m.deploymentAreas[0].width = 0),
      (m) => (m.deploymentAreas[0].height = m.height + 1),
      (m) => {
        m.deploymentAreas[0].width = 1;
        m.spawns[0].x = 0;
      },
      (m) => {
        m.deploymentAreas[1] = { ...m.deploymentAreas[0] };
        m.spawns[1].x = m.spawns[0].x;
      },
    ]) {
      const invalid = structuredClone(map);
      mutate(invalid);
      fs.writeFileSync(filename, JSON.stringify(invalid));
      assert.throws(
        () => loadCatalog({ catalogOverride: { ...G.catalog, maps: [ref], defaultMap: map.id } }),
        /deployment|Spawn/i,
      );
    }
  } finally {
    fs.rmSync(filename, { force: true });
  }
});
