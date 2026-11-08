"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  M = require("../shared/map-document.js"),
  root = path.resolve(__dirname, "..");
const hash = (x, y, s) => {
  let n = Math.imul(x + 13, 374761393) ^ Math.imul(y + 71, 668265263) ^ s;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
};
function rebuildLegacy(source) {
  if (source.encounterScale?.version === 4) {
    const map = structuredClone(source),
      atlas = fs.readFileSync(path.join(root, "assets/maps/tilesets/encounter-pixel-props-v1.png"));
    const width = atlas.readUInt32BE(16),
      height = atlas.readUInt32BE(20),
      set = map.tileMap.tilesets[0];
    Object.assign(set, {
      width,
      height,
      tileWidth: Math.floor(width / 8),
      tileHeight: Math.floor(height / 8),
    });
    for (const tile of map.tileMap.tiles) {
      const parts = tile.id.split("_");
      tile.x = Math.round((Number(parts[3]) * width) / 8);
      tile.y = Math.round((Number(parts[2]) * height) / 8);
    }
    return map;
  }
  const map = structuredClone(source),
    ow = map.width,
    oh = map.height,
    width = Math.min(60, Math.max(40, ow)),
    height = Math.min(36, Math.max(24, Math.round(width / 1.65)));
  const sample = (d) =>
    Array.from({ length: height }, (_, y) =>
      Array.from(
        { length: width },
        (_, x) =>
          d[Math.min(oh - 1, Math.floor(((y + 0.5) * oh) / height))][
            Math.min(ow - 1, Math.floor(((x + 0.5) * ow) / width))
          ],
      ),
    );
  map.width = width;
  map.height = height;
  map.tiles = sample(source.tiles);
  if (source.cellEnvironments) map.cellEnvironments = sample(source.cellEnvironments);
  delete map.deploymentExpansion;
  const seed = [...map.id].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) | 0, 7),
    doc = map.tileMap;
  if (!doc) throw Error("Missing TileMap: " + map.id);
  Object.assign(doc, { width, height });
  const space = map.environment === "space",
    biome = map.appearance?.biome,
    arid = biome === "desert",
    snow = biome === "arctic" || /ice/.test(map.id),
    urban = biome === "urban",
    industrial = /base|driver|baoa|interior/.test(map.id),
    coastal = /coastal|ice_bridges/.test(map.id);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let t = map.tiles[y][x];
      const c = hash((x / 3) | 0, (y / 3) | 0, seed) % 100,
        f = hash(x, y, seed) % 100;
      if (space && (map.cellEnvironments?.[y]?.[x] || map.environment) === "space") {
        t = c < 22 && f < 48 ? (f % 3 ? "rock" : "rubble") : "plain";
      } else if (t === "plain") {
        if (space && c < 23 && f < 64) t = "rubble";
        else if (snow) t = "snow";
        else if (arid) t = "desert";
        else if (industrial && c < 27) t = "plain";
        else if (urban && c < 35) t = "rubble";
        else if (!space && c < (/rainforest/.test(map.id) ? 60 : 23) && f < 78) t = "forest";
      }
      map.tiles[y][x] = t;
    }
  M.setPlayers(doc, 2, map.playersPerTeam);
  const aw = Math.min(Math.floor(width * 0.31), 17),
    ah = Math.min(height - 4, 12 + map.playersPerTeam * 2);
  const baseY = Math.floor((height - ah) / 2),
    candidates = [];
  for (const dy of [-3, 0, 3])
    for (const left of [1, 3, 5]) {
      const top = Math.max(2, Math.min(height - ah - 2, baseY + dy));
      if (left + aw >= width / 2 - 1) continue;
      let score = 0;
      for (let y = top; y < top + ah; y++)
        for (let x = left; x < left + aw; x++)
          score += ["plain", "snow", "desert"].includes(map.tiles[y][x])
            ? 2
            : map.tiles[y][x] === "forest"
              ? 1
              : 0;
      candidates.push({
        x: left,
        y: top,
        width: aw,
        height: ah,
        score: score + (hash(left, top, seed) % 17),
      });
    }
  const a = candidates.sort((a, b) => b.score - a.score)[0];
  delete a.score;
  const other = { x: width - a.x - aw, y: height - a.y - ah, width: aw, height: ah };
  doc.deploymentAreas = doc.spawns.map((spawn) => ({ ...(spawn.team ? other : a) }));
  const cols = Math.ceil(Math.sqrt(map.playersPerTeam)),
    rows = Math.ceil(map.playersPerTeam / cols);
  for (let p = 0; p < map.playersPerTeam; p++) {
    const x = a.x + Math.floor(aw / 2) + ((p % cols) - (cols - 1) / 2) * 3;
    const y = a.y + Math.floor(ah / 2) + (Math.floor(p / cols) - (rows - 1) / 2) * 3;
    Object.assign(doc.spawns[p * 2], { x: Math.round(x), y: Math.round(y) });
    Object.assign(doc.spawns[p * 2 + 1], {
      x: width - 1 - Math.round(x),
      y: height - 1 - Math.round(y),
    });
  }
  map.spawns = structuredClone(doc.spawns);
  map.deploymentAreas = structuredClone(doc.deploymentAreas);
  for (const a of doc.deploymentAreas)
    for (let y = a.y; y < a.y + a.height; y++)
      for (let x = a.x; x < a.x + a.width; x++)
        if (["rock", "water", "deep_water"].includes(map.tiles[y][x])) map.tiles[y][x] = "plain";
  if (!space)
    for (const y of [(height * 0.35) | 0, (height * 0.68) | 0])
      for (let x = 1; x < width - 1; x++)
        if (["rock", "water", "deep_water"].includes(map.tiles[y][x])) map.tiles[y][x] = "plain";
  const rowFor = (t) =>
    space
      ? industrial && ["road", "residential"].includes(t)
        ? 7
        : 6
      : t === "forest"
        ? 1
        : ["rubble", "residential"].includes(t)
          ? 2
          : t === "desert"
            ? 3
            : t === "snow"
              ? 4
              : ["water", "deep_water", "shallow_water"].includes(t)
                ? 5
                : t === "road" && industrial
                  ? 7
                  : snow
                    ? 4
                    : arid
                      ? 3
                      : 0;
  const defs = new Map(),
    data = [];
  doc.tilesets = [
    {
      id: "biomes_v1",
      name: "低饱和生态图集",
      image: "asset:encounter-pixel-props-v1",
      width: 1263,
      height: 1246,
      tileWidth: 157,
      tileHeight: 155,
      margin: 0,
      spacing: 0,
    },
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = map.tiles[y][x],
        v = t === "rock" && !arid ? 6 + (hash(x, y, seed) % 2) : hash(x, y, seed) % 8,
        env = map.cellEnvironments?.[y]?.[x] || map.environment,
        row = space && env === "ground" ? 7 : t === "rock" && !arid ? 0 : rowFor(t),
        noSprite =
          (env === "space" && t === "plain") ||
          (["plain", "desert", "snow", "water"].includes(t) &&
            hash(x, y, seed + 37) % 100 > (industrial ? 15 : 8)),
        id = [t, env, row, v, noSprite ? "empty" : "prop"].join("_");
      if (!defs.has(id))
        defs.set(id, {
          id,
          name: t + " " + (v + 1),
          noSprite,
          terrain: t,
          environment: env,
          color: M.terrains[t].color,
          tilesetId: "biomes_v1",
          x: Math.round((v * 1263) / 8),
          y: Math.round((row * 1246) / 8),
          decorative: false,
          dynamic: false,
        });
      data.push(id);
    }
  doc.biomeStyle = { version: 1, biome: biome || "urban", seed };
  doc.tiles = [...defs.values()];
  doc.layers = [
    {
      id: "biome_ground",
      name: "生态地貌与细节",
      type: "tile",
      placement: "below",
      decorative: false,
      dynamic: false,
      visible: true,
      opacity: 1,
      data,
    },
  ];
  for (const u of doc.units || []) {
    u.x = Math.min(width - 1, Math.floor((u.x * width) / ow));
    u.y = Math.min(height - 1, Math.floor((u.y * height) / oh));
  }
  M.validate(doc);
  Object.assign(map, M.terrainData(doc));
  map.encounterScale = { version: 4, sourceWidth: ow, sourceHeight: oh, sharedDeployment: true };
  return map;
}
function rebuild(map) { return require("./rebuild-biome-maps.cjs").rebuild(map.tileMap?.biomeStyle?.version===2 ? map : rebuildLegacy(map)); }
function main() {
  const file = path.join(root, "assets/unit-catalog.json"),
    catalog = JSON.parse(fs.readFileSync(file)),
    overrides = {};
  for (const ref of catalog.maps.filter((r) => r.startsWith("maps/encounter/")))
    overrides[ref] = rebuild(JSON.parse(fs.readFileSync(path.join(root, "assets", ref))));
  const main = Object.values(overrides).find((m) => m.id === catalog.defaultMap);
  catalog.map = { width: main.width, height: main.height };
  catalog.deployment.spawns = main.spawns.map(({ x, y }) => ({ x, y }));
  require("./load-catalog.cjs").loadCatalog({ catalogOverride: catalog, mapOverrides: overrides });
  if (!process.argv.includes("--check")) {
    for (const [ref, map] of Object.entries(overrides))
      fs.writeFileSync(path.join(root, "assets", ref), JSON.stringify(map, null, 2) + "\n");
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
  }
  console.log(
    JSON.stringify(
      Object.values(overrides).map((m) => ({ id: m.id, width: m.width, height: m.height })),
      null,
      2,
    ),
  );
}
module.exports = { rebuild, rebuildLegacy };
if (require.main === module) main();
