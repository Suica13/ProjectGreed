const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const M = require("../shared/map-document.js"),
  Climate = require("../shared/battlefield-climate.js");
const { rebuild } = require("../tools/rebuild-encounter-maps.cjs");
test("every encounter map has synchronized editable TileMap terrain, deployment and climate", () => {
  const files = fs
    .readdirSync("assets/maps/encounter")
    .filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 17);
  for (const file of files) {
    const map = JSON.parse(fs.readFileSync("assets/maps/encounter/" + file));
    M.validate(map.tileMap);
    assert.deepEqual(
      M.terrainData(map.tileMap),
      { tiles: map.tiles, cellEnvironments: map.cellEnvironments },
      map.id,
    );
    assert.deepEqual(map.tileMap.spawns, map.spawns);
    assert.deepEqual(map.tileMap.deploymentAreas, map.deploymentAreas);
    assert.deepEqual(map.tileMap.climate, map.climate);
    assert.deepEqual(rebuild(map), map, "idempotent " + map.id);
    if (map.environment === "space") {
      assert.equal(map.surfaceCover, false);
      assert.equal(Climate.resolve(map, {}, 20, 7).weather, "none");
    } else {
      const cfg = Climate.config(map);
      assert(cfg.weather.allowed.length);
      assert(cfg.time.allowed.length > 1);
    }
  }
});
test("desert and polar tiles use their real terrain types; painted maps retain their background layers", () => {
  for (const [id, terrain] of [
    ["open_dunes_1v1", "desert"],
    ["frontier_1v1", "snow"],
    ["ice_bridges_2v2", "snow"],
  ]) {
    const m = JSON.parse(
      fs.readFileSync("assets/maps/encounter/" + id + ".json"),
    );
    assert(m.tiles.flat().includes(terrain));
    assert(!m.tiles.flat().includes("plain"));
  }
  for (const id of [
    "a_baoa_qu_space_3v3",
    "colony_interior_3v3",
    "mass_driver_facility_3v3",
  ]) {
    const m = JSON.parse(
      fs.readFileSync("assets/maps/encounter/" + id + ".json"),
    );
    assert(
      m.tileMap.layers.some(
        (l) => l.type === "image" && l.image.src.startsWith("data:image/"),
      ),
    );
  }
  const desert = JSON.parse(
    fs.readFileSync("assets/maps/encounter/open_dunes_1v1.json"),
  );
  assert(!desert.climate.weather.allowed.includes("snow"));
  const colony = JSON.parse(
    fs.readFileSync("assets/maps/encounter/colony_interior_3v3.json"),
  );
  assert.deepEqual(colony.climate.weather.allowed, ["clear"]);
  assert.equal(colony.climate.weather.fixed, true);
});
