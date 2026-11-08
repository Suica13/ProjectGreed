const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const M = require("../shared/map-document"),
  R = require("../tools/rebuild-biome-maps.cjs");
const root = path.resolve(__dirname, ".."),
  catalog = require("../assets/unit-catalog.json");
test("biome atlas files and all source rectangles are valid and independently replaceable", () => {
  const ids = require("../assets/maps/biomes/catalog.json").biomes;
  assert.equal(ids.length, 6);
  for (const id of ids) {
    const dir = path.join(root, "assets/maps/biomes", id),
      b = JSON.parse(fs.readFileSync(path.join(dir, "biome.json"))),
      png = fs.readFileSync(path.join(dir, b.image));
    assert.equal(png.readUInt32BE(16), b.width);
    assert.equal(png.readUInt32BE(20), b.height);
    assert.equal(fs.readdirSync(dir).filter((p) => p.endsWith(".png")).length, 1);
    for (const variants of Object.values(b.frames))
      for (const f of variants) {
        assert(f.x >= 0 && f.y >= 0 && f.width > 0 && f.height > 0);
        assert(f.x + f.width <= b.width && f.y + f.height <= b.height);
      }
  }
});
test("all twenty maps retain real terrain attributes and reusable layered biome tilemaps", () => {
  let n = 0;
  const used = new Set();
  for (const ref of catalog.maps.filter((p) => /^maps\/(encounter|battlefield)\//.test(p))) {
    const m = JSON.parse(fs.readFileSync(path.join(root, "assets", ref))),
      d = m.tileMap;
    M.validate(d);
    assert.equal(d.biomeStyle.version, 2);
    used.add(d.biomeStyle.biome);
    assert.equal(d.tilesets.length, 1);
    assert.equal(d.tilesets[0].image, "asset:biome-" + d.biomeStyle.biome);
    assert.equal(d.layers.length, 5);
    assert.deepEqual(M.terrainData(d).tiles, m.tiles, m.id);
    assert(
      m.tiles.flat().some((t) => t !== "plain"),
      m.id + " has actual non-plain terrain",
    );
    const rebuilt = R.rebuild(m);
    assert.deepEqual(rebuilt.tiles, m.tiles, m.id + " preserves terrain when regenerated");
    assert.deepEqual(rebuilt.battlefield, m.battlefield, m.id + " preserves sites");
    assert.deepEqual(rebuilt.spawns, m.spawns);
    n++;
  }
  assert.equal(n, 20);
  assert.equal(used.size, 6);
});
test("coast and rainforest use connected water, banks and passable crossings", () => {
  const coast = require("../assets/maps/encounter/coastal_supply_2v2.json"),
    river = require("../assets/maps/encounter/serpentine_rainforest_3v3.json");
  for (const m of [coast, river]) {
    assert(m.tiles.flat().filter((t) => t === "water").length > 50);
    assert(m.tileMap.layers.find((l) => l.id === "terrain_shore").data.some(Boolean));
    assert(m.tileMap.layers.find((l) => l.id === "terrain_roads").data.some(Boolean));
  }
  assert.equal(coast.tiles[0].filter((t) => t === "water").length, coast.width);
  for (const factor of [0.33, 0.67]) {
    const y = Math.round(river.height * factor),
      x = Math.round((river.width - 1) / 2 + 3 * Math.sin((y - (river.height - 1) / 2) / 5));
    assert.equal(river.tiles[y][x], "plain");
  }
});
