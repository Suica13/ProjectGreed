const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const G = require("../shared/rules.js"),
  M = require("../shared/map-document.js");
const { compactMap } = require("../tools/compact-encounter-maps.cjs");
const { compactShipFootprint } = require("../tools/unit-footprint.cjs");

test("all ship variants use 1x2 or 2x2 cells while retaining original footprint evidence", () => {
  const ships = Object.values(G.models).filter((model) => model.ship);
  assert(ships.length >= 56);
  for (const model of ships) {
    assert([1, 2].includes(model.footprint.width), model.id);
    assert.equal(model.footprint.height, 2, model.id);
  }
  const p = { stats: { ship: true, footprint: { width: 3, height: 6 } } };
  compactShipFootprint(p);
  assert.deepEqual(p.stats.footprint, { width: 2, height: 2 });
  assert.deepEqual(p.sourceStats.shipFootprintBeforeCompaction, { width: 3, height: 6 });
  const once = structuredClone(p);
  compactShipFootprint(p);
  assert.deepEqual(p, once);
  for (const ref of JSON.parse(fs.readFileSync("assets/unit-catalog.json", "utf8")).units) {
    const raw = JSON.parse(fs.readFileSync("assets/" + ref, "utf8"));
    if (!raw.stats.ship) continue;
    assert([1, 2].includes(raw.stats.footprint.width), ref);
    assert.equal(raw.stats.footprint.height, 2, ref);
  }
});

test("reimporting ships uses the same compact footprint policy as the runtime loader", () => {
  const fixtures = [
    [1, 3],
    [2, 3],
    [3, 6],
  ].map(([width, height]) => ({ stats: { ship: true, footprint: { width, height } } }));
  const result = spawnSync(
    "python",
    [
      "-c",
      "import json,sys;sys.path.insert(0,'tools');from unit_ship_balance import apply_footprint;items=json.load(sys.stdin);[apply_footprint(p) for p in items];print(json.dumps(items))",
    ],
    { input: JSON.stringify(fixtures), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout),
    fixtures.map((prefab) => compactShipFootprint(prefab)),
  );
});

test("all encounter maps have 75 percent side lengths and remain valid on repeated migration", () => {
  const catalog = JSON.parse(fs.readFileSync("assets/unit-catalog.json", "utf8"));
  for (const ref of catalog.maps) {
    const map = JSON.parse(fs.readFileSync("assets/" + ref, "utf8"));
    assert.equal(map.width, Math.round(map.encounterScale.sourceWidth * 0.75), map.id);
    assert.equal(map.height, Math.round(map.encounterScale.sourceHeight * 0.75), map.id);
    assert.deepEqual(compactMap(map, G.catalog.formation.maxUnits), map);
    if (map.tileMap) {
      const terrain = M.terrainData(map.tileMap);
      assert.deepEqual(terrain.tiles, map.tiles);
      assert.deepEqual(terrain.cellEnvironments, map.cellEnvironments);
      assert.deepEqual(M.gameIssues(map.tileMap, G.catalog.formation.maxUnits), []);
      for (const layer of map.tileMap.layers.filter((layer) => layer.type === "image")) {
        assert.equal(layer.image.width, map.width);
        assert.equal(layer.image.height, map.height);
      }
    }
  }
  assert.equal(G.catalog.map.width, G.getMap(G.catalog.defaultMap).width);
});

for (const [name, entry, count] of [
  ["ordinary units", { unitId: "Type61", kitId: "standard" }, 72],
  ["compact 2x2 ships", { unitId: "PegasusClass", kitId: "standard" }, 18],
])
  test(`every encounter map can deploy a full 72-point formation of ${name}`, () => {
    for (const ref of JSON.parse(fs.readFileSync("assets/unit-catalog.json", "utf8")).maps) {
      const map = G.getMap(ref.replace(/^.*\//, "").replace(/\.json$/, ""));
      const armies = map.spawns.map(() => Array.from({ length: count }, () => ({ ...entry })));
      const game = G.create(false, 1, armies, true, {
        mapId: map.id,
        costLimit: 99999,
        unitCostLimit: 99999,
        unitLimit: 72,
        fogMode: "disabled",
      });
      assert.equal(game.units.length, map.spawns.length * count, map.id);
      for (const unit of game.units) assert(G.fits(game, unit), map.id + "/" + unit.id);
    }
  });
