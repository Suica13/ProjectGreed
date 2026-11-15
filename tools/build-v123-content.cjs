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
  { id: "jungle_delta_3v3", name: "雨林河口", kind: "jungle" },
  { id: "glacier_gates_3v3", name: "冰川隘口", kind: "snow" },
  { id: "desert_relay_3v3", name: "沙海中继站", kind: "desert" },
  { id: "urban_floodplain_3v3", name: "废都河滩", kind: "urban" },
  { id: "orbital_arc_3v3", name: "轨道残环", kind: "orbit", environment: "space" },
].forEach(buildMap);

// These are playable adaptations; dialogue is newly written rather than copied.
const pilots = {
  bright: "Pilot_EFSF_0079_N_ACE_BRT",
  amuro: "Pilot_EFSF_0079_N_ACE_AMR",
  char: "Pilot_ZEON_0079_N_ACE_CHA",
};
function actor(
  id,
  unitId,
  team,
  x,
  y,
  { initial = true, pilot = null, squad = null, group = "main" } = {},
) {
  return {
    id,
    unitId,
    kitId: unit(unitId).weaponKits[0].id,
    team,
    x,
    y,
    initial,
    group,
    angle: team ? 270 : 90,
    ...(pilot ? { pilotId: pilots[pilot], level: 3 } : {}),
    ...(squad ? { squad } : {}),
  };
}
function dialogue(a, name, text, pilot) {
  return {
    type: "dialogue",
    lines: [
      {
        actor: a,
        name,
        text,
        ...(pilot ? { portrait: "assets/pilots/" + pilots[pilot] + ".png" } : {}),
      },
    ],
  };
}
const specs = [
  {
    id: "efsf_side7",
    faction: "EFSF",
    name: "Side 7的警报",
    era: "UC_0079_T1",
    kind: "urban",
    env: "ground",
    friend: "WhiteBase",
    enemy: "MS_06F",
    count: 6,
    hero: "RX_78_2",
    pilot: "amuro",
    speaker: "布莱德",
    opening: "殖民地内还有平民。PMC部队，掩护避难路线，阻止敌机逼近白色基地。",
    victory: "all_enemies",
  },
  {
    id: "efsf_reentry",
    faction: "EFSF",
    name: "大气层突入掩护",
    era: "UC_0079_T1",
    kind: "wrecks",
    env: "space",
    friend: "WhiteBase",
    enemy: "MS_06F",
    count: 9,
    hero: "RX_78_2",
    pilot: "amuro",
    speaker: "布莱德",
    opening: "我们必须守住突入航线。坚持到白色基地完成下降准备。",
    victory: "survive",
    round: 8,
  },
  {
    id: "efsf_garma",
    faction: "EFSF",
    name: "加尔玛追击网",
    era: "UC_0079_T1",
    kind: "urban",
    env: "ground",
    friend: "WhiteBase",
    enemy: "MS_06J",
    count: 9,
    hero: "RX_77_2",
    speaker: "布莱德",
    opening: "敌军正在封锁城市出口。从侧翼突破包围，保证舰体安全。",
    victory: "defeat_actor",
    boss: "GawClass",
  },
  {
    id: "efsf_ral",
    faction: "EFSF",
    name: "青色巨星来袭",
    era: "UC_0079_T1",
    kind: "desert",
    env: "ground",
    friend: "WhiteBase",
    enemy: "MS_06J",
    count: 6,
    hero: "RX_78_2",
    pilot: "amuro",
    speaker: "布莱德",
    opening: "沙尘中出现敌方突击队。守住舰旁通道，不要被分割包围。",
    victory: "defeat_actor",
    boss: "MS_07B",
  },
  {
    id: "efsf_jaburo",
    faction: "EFSF",
    name: "贾布罗防卫线",
    era: "UC_0079_T2",
    kind: "jungle",
    env: "ground",
    friend: "MedeaKai",
    enemy: "MSM_04",
    count: 9,
    hero: "RGM_79",
    speaker: "联邦守备队",
    opening: "敌军已潜入密林。保护运输队，歼灭突破外围防线的敌人。",
    victory: "all_enemies",
  },
  {
    id: "zeon_side7",
    faction: "ZEON",
    name: "Side 7侦察行动",
    era: "UC_0079_T1",
    kind: "urban",
    env: "ground",
    friend: "MS_06S",
    enemy: "Type61",
    count: 12,
    hero: "MS_06F",
    speaker: "吉翁侦察队",
    opening: "联邦的新型兵器就在附近。压制守备部队，掩护侦察队撤出。",
    victory: "survive",
    round: 7,
  },
  {
    id: "zeon_reentry",
    faction: "ZEON",
    name: "突入轨道的追击",
    era: "UC_0079_T1",
    kind: "belt",
    env: "space",
    friend: "MusaiClass",
    enemy: "FF_S3",
    count: 12,
    hero: "MS_06S",
    pilot: "char",
    speaker: "夏亚",
    opening: "敌舰正在接近大气层。击破护航部队，为追击队打开航路。",
    victory: "all_enemies",
  },
  {
    id: "zeon_garma",
    faction: "ZEON",
    name: "加尔玛部队的退路",
    era: "UC_0079_T1",
    kind: "urban",
    env: "ground",
    friend: "GawClass",
    enemy: "Type61",
    count: 12,
    hero: "MS_06J",
    speaker: "吉翁航空队",
    opening: "大型攻击机正在转向。PMC部队，挡住从废墟间逼近的敌军。",
    victory: "survive",
    round: 8,
  },
  {
    id: "zeon_ral",
    faction: "ZEON",
    name: "沙漠中的突击队",
    era: "UC_0079_T1",
    kind: "desert",
    env: "ground",
    friend: "MS_07B",
    enemy: "Type61",
    count: 9,
    hero: "MS_06J",
    speaker: "吉翁突击队",
    opening: "前方是联邦军的补给集结地。突击队负责牵制，PMC从侧面击破运输目标。",
    victory: "defeat_actor",
    boss: "Medea",
  },
  {
    id: "zeon_jaburo",
    faction: "ZEON",
    name: "贾布罗渗透作战",
    era: "UC_0079_T2",
    kind: "jungle",
    env: "ground",
    friend: "MSM_07S",
    enemy: "RGM_79",
    count: 9,
    hero: "MSM_04",
    speaker: "吉翁潜入队",
    opening: "沿水道进入守备区。击破警戒部队，掩护后续小队进入。",
    victory: "all_enemies",
  },
  {
    id: "zeon_solomon",
    faction: "ZEON",
    name: "所罗门撤离掩护",
    era: "UC_0079_T2",
    kind: "wrecks",
    env: "space",
    friend: "PapuaClass",
    enemy: "RGM_79",
    count: 12,
    hero: "MS_09R",
    speaker: "吉翁守备队",
    opening: "伤员运输舰尚未离开宙域。守住通道，为撤离争取时间。",
    victory: "survive",
    round: 10,
  },
];
for (const s of specs) {
  const d = mapDoc({
    id: "mission_" + s.id,
    name: "[0079][" + s.faction + "]" + s.name,
    kind: s.kind,
    environment: s.env,
    mode: "mission",
    w: 46,
    h: 32,
    players: 5,
  });
  const friend = actor("anchor", s.friend, 0, 10, 14),
    hero = actor("reinforcement", s.hero, 0, 3, 13, { initial: false, pilot: s.pilot });
  if (s.faction === "EFSF" && s.friend === "WhiteBase") {
    friend.pilotId = pilots.bright;
    friend.level = 0;
  }
  const enemies = Array.from({ length: s.count }, (_, i) =>
    actor("enemy-" + i, s.enemy, 1, 29 + Math.floor(i / 6) * 4, 7 + Math.floor((i % 6) / 3) * 15, {
      squad: "enemy-squad-" + Math.floor(i / 3),
      group: "enemy",
    }),
  );
  const actors = [friend, ...enemies, hero];
  if (s.boss) actors.push(actor("target", s.boss, 1, 39, 14, { group: "target" }));
  const extra = Array.from({ length: 3 }, (_, i) =>
    actor("reserve-" + i, s.enemy, 1, 40, 23, {
      initial: false,
      squad: "reserve",
      group: "reserve",
    }),
  );
  actors.push(...extra);
  const reinforcementDialogue = dialogue(
    "reinforcement",
    s.pilot === "char"
      ? "夏亚"
      : s.pilot === "amuro"
        ? "阿姆罗"
        : s.faction === "EFSF"
          ? "联邦支援队"
          : "吉翁支援队",
    "支援部队到达。我们会掩护侧翼，继续执行任务。",
    s.pilot,
  );
  d.mission = {
    version: 1,
    era: s.era,
    technologyLimit: 0,
    technologyLimitEnabled: false,
    costLimit: 2000,
    unitLimit: 12,
    enemyResourcePerPlayer: 0.25,
    scenarioFaction: s.faction,
    victory:
      s.victory === "survive"
        ? { type: "survive", round: s.round }
        : s.victory === "defeat_actor"
          ? { type: "defeat_actor", actor: "target" }
          : { type: "all_enemies" },
    protect: ["anchor"],
    actors,
    events: [
      {
        id: "opening",
        name: "任务开始",
        when: { type: "start" },
        actions: [
          dialogue(
            "anchor",
            s.speaker,
            s.opening,
            s.faction === "EFSF" && s.friend === "WhiteBase" ? "bright" : null,
          ),
        ],
      },
      {
        id: "support",
        name: "友军抵达",
        when: { type: "round", round: 3 },
        actions: [{ type: "spawn", actors: ["reinforcement"] }, reinforcementDialogue],
      },
      {
        id: "counterattack",
        name: "敌军预备队",
        when: { type: "defeated_group", group: "enemy", count: 3, byRound: 100 },
        actions: [
          { type: "spawn", actors: extra.map((a) => a.id) },
          { type: "message", text: "敌军预备队从侧翼进入战场。" },
        ],
      },
    ],
  };
  // Keep authored actor landing cells clear; squads intentionally share a cell.
  for (const a of actors)
    for (let y = a.y - 2; y <= a.y + 2; y++)
      for (let x = a.x - 2; x <= a.x + 2; x++)
        if (x >= 0 && y >= 0 && x < d.width && y < d.height)
          d.layers[0].data[y * d.width + x] = "terrain_plain";
  if (["efsf_side7", "efsf_ral", "zeon_reentry", "zeon_solomon"].includes(s.id))
    d.mission.events
      .find((e) => e.id === "support")
      .actions.splice(1, 0, {
        type: "scripted_attack",
        actor: "reinforcement",
        actors: ["enemy-0", "enemy-1"],
      });
  const map = M.compile(d);
  map.appearance = {
    biome:
      s.env === "space"
        ? "space"
        : { jungle: "wetland", urban: "urban", desert: "desert" }[s.kind] || "forest",
    colors: previewColors(s.env,s.kind),
  };
  const result = B.rebuild(map);
  result.mission = d.mission;
  result.tileMap.mission = d.mission;
  write("maps/missions/" + s.id + ".json", result);
}
const white = read("assets/maps/missions/white_base.json");
white.name = "[0079][EFSF]孔斯空域的遭遇";
white.tileMap.name = white.name;
white.mission.scenarioFaction = "EFSF";
white.tileMap.mission = structuredClone(white.mission);
write("maps/missions/white_base.json", white);
fs.writeFileSync(
  path.join(root, "assets/unit-catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
