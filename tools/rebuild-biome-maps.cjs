/* Rebuild shared-deployment maps from independent biome atlas configurations.
 * Map gameplay coordinates/facilities remain authoritative; visual edge layers are derived. */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  M = require("../shared/map-document");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const hash = (x, y) => (Math.imul(x + 17, 73856093) ^ Math.imul(y + 11, 19349663)) >>> 0;
const directions = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
function biomeFor(map) {
  if (map.environment === "space") return "space";
  if (/twin_ridges|dunes/.test(map.id)) return "desert";
  if (/ruined_basin|colony_interior|mass_driver|military_base|crossroads/.test(map.id))
    return "urban";
  if (/coastal|rainforest/.test(map.id)) return "tropical";
  return { arctic: "snow", desert: "desert", urban: "urban" }[map.appearance?.biome] || "temperate";
}
function rebuild(input) {
  const map = structuredClone(input),
    d = map.tileMap,
    biome = biomeFor(map),
    b = read(path.join(root, "assets/maps/biomes", biome, "biome.json"));
  const w = map.width,
    h = map.height,
    oldDefs = new Map(d.tiles.map((t) => [t.id, t])),
    oldGround = d.layers.filter((l) => l.type === "tile" && !l.decorative);
  const elevation = Array(w * h).fill(0);
  for (const l of oldGround)
    l.data.forEach((id, i) => {
      if (d.biomeStyle?.version === 2) elevation[i] = oldDefs.get(id)?.elevation || 0;
      else
        elevation[i] = /^upper/.test(id)
          ? 2
          : /^(highland|cliff|ramp)_/.test(id)
            ? 1
            : map.tiles[Math.floor(i / w)][i % w] === "highland"
              ? 1
              : 0;
    });
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : map.tiles[y][x]);
  const protectedCell = (x, y) =>
    map.spawns.some((s) => Math.abs(x - s.x) < 5 && Math.abs(y - s.y) < 4) ||
    (map.battlefield?.facilities || []).some((s) => Math.abs(x - s.x) < 4 && Math.abs(y - s.y) < 4);
  // Cluster the old one-cell scatter into terrain regions. Do not erode gameplay cliffs or deployment cores.
  if (d.biomeStyle?.version !== 2 && !map.battlefield) {
    const old = map.tiles.map((r) => r.slice());
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        if (protectedCell(x, y) || ["water", "rock", "highland"].includes(old[y][x])) continue;
        const nearby = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) nearby.push(old[y + dy][x + dx]);
        const wooded = nearby.filter((t) => t === "forest").length,
          ruined = nearby.filter((t) => t === "rubble").length;
        if (wooded >= 4) map.tiles[y][x] = "forest";
        else if (ruined >= 4) map.tiles[y][x] = "rubble";
      }
  }
  if (!d.biomeStyle?.terrainRevision && map.id === "serpentine_rainforest_3v3") {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (protectedCell(x, y)) continue;
        const center = (w - 1) / 2 + 3 * Math.sin((y - (h - 1) / 2) / 5),
          river = Math.abs(x - center) < 1.7;
        const bridge =
          Math.abs(y - Math.round(h * 0.33)) < 2 || Math.abs(y - Math.round(h * 0.67)) < 2;
        if (river) map.tiles[y][x] = bridge ? "plain" : "water";
        else if (at(x, y) === "water") map.tiles[y][x] = "plain";
      }
  }
  if (!d.biomeStyle?.terrainRevision && map.id === "coastal_supply_2v2") {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const shore = 5 + Math.round(2.3 * Math.sin(x / 6) + 1.4 * Math.cos(x / 3));
        if (y < shore) map.tiles[y][x] = "water";
        else if (at(x, y) === "water") map.tiles[y][x] = "plain";
      }
  }
  const roads = new Set(),
    walk = (x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < w - 1 &&
      y < h - 1 &&
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].every(([dx, dy]) => !["rock", "water"].includes(at(x + dx, y + dy)));
  // Two-cell roads follow navigable terrain, avoiding cliffs/water instead of cutting a straight corridor through them.
  const anchors = map.battlefield
    ? [...map.battlefield.facilities.filter((f) => f.type === "base"), ...map.battlefield.points]
    : [map.spawns[0], map.spawns[1]];
  for (let k = 1; k < anchors.length; k++) {
    const start = anchors[k - 1],
      end = anchors[k],
      q = [[start.x, start.y]],
      prev = new Map([[start.y * w + start.x, null]]);
    let found = null;
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      if (Math.abs(x - end.x) + Math.abs(y - end.y) <= 1) {
        found = y * w + x;
        break;
      }
      for (const [dx, dy] of directions) {
        const nx = x + dx,
          ny = y + dy,
          n = ny * w + nx;
        if (walk(nx, ny) && !prev.has(n)) {
          prev.set(n, y * w + x);
          q.push([nx, ny]);
        }
      }
    }
    while (found !== null && found !== undefined) {
      const x = found % w,
        y = Math.floor(found / w);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        roads.add((y + dy) * w + x + dx);
        if (["forest", "rubble"].includes(at(x + dx, y + dy))) map.tiles[y + dy][x + dx] = "plain";
      }
      found = prev.get(found);
    }
  }
  const defs = new Map(),
    layers = ["ground", "shore", "cliff", "roads", "details"].map((name, i) => ({
      id: "terrain_" + name,
      name: ["地表", "岸线与浅滩", "高差与崖壁", "道路与坡口", "植被与遗迹"][i],
      type: "tile",
      placement: "below",
      decorative: i !== 0,
      dynamic: false,
      visible: true,
      opacity: 1,
      data: Array(w * h).fill(null),
    }));
  function def(role, terrain, variant = 0, extra = {}) {
    const frames = (role === "road" ? b.frames.roadSurface : b.frames[role]) || b.frames.plain,
      f = frames[variant % frames.length];
    const id = [
      role,
      terrain,
      variant,
      extra.mask || 0,
      extra.elevation || 0,
      extra.environment || map.environment,
    ].join("_");
    if (!defs.has(id))
      defs.set(id, {
        id,
        name: role,
        terrain,
        environment: extra.environment || map.environment,
        color: M.terrains[terrain].color,
        tilesetId: "biome_" + biome,
        x: f.x,
        y: f.y,
        frameWidth: f.width,
        frameHeight: f.height,
        biomeRole: role,
        underlay: ["forest", "rock", "rubble", "details"].includes(role)
          ? b.frames.plain[0]
          : undefined,
        decorative: extra.biomeRole === "shore" || ["road", "details", "cliff"].includes(role),
        dynamic: false,
        ...extra,
      });
    return id;
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        t = at(x, y),
        env = map.cellEnvironments?.[y]?.[x] || map.environment,
        space = env === "space",
        v = hash(x, y),
        e = elevation[i];
      const role =
        t === "water"
          ? "water"
          : space && t === "plain"
            ? "plain"
            : env === "ground" && biome === "space"
              ? "concrete"
              : ["forest", "rock", "rubble"].includes(t)
                ? t
                : "plain";
      layers[0].data[i] = def(
        role,
        t,
        ["forest", "rock", "rubble"].includes(role)
          ? hash(Math.floor(x / 8), Math.floor(y / 8)) % (b.frames[role]?.length || 1)
          : 0,
        { elevation: e, environment: env },
      );
      if (t === "water") {
        let mask = 0;
        directions.forEach(([dx, dy], k) => {
          const n = at(x + dx, y + dy);
          if (n && n !== "water") mask |= 1 << k;
        });
        if (mask)
          layers[1].data[i] = def("soil", "water", 0, {
            mask,
            biomeRole: "shore",
            environment: env,
          });
      }
      if (e) {
        let mask = 0;
        directions.forEach(([dx, dy], k) => {
          const n = (y + dy) * w + x + dx;
          if (at(x + dx, y + dy) && elevation[n] < e) mask |= 1 << k;
        });
        if (mask && !/ramp/.test(oldGround[0]?.data[i] || ""))
          layers[2].data[i] = def("cliff", t, 0, { mask, elevation: e, environment: env });
      }
      if (roads.has(i) && !space) {
        let mask = 0;
        directions.forEach(([dx, dy], k) => {
          if (roads.has((y + dy) * w + x + dx)) mask |= 1 << k;
        });
        layers[3].data[i] = def("road", t, 0, { mask, environment: env });
      }
      if (!space && !roads.has(i) && t === "plain" && v % 29 === 0 && !protectedCell(x, y))
        layers[4].data[i] = def("details", t, v % 4, { environment: env });
    }
  d.tilesets = [
    {
      id: "biome_" + biome,
      name: biome,
      image: b.asset,
      width: b.width,
      height: b.height,
      tileWidth: 32,
      tileHeight: 32,
      margin: 0,
      spacing: 0,
    },
  ];
  d.tiles = [...defs.values()];
  d.layers = layers;
  d.biomeStyle = {
    version: 2,
    terrainRevision: 1,
    biome,
    seed: d.biomeStyle?.seed || 0,
    autotile: b.autotile,
  };
  M.validate(d);
  Object.assign(map, M.terrainData(d));
  return map;
}
if (require.main === module) {
  const c = read(path.join(root, "assets/unit-catalog.json"));
  for (const ref of c.maps.filter((p) => /^maps\/(encounter|battlefield)\//.test(p))) {
    const file = path.join(root, "assets", ref),
      map = rebuild(read(file));
    fs.writeFileSync(file, JSON.stringify(map, null, 2) + "\n");
    console.log(map.id, map.tileMap.biomeStyle.biome, map.tileMap.tiles.length);
  }
}
module.exports = { rebuild, biomeFor };
