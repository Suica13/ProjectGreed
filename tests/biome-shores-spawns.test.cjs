const test = require("node:test"),
  assert = require("node:assert/strict"),
  M = require("../shared/map-document"),
  B = require("../shared/biome-tiles"),
  G = require("../shared/rules");
test("all sixteen shore edge combinations follow neighbouring terrain", () => {
  for (let mask = 0; mask < 16; mask++) {
    const d = M.create({ width: 12, height: 9 });
    d.biomeStyle = { version: 1, biome: "forest", seed: 1 };
    d.tiles = [
      { id: "sea", terrain: "water", environment: "ground", color: "#344f60" },
      { id: "land", terrain: "plain", environment: "ground", color: "#4b5d4b" },
    ];
    d.layers[0].data.fill("sea");
    [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].forEach(([dx, dy], i) => {
      if (mask & (1 << i)) d.layers[0].data[(4 + dy) * 12 + 5 + dx] = "land";
    });
    assert.equal(B.shoreMask(d, 5, 4), mask);
  }
});
test("encounter spawn positions and deployment areas are centrally mirrored and space stays mostly empty", () => {
  const maps = Object.values(G.catalog.maps).filter((m) => m.encounterScale?.version === 4);
  assert.equal(maps.length, 17);
  for (const m of maps) {
    for (let i = 0; i < m.spawns.length; i += 2) {
      const a = m.spawns[i],
        b = m.spawns[i + 1];
      assert.equal(a.x + b.x, m.width - 1, m.id);
      assert.equal(a.y + b.y, m.height - 1, m.id);
      assert(
        a.y >= m.height * 0.25 && a.y <= m.height * 0.75,
        m.id + " spawn away from upper edge",
      );
      const l = m.deploymentAreas[i],
        r = m.deploymentAreas[i + 1];
      assert.equal(l.x + r.x + l.width, m.width);
      assert.equal(l.y + r.y + l.height, m.height);
    }
    if (m.environment === "space") {
      let open = 0,
        total = 0;
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++)
          if (m.cellEnvironments[y][x] === "space") {
            total++;
            if (m.tiles[y][x] === "plain") open++;
          }
      assert(open / total > 0.75, m.id + " mostly empty space");
    }
  }
});
