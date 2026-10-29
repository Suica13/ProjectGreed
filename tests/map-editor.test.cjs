const test = require("node:test"),
  assert = require("node:assert/strict");
const M = require("../shared/map-document.js"),
  View = require("../shared/tilemap-view.js");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0p8AAAAASUVORK5CYII=";
test("map composition preserves mixed environments and ignores decorative/hidden tiles and layers", () => {
  const d = M.create(),
    base = d.layers[0],
    overlay = M.layer(d, "Overlay");
  base.data[0] = "terrain_snow";
  base.data[1] = "terrain_desert";
  d.tiles.find((t) => t.id === "terrain_snow").environment = "space";
  overlay.data[0] = "terrain_rock";
  overlay.decorative = true;
  d.layers.push(overlay);
  let out = M.compile(d);
  assert.equal(out.tiles[0][0], "snow");
  assert.equal(out.tiles[0][1], "desert");
  assert.equal(out.cellEnvironments[0][0], "space");
  overlay.decorative = false;
  overlay.opacity = 0;
  out = M.compile(d);
  assert.equal(out.tiles[0][0], "rock", "invisible collision uses opacity zero");
  overlay.visible = false;
  assert.equal(M.compile(d).tiles[0][0], "snow");
  overlay.visible = true;
  d.tiles.find((t) => t.id === "terrain_rock").decorative = true;
  assert.equal(M.compile(d).tiles[0][0], "snow");
});
test("embedded images, dynamic flags, layer placement and rules round-trip losslessly", () => {
  const d = M.create();
  d.layers[0].placement = "above";
  d.layers[0].dynamic = true;
  d.tiles[0].dynamic = true;
  d.layers.push({
    id: "image",
    name: "Background",
    type: "image",
    placement: "below",
    visible: true,
    decorative: true,
    dynamic: false,
    opacity: 0.7,
    image: { src: png, x: 0, y: 0, width: d.width, height: d.height },
  });
  M.addTileset(d, {
    id: "atlas",
    name: "Atlas",
    image: png,
    width: 66,
    height: 34,
    tileWidth: 32,
    tileHeight: 32,
    margin: 1,
    spacing: 0,
  });
  d.rules.push({
    id: "random",
    name: "Variation",
    type: "random",
    variants: [{ tileId: "terrain_plain", weight: 2 }],
  });
  const encoded = JSON.stringify(M.compile(d));
  assert.deepEqual(M.importMap(JSON.parse(encoded)), d);
  assert.equal(d.tiles.filter((t) => t.tilesetId === "atlas").length, 2);
  assert.equal(d.tiles.find((t) => t.tilesetId === "atlas").x, 1);
});
test("flood fill stays connected, respects boundaries and safely fills with the same tile", () => {
  const d = M.create({ width: 12, height: 9 }),
    l = d.layers[0];
  for (let y = 0; y < d.height; y++) l.data[y * d.width + 5] = "terrain_rock";
  M.fill(d, l, 0, 0, "terrain_water");
  assert.equal(l.data.filter((id) => id === "terrain_water").length, 45);
  assert.equal(l.data[6], null);
  M.fill(d, l, 0, 0, "terrain_water");
  assert.equal(l.data[0], "terrain_water");
});
test("nine-slice rectangles repeat edges and centres while retaining their four corners", () => {
  const d = M.create(),
    l = d.layers[0];
  d.tiles.push({ ...d.tiles[0], id: "ninth" });
  const ids = d.tiles.slice(0, 9).map((t) => t.id),
    rule = { type: "nine", tiles: ids };
  M.paintRect(d, l, { x: 2, y: 3, width: 6, height: 5 }, ids[0], rule);
  assert.equal(l.data[3 * d.width + 2], ids[0]);
  assert.equal(l.data[3 * d.width + 7], ids[2]);
  assert.equal(l.data[7 * d.width + 2], ids[6]);
  assert.equal(l.data[7 * d.width + 7], ids[8]);
  assert.equal(l.data[5 * d.width + 4], ids[4]);
  assert.equal(l.data[4 * d.width + 2], ids[3]);
});
test("weighted random tiles are reproducible, change with seed, and are saved as concrete cells", () => {
  const d = M.create(),
    l = d.layers[0],
    bounds = { x: 0, y: 0, width: d.width, height: d.height };
  const r = {
    type: "random",
    variants: [
      { tileId: "terrain_snow", weight: 1 },
      { tileId: "terrain_desert", weight: 4 },
    ],
  };
  M.paintRect(d, l, bounds, "terrain_snow", r);
  const first = [...l.data];
  M.paintRect(d, l, bounds, "terrain_snow", r);
  assert.deepEqual(l.data, first);
  assert(first.filter((id) => id === "terrain_desert").length > first.length * 0.7);
  d.seed++;
  M.paintRect(d, l, bounds, "terrain_snow", r);
  assert.notDeepEqual(l.data, first);
  assert.deepEqual(M.importMap(M.compile(d)).layers[0].data, l.data);
});
test("selection, paste, cropping resize and history snapshots preserve their distinct cell contents", () => {
  const d = M.create(),
    l = d.layers[0];
  M.paintRect(d, l, { x: 2, y: 2, width: 3, height: 2 }, "terrain_forest");
  const before = M.snapshot(d),
    block = M.selection(d, l, { x: 2, y: 2, width: 3, height: 2 });
  M.paste(d, l, block, 7, 4);
  assert.equal(l.data[4 * d.width + 7], "terrain_forest");
  assert.equal(before.layers[0].data[4 * d.width + 7], null);
  M.resize(d, 12, 9);
  assert.equal(d.layers[0].data.length, 108);
  assert.equal(d.layers[0].data[4 * 12 + 7], "terrain_forest");
});
test("compatibility checks distinguish multi-team projects, invalid zones and valid two-team maps", () => {
  const d = M.create();
  assert.deepEqual(M.gameIssues(d), []);
  M.setPlayers(d, 3, 2);
  assert.equal(M.validate(d), d);
  assert(M.gameIssues(d).some((t) => t.includes("2队")));
  M.setPlayers(d, 2, 1);
  d.spawns[0].x = d.width - 1;
  assert(M.gameIssues(d).some((t) => t.includes("出生地")));
  M.setPlayers(d, 2, 1);
  d.deploymentAreas[1] = { ...d.deploymentAreas[0] };
  assert(M.gameIssues(d).some((t) => t.includes("重叠")));
});
test("import rejects unknown tiles, scripts/remote images, invalid weights and malformed dimensions", () => {
  for (const mutate of [
    (d) => (d.layers[0].data[0] = "missing"),
    (d) => (d.width = 100000),
    (d) =>
      d.rules.push({
        id: "r",
        name: "bad",
        type: "random",
        variants: [{ tileId: "terrain_plain", weight: 0 }],
      }),
    (d) => d.tilesets.push({ id: "atlas", image: "https://example.com/a.png" }),
    (d) => d.tilesets.push({ id: "atlas", image: "data:image/svg+xml;base64,PHN2Zz4=" }),
  ]) {
    const d = M.create();
    mutate(d);
    assert.throws(() => M.importMap(d));
  }
});
test("catalog accepts authored maps and rules honour per-cell space and selected modes", () => {
  const d = M.create({ id: "editor_test" });
  d.supportedModes = ["regular"];
  d.layers[0].data[4 * d.width + 15] = "terrain_snow";
  d.tiles.find((t) => t.id === "terrain_snow").environment = "space";
  const raw = require("../assets/unit-catalog.json"),
    ref = "maps/editor_test.json",
    map = M.compile(d);
  const catalog = loadCatalog({
    catalogOverride: { ...raw, maps: [...raw.maps, ref] },
    mapOverrides: { [ref]: map },
  });
  assert.equal(catalog.maps.editor_test.tiles[4][15], "snow");
  const G = require("../shared/rules.js");
  G.catalog.maps.editor_test = map;
  try {
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    const g = G.create(false, 1, [[e], [e]], false, { mapId: map.id });
    Object.assign(g.units[0], { x: 15, y: 4 });
    assert.equal(G.environmentOf(g, g.units[0]), "space");
    assert.equal(G.terrainCost(g, g.units[0], 15, 4), 1);
    assert.throws(() => G.create(false, 1, [[e], [e]], false, { mapId: map.id, mode: "quick" }));
  } finally {
    delete G.catalog.maps.editor_test;
  }
});
test("TileMap draw order respects layer placement and draws only viewport tiles", () => {
  const d = M.create(),
    base = d.layers[0],
    top = M.layer(d);
  base.data[0] = "terrain_water";
  top.placement = "above";
  top.data[0] = "terrain_forest";
  base.data[100] = "terrain_rock";
  d.layers.push(top);
  const calls = [],
    ctx = {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillRect(...args) {
        calls.push([this.fillStyle, ...args]);
      },
    };
  const view = View.create(),
    geo = { ox: 0, oy: 0, cellWidth: 32, cellHeight: 32, width: 32, height: 32 };
  view.draw(ctx, d, "below", geo);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], M.terrains.water.color);
  view.draw(ctx, d, "above", geo);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], M.terrains.forest.color);
});
test("map registration check validates an exported project without changing catalog or writing map files", (t) => {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    { randomUUID } = require("node:crypto");
  const { importMap } = require("../tools/import-map.cjs");
  const file = path.join(os.tmpdir(), "greed-map-" + randomUUID() + ".json");
  t.after(() => fs.rmSync(file, { force: true }));
  const d = M.create({ id: "map_import_check_only" });
  const before = fs.readFileSync("assets/unit-catalog.json", "utf8");
  fs.writeFileSync(file, JSON.stringify(d));
  assert.deepEqual(importMap(file, { checkOnly: true }), { id: d.id, checkOnly: true });
  assert.equal(fs.readFileSync("assets/unit-catalog.json", "utf8"), before);
  assert.equal(fs.existsSync("assets/maps/" + d.id + ".json"), false);
});
