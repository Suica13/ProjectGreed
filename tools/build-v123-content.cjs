/* Reproducible compact map and 0079 cooperative mission expansion. */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const M = require("../shared/map-document"),
  B = require("./rebuild-biome-maps.cjs");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const catalog = read("assets/unit-catalog.json");
const base = read("assets/maps/battlefield/frontline.json");
const sourceUnits = catalog.units.map((ref) => read("assets/" + ref));
const unit = (id) => {
  const p = sourceUnits.find((p) => p.id === id);
  if (!p) throw Error("Missing unit " + id);
  return p;
};
const write = (ref, map) => {
  fs.mkdirSync(path.dirname(path.join(root, "assets", ref)), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", ref), JSON.stringify(map, null, 2) + "\n");
  if (!catalog.maps.includes(ref)) catalog.maps.push(ref);
  console.log(map.id, map.name);
};
const hash = (x, y, seed) => (Math.imul(x + seed, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0;
function terrain(kind, x, y, w, h) {
  const X = Math.min(x, w - 1 - x),
    Y = Math.min(y, h - 1 - y),
    v = hash(X, Y, kind.length) % 100;
  if (kind === "belt")
    return (x - w * 0.5) ** 2 / 70 + (y - h * 0.25) ** 2 / 22 < 1 ||
      (x - w * 0.5) ** 2 / 70 + (y - h * 0.75) ** 2 / 22 < 1
      ? v < 27
        ? "rock"
        : "rubble"
      : "plain";
  if (kind === "wrecks")
    return Math.abs((x - w / 2) * 0.45 - (y - h / 2)) < 4 && Math.abs(y - h / 2) > 3
      ? v < 15
        ? "rock"
        : "rubble"
      : "plain";
  if (kind === "orbit")
    return Math.abs(Math.hypot((x - w / 2) * 0.7, y - h / 2) - h * 0.31) < 2
      ? v < 14
        ? "rock"
        : "rubble"
      : "plain";
  if (kind === "snow")
    return Math.sin(x * 0.31) + Math.cos(y * 0.29) > 1.15
      ? "rock"
      : v < 18 && Math.abs(y - h / 2) > 4
        ? "forest"
        : "snow";
  if (kind === "wetland" || kind === "jungle") {
    const river = Math.abs(x - w / 2 - 4 * Math.sin(y / 5)) < 2.2;
    if (
      river &&
      Math.abs(y - h / 2) > 2 &&
      Math.abs(y - h * 0.25) > 1 &&
      Math.abs(y - h * 0.75) > 1
    )
      return "water";
    return Math.sin(x * 0.2) * Math.cos(y * 0.3) > 0.12 ? "forest" : "plain";
  }
  if (kind === "desert")
    return Math.abs(y - h / 2) > 4 && Math.sin(x * 0.32) + Math.cos(y * 0.4) > 1.15
      ? "rock"
      : v < 13
        ? "rubble"
        : "desert";
  if (kind === "urban")
    return x % 10 > 3 && x % 10 < 8 && y % 9 > 2 && y % 9 < 7
      ? "rubble"
      : x % 10 === 0 || y % 9 === 0
        ? "plain"
        : "plain";
  return "plain";
}
function mapDoc(spec) {
  const {
    id,
    name,
    kind,
    environment = "ground",
    mode = "quick",
    w = 48,
    h = 34,
    players = 3,
  } = spec;
  const d = M.create({
    id,
    name,
    description: spec.description || "共享部署区，多个交战通道及侧翼掩护。",
    width: w,
    height: h,
    playersPerTeam: players,
    environment,
    supportedModes: [mode],
  });
  d.spawns = [];
  d.deploymentAreas = [];
  const areas = [
    { x: 2, y: Math.floor(h / 2) - 8, width: 12, height: 16 },
    { x: w - 14, y: Math.floor(h / 2) - 8, width: 12, height: 16 },
  ];
  for (let p = 0; p < players; p++)
    for (let team = 0; team < 2; team++) {
      const x = 5 + (p % 2) * 4,
        y = Math.floor(h / 2) - 5 + Math.floor(p / 2) * 4;
      d.spawns.push({ team, position: p + 1, x: team ? w - 1 - x : x, y: team ? h - 1 - y : y });
      d.deploymentAreas.push({ ...areas[team] });
    }
  const inside = (x, y, a) => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height;
  for (const t of d.tiles) t.environment = environment;
  d.layers[0].data = Array.from({ length: w * h }, (_, i) => {
    const x = i % w,
      y = Math.floor(i / w);
    const clear = areas.some((a) => inside(x, y, a)) || Math.abs(y - h / 2) < 2;
    return "terrain_" + (clear ? "plain" : terrain(kind, x, y, w, h));
  });
  d.lighting = structuredClone(base.lighting);
  d.surfaceCover = environment !== "space";
  d.climate =
    environment === "space"
      ? {
          weather: { allowed: ["clear"], weights: { clear: 1 }, durationRounds: 5, fixed: true },
          time: { allowed: ["noon"], durationRounds: 5, fixed: true },
        }
      : structuredClone(base.climate);
  if (environment !== "space") {
    const weights =
      kind === "snow"
        ? { snow: 6, overcast: 3, clear: 4, blizzard: 1 }
        : ["wetland", "jungle"].includes(kind)
          ? { rain: 4, overcast: 3, clear: 5, fog: 2 }
          : kind === "desert"
            ? { clear: 8, sand: 3, overcast: 1 }
            : { clear: 6, overcast: 3, rain: 2 };
    d.climate.weather = { allowed: Object.keys(weights), weights, durationRounds: 5, fixed: false };
  }
  return d;
}
function previewColors(environment, kind) {
  if (environment === "space") return {plain:"#10152b",rock:"#47445e",rubble:"#60647f",forest:"#234b38",water:"#182147",highland:"#77708e"};
  return {plain:kind==="snow"?"#b5c8d0":kind==="desert"?"#b19a70":kind==="urban"?"#596b68":"#668365",forest:"#395a42",water:"#346c99",rock:"#737b80",rubble:"#7c807b",highland:"#9b9d77",snow:"#d7e5ee",desert:"#c5a86d"};
}
function buildMap(spec) {
  const d = mapDoc(spec),
    map = M.compile(d);
  map.appearance = {
    biome:
      spec.environment === "space"
        ? "space"
        : {
            snow: "arctic",
            desert: "desert",
            urban: "urban",
            jungle: "wetland",
            wetland: "wetland",
          }[spec.kind] || "forest",
    colors: previewColors(spec.environment,spec.kind),
  };
  if (spec.mode === "battlefield") {
    const w = d.width,
      h = d.height,
      facilities = [];
    const positions = [
      ["base", 5, Math.floor(h / 2) - 1],
      ["machineGun", 14, Math.floor(h / 2) - 5],
      ["beam", 14, Math.floor(h / 2) + 5],
      ["missile", 5, Math.floor(h / 2) - 7],
      ["cannon", 5, Math.floor(h / 2) + 7],
      ["radar", 3, Math.floor(h / 2) + 3],
    ];
    for (let team = 0; team < 2; team++)
      for (const [type, x, y] of positions) {
        const size = type === "base" ? 3 : 1;
        facilities.push({
          id: team + "-" + type,
          type,
          team,
          x: team ? w - x - size : x,
          y: team ? h - y - size : y,
        });
      }
    const points = [
      [0.35, 0.25],
      [0.35, 0.75],
      [0.65, 0.25],
      [0.65, 0.75],
    ].map(([x, y], i) => ({
      id: "point-" + i,
      name: "据点 " + (i + 1),
      x: Math.floor(w * x),
      y: Math.floor(h * y),
    }));
    map.battlefield = { ...structuredClone(base.battlefield), facilities, points };
    // Installation pads and a short connection to the central routes remain open.
    for (const p of [...facilities, ...points])
      for (let y = p.y - 2; y < p.y + 5; y++)
        for (let x = p.x - 2; x < p.x + 5; x++) if (map.tiles[y]?.[x]) map.tiles[y][x] = "plain";
  }
  const result = B.rebuild(map);
  M.validate(result.tileMap);
  write(
    "maps/" + (spec.mode === "battlefield" ? "battlefield" : "encounter") + "/" + spec.id + ".json",
    result,
  );
  return result;
}
const maps = [
  {
    id: "battlefield_asteroid_corridor",
    name: "雇佣兵战争 · 小行星回廊",
    kind: "belt",
    environment: "space",
  },
  {
    id: "battlefield_ship_graveyard",
    name: "雇佣兵战争 · 沉舰宙域",
    kind: "wrecks",
    environment: "space",
  },
  {
    id: "battlefield_lunar_orbit",
    name: "雇佣兵战争 · 月面轨道",
    kind: "orbit",
    environment: "space",
  },
  { id: "battlefield_mangrove_delta", name: "雇佣兵战争 · 红树林三角洲", kind: "wetland" },
  { id: "battlefield_frozen_basin", name: "雇佣兵战争 · 冰封盆地", kind: "snow" },
].map((s) => ({ ...s, w: 64, h: 44, players: 6, mode: "battlefield" }));
maps.forEach(buildMap);
[
  { id: "jungle_delta_3v3", name: "雨林河口 · 3v3", kind: "jungle" },
  { id: "glacier_gates_3v3", name: "冰川隘口 · 3v3", kind: "snow" },
  { id: "desert_relay_3v3", name: "沙海中继站 · 3v3", kind: "desert" },
  { id: "urban_floodplain_3v3", name: "废都河滩 · 3v3", kind: "urban" },
  { id: "orbital_arc_3v3", name: "轨道残环 · 3v3", kind: "orbit", environment: "space" },
].forEach(buildMap);

// Mission content is maintained by build-white-base-mission.cjs.
