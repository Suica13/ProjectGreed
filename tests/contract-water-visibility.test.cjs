const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const C = require("../shared/contract-mode");

test("contract water uses blue water roles and shore masks matching actual terrain", () => {
  const source = G.catalog.maps.great_plains_5v5.tileMap;
  const before = JSON.stringify(source);
  const tiles = [
    ["water", "water", "water", "plain"],
    ["water", "water", "water", "forest"],
    ["water", "water", "rock", "highland"],
  ];
  const doc = C.visualMap(G.catalog, {
    mapId: "great_plains_5v5", environment: "ground", tiles,
    spawns: [], deploymentAreas: [],
  }).tileMap;
  const defs = new Map(doc.tiles.map(t => [t.id, t]));
  const ground = doc.layers.find(l => l.id === "contract-ground").data;
  const shores = doc.layers.find(l => l.id === "contract-shores").data;
  tiles.forEach((row, y) => row.forEach((kind, x) => {
    const index = y * row.length + x;
    if (kind !== "water") {
      assert.equal(shores[index], null);
      assert(!["water", "shallow"].includes(defs.get(ground[index]).biomeRole));
      return;
    }
    const mask = [[0,-1],[1,0],[0,1],[-1,0]].reduce((m,[dx,dy],i) => {
      const n = tiles[y+dy]?.[x+dx];
      return n != null && n !== "water" ? m | (1 << i) : m;
    }, 0);
    assert.equal(defs.get(ground[index]).biomeRole, mask ? "shallow" : "water");
    assert.equal(shores[index], mask ? "contract-shore-" + mask : null);
    if (mask) assert.equal(defs.get(shores[index]).mask, mask);
  }));
  assert.equal(JSON.stringify(source), before, "source atlas must stay unchanged");
});

test("space contracts retain their orbital atlas without terrestrial shore overlays", () => {
  const doc = C.visualMap(G.catalog, {
    mapId: "outer_orbit_5v5", environment: "space",
    tiles: [["plain", "rock"]], spawns: [], deploymentAreas: [],
  }).tileMap;
  assert(!doc.layers.some(l => l.id === "contract-shores"));
  assert(!doc.tiles.some(t => t.id.startsWith("contract-water")));
});
