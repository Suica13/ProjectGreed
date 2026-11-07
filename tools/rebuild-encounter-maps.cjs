"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const M = require("../shared/map-document.js");
const root = path.resolve(__dirname, ".."),
  directory = path.join(root, "assets/maps/encounter");
const terrains = [
  "plain",
  "forest",
  "rubble",
  "rock",
  "water",
  "highland",
  "snow",
  "desert",
];
const times = [
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "evening",
  "late_night",
  "pre_dawn",
];
const profiles = {
  arctic: {
    weights: { clear: 4, snow: 6, blizzard: 1, overcast: 4, fog: 1 },
    duration: 5,
  },
  ice_bridges_2v2: {
    weights: { clear: 4, snow: 3, overcast: 4, fog: 3, rain: 1 },
    duration: 4,
  },
  desert: {
    weights: { clear: 14, sand: 5, sandstorm: 1, overcast: 1 },
    duration: 5,
  },
  forest: { weights: { clear: 9, rain: 3, overcast: 4, fog: 2 }, duration: 4 },
  wetland: {
    weights: { clear: 7, rain: 5, heavy_rain: 2, overcast: 4, fog: 2 },
    duration: 4,
  },
  urban: { weights: { clear: 10, rain: 3, overcast: 4, fog: 1 }, duration: 5 },
  serpentine_rainforest_3v3: {
    weights: { clear: 3, rain: 8, heavy_rain: 4, overcast: 5, fog: 3 },
    duration: 3,
  },
  colony_interior_3v3: { weights: { clear: 1 }, duration: 6, indoor: true },
};
const palettes = {
  arctic: [
    "#a9c2cf",
    "#58716e",
    "#8297a5",
    "#8d9ea6",
    "#345568",
    "#9dacb3",
    "#d3e2eb",
    "#bdaf90",
  ],
  desert: [
    "#c8af78",
    "#737b4b",
    "#92806b",
    "#9e8969",
    "#487a87",
    "#b7a078",
    "#d4e1df",
    "#cbb078",
  ],
  urban: [
    "#65737e",
    "#50674d",
    "#8e8175",
    "#687079",
    "#33566d",
    "#8a8b77",
    "#d3e2eb",
    "#b9a475",
  ],
  forest: [
    "#5d775d",
    "#35634a",
    "#8b8175",
    "#778382",
    "#416a7a",
    "#8f926d",
    "#d3e2eb",
    "#b9a475",
  ],
  wetland: [
    "#6e8769",
    "#38664f",
    "#8b8175",
    "#778382",
    "#315a71",
    "#8f926d",
    "#d3e2eb",
    "#b9a475",
  ],
  space: [
    "#101c2b",
    "#48515c",
    "#586672",
    "#68737d",
    "#17283d",
    "#536370",
    "#d3e2eb",
    "#b9a475",
  ],
};
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const tag = Buffer.from(type),
    body = Buffer.concat([tag, data]);
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function atlas(biome, colors = {}) {
  const width = 128,
    height = terrains.length * 32,
    raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const row = Math.floor(y / 32),
        terrain = terrains[row],
        variant = Math.floor(x / 32),
        px = x % 32,
        py = y % 32;
      const color = colors[terrain] || palettes[biome][row];
      let rgb = color.match(/[a-f0-9]{2}/gi).map((h) => parseInt(h, 16));
      const noise =
        ((px * 37 + py * 53 + variant * 79 + px * py * 13) % 19) - 9;
      let tone = noise * 0.55;
      if (terrain === "forest") {
        const dx = px - ((10 + variant * 3) % 22),
          dy = py - 15;
        tone += dx * dx + dy * dy < 120 ? 10 : -12;
        if ((px + variant * 5) % 13 === 0 && py > 18) tone -= 14;
      } else if (terrain === "rubble")
        tone +=
          (px + variant * 3) % 17 < 11 && (py + variant * 2) % 15 < 8
            ? 20
            : -14;
      else if (terrain === "rock")
        tone += Math.sin((px + py * 0.6 + variant * 4) / 5) * 12;
      else if (terrain === "water")
        tone += Math.sin((py + Math.sin(px / 9) * 2) / 3) * 9;
      else if (terrain === "desert")
        tone += Math.sin((py + px * 0.25 + variant * 4) / 4) * 10;
      else if (terrain === "snow") tone += Math.sin((py + px * 0.3) / 6) * 4;
      else if (biome === "space" && terrain === "plain")
        tone = (px * 17 + py * 31 + variant) % 97 === 0 ? 90 : 0;
      else if (biome === "urban" && terrain === "plain")
        tone += px % 16 === 0 || py % 16 === 0 ? -8 : 0;
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rgb.forEach(
        (v, i) =>
          (raw[offset + i] = Math.max(0, Math.min(255, Math.round(v + tone)))),
      );
      raw[offset + 3] = 255;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return (
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64")
  );
}
function rebuild(input) {
  const map = structuredClone(input),
    space = map.environment === "space";
  const biome =
    map.appearance?.biome ||
    (space
      ? "space"
      : map.id === "mass_driver_facility_3v3"
        ? "wetland"
        : "urban");
  const profile = profiles[map.id] || profiles[biome] || profiles.forest;
  map.surfaceCover = !space && !profile.indoor;
  map.climate = {
    weather: {
      allowed: space ? ["clear"] : Object.keys(profile.weights),
      weights: space ? { clear: 1 } : profile.weights,
      durationRounds: profile.duration || 4,
      fixed: space || !!profile.indoor,
    },
    time: {
      allowed: space ? ["noon"] : times,
      durationRounds: profile.indoor ? 6 : 4,
      fixed: space,
    },
  };
  map.lighting = {
    direction: "upper",
    horizontalAngle: -45,
    distance: space ? 0 : 0.15,
    intensity: 0.25,
    enabled: !space,
  };
  if (!map.tileMap || map.encounterTilesVersion === 1) {
    map.tiles = map.tiles.map((row) =>
      row.map((terrain) =>
        terrain === "plain" && biome === "arctic"
          ? "snow"
          : terrain === "plain" && biome === "desert"
            ? "desert"
            : terrain,
      ),
    );
    const doc = M.create({
      id: map.id,
      name: map.name,
      description: map.description,
      width: map.width,
      height: map.height,
      environment: map.environment || "ground",
      playersPerTeam: map.playersPerTeam,
    });
    doc.spawns = structuredClone(map.spawns);
    doc.deploymentAreas = structuredClone(map.deploymentAreas);
    doc.supportedModes = map.supportedModes || ["regular", "quick"];
    doc.seed = 1;
    doc.tilesets = [
      {
        id: "encounter_atlas",
        name: "战场地表图集",
        image: atlas(biome, map.appearance?.colors),
        width: 128,
        height: 256,
        tileWidth: 32,
        tileHeight: 32,
        margin: 0,
        spacing: 0,
      },
    ];
    doc.tiles = terrains.flatMap((terrain, row) =>
      Array.from({ length: 4 }, (_, variant) => ({
        id: terrain + "_" + variant,
        name: M.terrains[terrain].name + " " + (variant + 1),
        terrain,
        environment: doc.environment,
        color: map.appearance?.colors?.[terrain] || palettes[biome][row],
        tilesetId: "encounter_atlas",
        x: variant * 32,
        y: row * 32,
        decorative: false,
        dynamic: false,
      })),
    );
    doc.layers = [
      {
        id: "encounter_ground",
        name: "地形与地表",
        type: "tile",
        placement: "below",
        decorative: false,
        dynamic: false,
        visible: true,
        opacity: 1,
        data: map.tiles.flatMap((row, y) =>
          row.map(
            (terrain, x) => terrain + "_" + ((x * 17 + y * 31 + x * y) % 4),
          ),
        ),
      },
    ];
    map.tileMap = doc;
    map.encounterTilesVersion = 1;
  }
  Object.assign(map.tileMap, {
    climate: structuredClone(map.climate),
    surfaceCover: map.surfaceCover,
    lighting: structuredClone(map.lighting),
  });
  M.validate(map.tileMap);
  const derived = M.terrainData(map.tileMap);
  map.tiles = derived.tiles;
  map.cellEnvironments = derived.cellEnvironments;
  return map;
}
function main() {
  const overrides = {};
  for (const filename of fs
    .readdirSync(directory)
    .filter((f) => f.endsWith(".json"))) {
    const ref = "maps/encounter/" + filename;
    overrides[ref] = rebuild(
      JSON.parse(fs.readFileSync(path.join(directory, filename), "utf8")),
    );
  }
  require("./load-catalog.cjs").loadCatalog({ mapOverrides: overrides });
  if (!process.argv.includes("--check"))
    for (const [ref, map] of Object.entries(overrides))
      fs.writeFileSync(
        path.join(root, "assets", ref),
        JSON.stringify(map, null, 2) + "\n",
      );
  console.log(
    "Validated " +
      Object.keys(overrides).length +
      " encounter TileMaps and climate profiles",
  );
}
if (require.main === module) main();
module.exports = { rebuild };
