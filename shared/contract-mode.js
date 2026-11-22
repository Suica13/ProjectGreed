/* One cooperative battlefield, with authoritative objectives and shared extraction. */
"use strict";
const ContractMode = (() => {
  const contacts = typeof ContactTasks !== "undefined" ? ContactTasks : require("./contact-tasks.js");
  const technologyTree = typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const weaponClasses = typeof WeaponClasses !== "undefined" ? WeaponClasses : require("./weapon-classes.js");
  const covers = {
    ground: "assets/maps/covers/contract-ground.svg",
    space: "assets/maps/covers/contract-space.svg",
  };
  const costs = [2000, 4000, 6000, 8000, 10000, 12500];
  // Full ordinary-objective completion at baseline era and normal settlement rates.
  const completionRewards = [
    [2000, 3000], [3000, 4500], [4500, 6000],
    [6000, 8000], [8000, 10500], [10000, 13500],
  ];
  const biomes = [
    { id: "temperate", name: "草原", mapId: "great_plains_5v5" },
    { id: "snow", name: "雪地", mapId: "glacier_gates_3v3" },
    { id: "desert", name: "沙漠", mapId: "open_dunes_1v1" },
    { id: "urban", name: "城市", mapId: "crossroads_2v2" },
  ];
  const difficulties = costs.map((costLimit, index) => ({
    id: index + 1,
    name: "N" + (index + 1),
    costLimit,
    fleetLimit: 2 + Math.floor(index / 3),
    patrolLimit: 24 + index * 3,
    events: index + 1,
    width: 60 + Math.floor(index * 8.5),
    height: 38 + Math.floor(index * 10.75),
  }));
  const kinds = [
    {
      type: "salvage",
      name: "回收战场资料",
      hint: "进入白色3×3范围，选择单位并点击行动栏的回收。",
    },
    { type: "command", name: "消灭小股敌人势力", hint: "消灭所有标记为目标的敌人。" },
    {
      type: "factory",
      name: "破坏敌方工厂",
      hint: "击毁所有工厂；攻击会引来支援，每座工厂被毁都会引来边缘巡逻队。",
    },
    {
      type: "capture",
      name: "占领敌方据点",
      hint: "进入红色5×5范围启动占领，保持控制五回合；敌军进入时暂停推进。",
    },
    {
      type: "defend", name: "防守友军据点",
      hint: "PMC靠近至五格内启动，保护据点核心五回合。友军自动防守，敌军分批来袭；核心被毁则事件失败。",
    },
    {
      type: "rescue", name: "救援失联小队",
      hint: "PMC靠近至五格内启动，掩护友军三回合，至少一台存活即可救援。友军全灭则事件失败。",
    },
    {
      type: "upload", name: "上传战场数据",
      hint: "进入蓝色3×3范围启动上传，保持区域内有PMC且无敌军三回合；离开或受敌军干扰时暂停。",
    },
    {
      type: "radar", name: "摧毁敌方雷达站",
      hint: "击毁雷达设施。靠近或攻击后会引来一批守卫增援。",
    },
  ];
  // Server-only patrol routes, awareness and damage history never enter snapshots.
  const brains = new WeakMap();
  const pools = new WeakMap();
  const technologyStages = new WeakMap();
  const mapId = (environment, difficulty = 1) =>
    "contract_" +
    (environment === "space" ? "space" : "ground") +
    (Number(difficulty) > 1 ? "_n" + config(difficulty).id : "");
  const extractionZones = state => state?.extractions?.length ? state.extractions : state?.extraction ? [state.extraction] : [];
  const deploymentZones = state => state?.entries?.length ? state.entries : state?.entry ? [state.entry] : [];
  function random(seed) {
    let n = seed >>> 0;
    return () => {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n / 4294967296;
    };
  }
  function config(value = 1, era = "UC_0079_T1") {
    const result = difficulties.find((d) => d.id === Number(value));
    if (!result) throw Error("合约难度无效");
    const stage = ["UC_0079_T1", "UC_0079_T2", "UC_0087_T1", "UC_0087_T2", "UC_0093_T1"].indexOf(era);
    // T2 starts at 3000 instead of 2500; subsequent eras keep the 1.25 progression.
    // Round only the final budget, so rounding does not compound between eras.
    const scale = stage > 0 ? 1.5 * 1.25 ** (stage - 1) : 1;
    return { ...result, costLimit: Math.round(result.costLimit * scale / 500) * 500 };
  }
  function roomSettings(settings) {
    const d = config(settings.sweepDifficulty, settings.sweepEra);
    return { costLimit: d.costLimit, mapId: mapId(settings.sweepEnvironment, d.id), fogMode: "full", pilotPolicy: "allow" };
  }
  function edgeArea(w, h, side, rng, width, height) {
    const offset = (maximum) => 3 + Math.floor(rng() * Math.max(1, maximum - 5));
    return side === 0
      ? { x: 0, y: offset(h - height), width, height }
      : side === 1
        ? { x: w - width, y: offset(h - height), width, height }
        : side === 2
          ? { x: offset(w - width), y: 0, width, height }
          : { x: offset(w - width), y: h - height, width, height };
  }
  function registerMaps(catalog) {
    for (const environment of ["ground", "space"])
      for (const d of difficulties) {
        const id = mapId(environment, d.id);
        if (catalog.maps[id]) continue;
        const source =
          catalog.maps[environment === "space" ? "outer_orbit_5v5" : "great_plains_5v5"];
        if (!source) continue;
        const map = structuredClone(source),
          entry = {
            x: 0,
            y: Math.floor((d.height - (12 + d.fleetLimit - 1)) / 2),
            width: 16 + (d.fleetLimit - 1) * 2,
            height: 12 + d.fleetLimit - 1,
          };
        Object.assign(map, {
          id,
          width: d.width,
          height: d.height,
          name: (environment === "space" ? "合约作战·宇宙" : "合约作战·地面") + " · " + d.name,
          description: "每局随机战场，从边缘入场并逐单位撤离。",
          cover: covers[environment],
          playersPerTeam: 5,
          supportedModes: ["sweep"],
          tiles: Array.from({ length: d.height }, () => Array(d.width).fill("plain")),
          spawns: [],
          deploymentAreas: [],
        });
        for (const key of [
          "localization",
          "battlefield",
          "mission",
          "cellEnvironments",
          "decorations",
          "objects",
          "tileMap",
        ])
          delete map[key];
        for (let i = 0; i < map.playersPerTeam; i++) {
          map.spawns.push(
            { team: 0, position: i + 1, x: entry.x + 4 + (i % 3) * 3, y: entry.y + 4 + Math.floor(i / 3) * 3 },
            {
              team: 1,
              position: i + 1,
              x: Math.floor(d.width / 2) + i,
              y: Math.floor(d.height / 2),
            },
          );
          map.deploymentAreas.push(
            { ...entry },
            {
              x: Math.floor(d.width / 2) - 6,
              y: Math.floor(d.height / 2) - 5,
              width: 14,
              height: 12,
            },
          );
        }
        catalog.maps[id] = map;
      }
    delete catalog.maps.battlefield_sweep;
  }
  function generateMap(catalog, settings, seed) {
    const d = config(settings.sweepDifficulty),
      map = structuredClone(catalog.maps[mapId(settings.sweepEnvironment, d.id)]),
      rng = random(seed ^ 0xa53c9e17),
      w = map.width,
      h = map.height,
      space = settings.sweepEnvironment === "space",
      biome = space ? "space" : biomes[Math.floor(random(seed ^ 0x71b10)() * biomes.length)].id,
      side = Math.floor(rng() * 4),
      entry = edgeArea(w, h, side, rng, 8 + d.fleetLimit * 2, 8 + d.fleetLimit),
      extraction = edgeArea(w, h, (side + 2) % 4, rng, 6, 6),
      center = (r) => ({ x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y + r.height / 2) }),
      locations = [];
    const baseTerrain = ["snow", "desert"].includes(biome) ? biome : "plain";
    map.tiles = Array.from({length: h}, () => Array(w).fill(baseTerrain));
    const axis = side < 2 ? "y" : "x", length = side < 2 ? entry.height : entry.width;
    const edgeLength = side < 2 ? h : w, middle = Math.floor(edgeLength / 2);
    entry[axis] = 3 + Math.floor(rng() * Math.max(1, middle - length - 3));
    const entries = [entry, {...entry, [axis]: middle + 1 + Math.floor(rng() * Math.max(1, edgeLength - middle - length - 3))}];
    const candidates = [];
    for (const exitSide of [(side + 1) % 4, (side + 3) % 4])
      for (let offset = 3; offset <= (exitSide < 2 ? h : w) - 9; offset++) {
        const area = { x: exitSide < 2 ? (exitSide === 0 ? 0 : w - 6) : offset,
          y: exitSide < 2 ? offset : (exitSide === 2 ? 0 : h - 6), width: 6, height: 6 };
        if ([...entries, extraction].every(other => area.x + area.width + 2 <= other.x ||
          other.x + other.width + 2 <= area.x || area.y + area.height + 2 <= other.y ||
          other.y + other.height + 2 <= area.y)) candidates.push(area);
      }
    if (!candidates.length) throw Error("无法生成合约撤离区域");
    const extractions = [extraction, candidates[Math.floor(rng() * candidates.length)]];
    const clear = (point, radius) => {
      for (let y = Math.max(0, point.y - radius); y <= Math.min(h - 1, point.y + radius); y++)
        for (let x = Math.max(0, point.x - radius); x <= Math.min(w - 1, point.x + radius); x++)
          map.tiles[y][x] = "plain";
    };
    // Coherent patches leave open ground/space between forests, ruins, lakes or asteroid fields.
    for (let i = 0; i < Math.floor((w * h) / (space ? 110 : 70)); i++) {
      const cx = Math.floor(rng() * w),
        cy = Math.floor(rng() * h),
        rx = 2 + Math.floor(rng() * 5),
        ry = 2 + Math.floor(rng() * 4),
        roll = rng(),
        kind = space
          ? roll < 0.75
            ? "rubble"
            : "rock"
          : biome === "urban"
            ? roll < 0.7 ? "rubble" : roll < 0.88 ? "rock" : "water"
          : biome === "desert"
            ? roll < 0.65 ? "desert" : roll < 0.9 ? "rock" : "highland"
          : roll < 0.55
            ? "forest"
            : roll < 0.72
              ? "rubble"
              : roll < 0.85
                ? "water"
                : roll < 0.94
                  ? "rock"
                  : "highland";
      for (let y = Math.max(0, cy - ry); y <= Math.min(h - 1, cy + ry); y++)
        for (let x = Math.max(0, cx - rx); x <= Math.min(w - 1, cx + rx); x++)
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.65 + rng() * 0.35)
            map.tiles[y][x] = kind;
    }
    if (biome === "urban")
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        // Three-cell streets separate damaged city blocks, with room for carriers.
        if (x % 12 < 3 || y % 12 < 3) map.tiles[y][x] = "plain";
        else if (x % 12 >= 5 && x % 12 <= 9 && y % 12 >= 5 && y % 12 <= 9)
          map.tiles[y][x] = "rubble";
      }
    for (let attempt = 0; locations.length < d.events && attempt < 2000; attempt++) {
      const point = { x: 10 + Math.floor(rng() * (w - 20)), y: 9 + Math.floor(rng() * (h - 18)) };
      if (
        [...entries, ...extractions].every(
          (r) =>
            !inside(point, { x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 }),
        ) &&
        [...entries.map(center), ...extractions.map(center), ...locations].every(
          (p) => distance(point, p) > Math.min(w, h) * 0.19,
        )
      )
        locations.push(point);
    }
    if (locations.length !== d.events) throw Error("无法生成合约事件布局");
    // Broad corridors keep objectives and extraction reachable by large ship footprints.
    const path = (a, b) => {
      let x = a.x,
        y = a.y;
      const first = rng() < 0.5;
      while (x !== b.x || y !== b.y) {
        clear({ x, y }, 5);
        if ((first && x !== b.x) || y === b.y) x += Math.sign(b.x - x);
        else y += Math.sign(b.y - y);
      }
      clear(b, 6);
    };
    const start = center(entry);
    for (const point of [
      ...locations,
      center(entries[1]),
      ...extractions.map(center),
      { x: Math.floor(w / 2), y: Math.floor(h / 2) },
    ])
      path(start, point);
    for (const area of [...entries, ...extractions])
      for (let y = area.y; y < area.y + area.height; y++)
        for (let x = area.x; x < area.x + area.width; x++) map.tiles[y][x] = "plain";
    for (let i = 0; i < map.playersPerTeam; i++) {
      const area = entries[i % 2], index = Math.floor(i / 2);
      Object.assign(map.spawns[i * 2], { x: area.x + 3 + (index % 2) * 3, y: area.y + 3 + Math.floor(index / 2) * 3 });
      map.deploymentAreas[i * 2] = { ...area };
      map.deploymentAreas[i * 2 + 1] = { ...extraction };
      Object.assign(map.spawns[i * 2 + 1], { x: extraction.x + 1 + (i % 3), y: extraction.y + 2 + Math.floor(i / 3) });
    }
    map.contractLayout = { entry, entries, extraction, extractions, locations, biome };
    return map;
  }
  function visualMap(catalog, game) {
    const base = catalog.maps[game.mapId],
      biome = game.contractLayout?.biome || "temperate",
      source =
        catalog.maps[game.environment === "space" ? "outer_orbit_5v5" :
          (biomes.find(b => b.id === biome) || biomes[0]).mapId].tileMap;
    if (!source) return base;
    const atlas = structuredClone(source);
    if (game.environment !== "space" && !atlas.tiles.some(t=>t.terrain === "rubble" && !t.decorative && !t.elevation))
      atlas.tiles.push({...atlas.tiles[0],id:"contract-rubble",name:"废墟",terrain:"rubble",biomeRole:"rubble",decorative:false,elevation:0});
    if (biome === "urban") atlas.tiles.push({
      ...atlas.tiles[0],id:"contract-road",name:"街道",terrain:"plain",biomeRole:"road",
      decorative:true,dynamic:false,elevation:0,mask:15,
    });
    if (game.environment !== "space")
      for (const t of [
        { id: "contract-water", terrain: "water", biomeRole: "water", color: "#3c6377", x: 945, y: 5 },
        { id: "contract-shallow", terrain: "water", biomeRole: "shallow", color: "#537985", x: 1102, y: 5 },
        { id: "contract-rock", terrain: "rock", biomeRole: "rock", color: "#65716e", x: 632, y: 162 },
        { id: "contract-highland", terrain: "highland", biomeRole: "rock", color: "#65716e", x: 319, y: 475 },
      ])
        atlas.tiles.push({
          ...atlas.tiles[0],
          ...t,
          name: t.terrain,
          environment: game.environment,
          frameWidth: 147,
          frameHeight: 147,
          tilesetId: atlas.tilesets[0].id,
          decorative: false,
          dynamic: false,
          elevation: 0,
        });
    if (game.environment !== "space")
      for (let mask = 1; mask < 16; mask++)
        atlas.tiles.push({
          ...atlas.tiles[0],
          id: "contract-shore-" + mask,
          name: "岸线",
          terrain: "water",
          biomeRole: "shore",
          color: "#537985",
          decorative: true,
          dynamic: false,
          elevation: 0,
          mask,
        });
    const doc = atlas,
      w = game.tiles[0].length,
      h = game.tiles.length,
      definitions = doc.tiles.filter(
        (t) =>
          !t.decorative &&
          !t.elevation &&
          !["road", "shore", "cliff", "details"].includes(t.biomeRole) &&
          (t.terrain !== "plain" || ["plain", "soil"].includes(t.biomeRole)),
      ),
      fallback = definitions.find((t) => t.terrain === "plain"),
      byTerrain = new Map(),
      details = doc.tiles.filter((t) => t.decorative && t.biomeRole === "details");
    for (const t of definitions) {
      if (!byTerrain.has(t.terrain)) byTerrain.set(t.terrain, []);
      byTerrain.get(t.terrain).push(t);
    }
    const hash = (x, y) => (Math.imul(x + 17, 73856093) ^ Math.imul(y + 11, 19349663)) >>> 0;
    // A shore belongs to the water cell; the map edge itself is not land.
    const shoreMask = (x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]].reduce(
      (mask, [dx, dy], i) => {
        const neighbor = game.tiles[y + dy]?.[x + dx];
        return neighbor != null && neighbor !== "water" ? mask | (1 << i) : mask;
      }, 0,
    );
    doc.id = game.mapId;
    doc.width = w;
    doc.height = h;
    doc.playersPerTeam = base.playersPerTeam;
    doc.spawns = game.spawns;
    doc.deploymentAreas = game.deploymentAreas;
    doc.layers = [
      {
        id: "contract-ground",
        name: "随机地形",
        type: "tile",
        placement: "below",
        decorative: false,
        dynamic: false,
        visible: true,
        opacity: 1,
        data: game.tiles.flatMap((row, y) =>
          row.map((kind, x) => {
            if (kind === "water" && game.environment !== "space")
              return shoreMask(x, y)
                ? "contract-shallow"
                : "contract-water";
            const pool = byTerrain.get(kind) || [fallback];
            return pool[hash(x, y) % pool.length].id;
          }),
        ),
      },
    ];
    if (biome === "urban") doc.layers.push({
      id:"contract-roads",name:"城市街道",type:"tile",placement:"below",decorative:true,
      dynamic:false,visible:true,opacity:1,
      data:game.tiles.flatMap((row,y)=>row.map((kind,x)=>kind === "plain" && (x % 12 < 3 || y % 12 < 3) ? "contract-road" : null)),
    });
    if (game.environment !== "space")
      doc.layers.push({
        id: "contract-shores",
        name: "岸线",
        type: "tile",
        placement: "below",
        decorative: true,
        dynamic: false,
        visible: true,
        opacity: 1,
        data: game.tiles.flatMap((row, y) => row.map((kind, x) => {
          const mask = kind === "water" ? shoreMask(x, y) : 0;
          return mask ? "contract-shore-" + mask : null;
        })),
      });
    if (details.length)
      doc.layers.push({
        id: "contract-details",
        name: "地表细节",
        type: "tile",
        placement: "below",
        decorative: true,
        dynamic: false,
        visible: true,
        opacity: 1,
        data: game.tiles.flatMap((row, y) =>
          row.map((kind, x) =>
            kind === "plain" && hash(x, y) % 23 === 0
              ? details[hash(x + 1, y) % details.length].id
              : null,
          ),
        ),
      });
    return { ...base, tileMap: doc };
  }
  function factionsForEra(G, era) {
    const factions = era?.startsWith("UC_0079_") ? ["EFSF", "ZEON"]
      : era?.startsWith("UC_0087_") ? ["AEUG", "TITANS", "NEO_ZEON"]
      : era?.startsWith("UC_0093_") ? ["EFSF_0093", "NEO_ZEON_0093"]
      : era?.startsWith("CE_") ? ["OMNI", "ZAFT"] : [];
    return G.factions.filter((f) => factions.includes(f) &&
      G.catalog.prefabs.some(
        (p) =>
          !p.formOnly &&
          !p.wip &&
          !p.facility &&
          p.tags?.includes(era) &&
          (p.availableFactions || [p.faction]).includes(f) &&
          p.weaponKits?.length,
      ),
    );
  }
  function pool(room, G) {
    let cache = pools.get(G.catalog);
    if (!cache) pools.set(G.catalog, (cache = new Map()));
    const { sweepEra: era, sweepFaction: faction, sweepEnvironment: environment } = room.settings,
      key = era + "|" + faction + "|" + environment;
    if (!cache.has(key)) {
      const result = Object.values(G.models).filter(
        (m) =>
          !m.formOnly &&
          !m.wip &&
          !m.facility &&
          !m.requiredPilotId &&
          !m.ship &&
          !G.isFleetCarrier(m) &&
          m.tags?.includes(era) &&
          (m.availableFactions || [m.faction]).includes(faction) &&
          m.weapons?.length &&
          suitableEnvironment(m, environment),
      );
      result.sort(
        (a, b) =>
          a.cost - b.cost ||
          (a.prefabId + "__" + a.kitId).localeCompare(b.prefabId + "__" + b.kitId),
      );
      cache.set(key, result);
    }
    return cache.get(key);
  }
  function enemyStage(room, G, model) {
    let cache = technologyStages.get(G.catalog);
    if (!cache) technologyStages.set(G.catalog, (cache = new Map()));
    const {sweepEra:era,sweepFaction:faction}=room.settings;
    const key=era+"|"+faction;
    if (!cache.has(key)) {
      const nodes=technologyTree[faction] || [],byId=new Map(nodes.map(node=>[node.id,node]));
      const requirement=(node,seen=new Set())=>{
        if(seen.has(node.id)) return Infinity;
        const visited=new Set(seen).add(node.id);
        return Math.max(node.points || 0,...(node.requires || []).map(id=>byId.has(id)?requirement(byId.get(id),visited):0));
      };
      // The base node is not a research milestone. T1 divides at the third
      // paid mainline node (Operation V); T2 at the fourth (GM Kai).
      const mainline=nodes.filter(node=>node.era===era && node.row==="mid" && !node.placeholder && node.points>0)
        .sort((a,b)=>a.column-b.column || a.id.localeCompare(b.id));
      const boundary=mainline[Math.min(mainline.length-1,era.endsWith("_T2")?3:2)];
      const boundaryPoints=boundary?requirement(boundary):Infinity,thresholds=new Map();
      for(const node of nodes) for(const id of node.unlocks || [])
        thresholds.set(id,Math.min(thresholds.get(id) ?? Infinity,requirement(node)));
      cache.set(key,{boundaryPoints,thresholds,models:new Map()});
    }
    const {boundaryPoints,thresholds,models}=cache.get(key);
    if(models.has(model.prefabId)) return models.get(model.prefabId);
    const aliases={MS_05S:"MS_05B",MS_06E3:"MS_06E",YMS_09:"MS_09",
      Apsaras:"ApsarasII",ApsarasIII:"ApsarasII",G_Bull_Easy:"G_Bull"};
    const ids=[model.prefabId,G.technologyUnitId?.(model.prefabId),G.catalog.unitFamilies?.[model.prefabId]?.unitId,aliases[model.prefabId]].filter(Boolean);
    let points=Math.min(...ids.map(id=>thresholds.get(id) ?? Infinity));
    if(!Number.isFinite(points)) {
      const parent=[...thresholds.keys()].filter(id=>ids.some(unitId=>unitId.startsWith(id)))
        .sort((a,b)=>b.length-a.length || a.localeCompare(b))[0];
      points=thresholds.get(parent);
    }
    // Unknown or script-only prototypes must not leak into low-difficulty pools.
    const stage=!Number.isFinite(points) || points>=boundaryPoints ? 1 : 0;
    models.set(model.prefabId,stage);
    return stage;
  }
  function pick(room, G, rng, candidates = pool(room, G)) {
    const early = room.settings.sweepEra === "UC_0079_T1" && config(room.settings.sweepDifficulty).id <= 3;
    if (early) candidates = candidates.filter(model => earlyCombatRole(room, model));
    if (!candidates.length) throw Error("所选年代、阵营和环境没有可用敌军");
    const groups=[[],[]];
    for(const model of candidates) groups[enemyStage(room,G,model)].push(model);
    const phase=config(room.settings.sweepDifficulty).id<=3?0:1;
    let eligible=groups[phase];
    if(!eligible.length) eligible=groups[1-phase];
    if(!eligible?.length) throw Error("所选难度阶段没有适应该环境的敌军单位");
    if (early) {
      // Pick combat roles before hulls: numerous support variants and MS kits
      // must not crowd tanks or fighter squadrons out of low-level contracts.
      const roles = [["ms", 65], ["tank", 25], ["aircraft", 10]]
        .map(([role, weight]) => ({ weight, models: eligible.filter(model => earlyCombatRole(room, model) === role) }))
        .filter(role => role.models.length);
      let roll = rng() * roles.reduce((sum, role) => sum + role.weight, 0);
      const role = roles.find(role => (roll -= role.weight) < 0) || roles[roles.length - 1];
      eligible = role.models;
    }
    // Select hulls before kits so additional loadouts do not multiply spawn odds.
    const ids=[...new Set(eligible.map(model=>model.prefabId))];
    const id=ids[Math.floor(rng()*ids.length)],kits=eligible.filter(model=>model.prefabId===id);
    return kits[Math.floor(rng()*kits.length)];
  }
  function earlyCombatRole(room, model) {
    const tags = model.unitTags || [];
    if (tags.some(tag => ["Support", "Transport", "Infantry"].includes(tag))) return null;
    if (tags.includes("MS")) {
      // Ground-side early Zeon formations consist of Zaku variants, with a
      // minority from the middle technology band, rather than Goufs/Doms/MAs.
      if (room.settings.sweepFaction === "ZEON" && room.settings.sweepEnvironment !== "space" &&
          !/^MS_0[56](?:[A-Z_]|$)/.test(model.prefabId)) return null;
      return "ms";
    }
    if (tags.includes("Tank")) return "tank";
    if (tags.includes("Aircraft") && !tags.includes("Recon")) return "aircraft";
    return null;
  }
  function suitableEnvironment(model, environment) {
    const adaptation = model.adaptability || {};
    return environment === "space"
      ? (adaptation.space ?? 0) >= 100
      : (adaptation.ground ?? 0) >= 100 || (adaptation.air ?? 0) >= 100;
  }
  function scaledCount(room, count) {
    const state = room.game.contract;
    const before = state.enemyBaseCount || 0;
    state.enemyBaseCount = before + count;
    const multiplier = 1 + 0.2 * Math.max(0, state.players - 1);
    return Math.round(state.enemyBaseCount * multiplier) - Math.round(before * multiplier);
  }
  function reinforcementCount(room, count) {
    const state = room.game.contract;
    const available = reinforcementSlots(room);
    if (!available) return 0;
    const before = state.reinforcementBaseCount || 0;
    state.reinforcementBaseCount = before + count;
    const multiplier = 0.75 * (1 + 0.2 * Math.max(0, state.players - 1));
    return Math.min(available, Math.round((before + count) * multiplier) - Math.round(before * multiplier));
  }
  function reinforcementSlots(room) {
    const alive = room.game.units.filter(unit => unit.contractReinforcement && unit.hp > 0 && !unit.contractExtracted).length;
    return Math.max(0, config(room.settings.sweepDifficulty).patrolLimit - alive);
  }
  function enemies(room, G, seed) {
    const rng = random(seed);
    return Array.from({ length: 2 }, () => {
      const m = pick(room, G, rng);
      return { unitId: m.prefabId, kitId: m.kitId };
    });
  }
  function enemyLimits() {
    return { costLimit: 99999, unitCostLimit: 99999 };
  }
  function enemyRestrictions(room) {
    return {
      requiresCarriers: false,
      ignoreDevelopment: true,
      unitCostLimit: Infinity,
      characterFaction: room.settings.sweepFaction,
      aiAllowedEras: [room.settings.sweepEra],
      environment: room.settings.sweepEnvironment,
    };
  }
  const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  function root(game, actor) {
    const seen = new Set();
    while (actor?.embarked && !seen.has(actor.id)) {
      seen.add(actor.id);
      actor = game.units.find((u) => u.id === actor.embarked.carrierId);
    }
    return actor;
  }
  function allies(game) {
    return game.units.filter(
      (u) => u.team === 0 && !u.contractAlly && u.hp > 0 && !u.contractExtracted && !u.deploymentStaged,
    );
  }
  function inside(point, rect) {
    return (
      point.x >= rect.x &&
      point.y >= rect.y &&
      point.x < rect.x + rect.width &&
      point.y < rect.y + rect.height
    );
  }
  function canExtract(game, G, actor, seat) {
    return (
      !!game?.contract &&
      !!actor &&
      actor.hp > 0 &&
      !actor.contractExtracted &&
      G.ownerOf(actor) === seat &&
      G.onMap(actor) &&
      !actor.embarked &&
      !actor.plan &&
      !actor.pendingMove &&
      extractionZones(game.contract).some(zone => inside(G.center(actor), zone))
    );
  }
  function progress(room, G) {
    return room.seats
      .filter((p) => p && !p.bot && G.seatTeam(p.seat) === 0)
      .map((p) => {
        const units = room.game.units.filter((u) => G.ownerOf(u) === p.seat);
        return {
          memberId: p.id,
          seat: p.seat,
          name: p.name,
          remaining: units.filter((u) => u.hp > 0 && !u.contractExtracted).length,
          extracted: units.filter((u) => u.hp > 0 && u.contractExtracted).length,
          lost: units.filter((u) => u.hp <= 0).length,
        };
      });
  }
  function near(game, G, point, team, radius = 2) {
    return game.units.filter(
      (u) =>
        u.team === team && G.onMap(u) && G.cells(u).some((cell) => distance(cell, point) <= radius),
    );
  }
  function spawn(room, G, model, point, elite = false, reinforcement = false, team = 1) {
    const game = room.game,
      state = game.contract,
      serial = ++state.serial,
      u = G.makeUnit(
        { unitId: model.prefabId, kitId: model.kitId },
        team === 0 ? (room.missionAllySeat ?? G.getMap(game.mapId).spawns.length) : 1,
        "contract-" + serial,
        { x: point.x, y: point.y },
        180,
        (game.seed + serial) >>> 0,
        1,
        room.settings.sweepEnvironment,
      );
    u.team = team;
    u.ownerSeat = team === 0 ? (room.missionAllySeat ?? G.getMap(game.mapId).spawns.length) : 1;
    u.formationIndex = -1;
    u.deployed = true;
    if (team === 1) u.contractEnemy = true;
    else {
      u.contractAlly = true;
      u.missionAutonomous = true;
      u.missionGuest = true;
    }
    if (reinforcement) u.contractReinforcement = true;
    if (elite) u.pilot = { ...u.pilot, ...G.pilots.rollGrade("elite", game.seed + serial, model) };
    const positions = [];
    for (let r = 0; r <= 9; r++)
      for (let y = point.y - r; y <= point.y + r; y++)
        for (let x = point.x - r; x <= point.x + r; x++)
          if (Math.max(Math.abs(x - point.x), Math.abs(y - point.y)) === r)
            positions.push({ x, y });
    const target = positions.find((p) => G.fits(game, u, p.x, p.y, 180));
    if (!target) return null;
    Object.assign(u, target);
    game.units.push(u);
    return u;
  }
  function brain(game) {
    let value = brains.get(game);
    if (!value)
      brains.set(
        game,
        (value = { groups: [], health: new Map(), rng: random(game.contract.seed ^ 0x9137) }),
      );
    return value;
  }
  const squadCount = (difficulty) => (config(difficulty).id >= 4 ? 2 : 1);
  function group(room, ids, home, role = "patrol", objectiveId = null) {
    const b = brain(room.game),
      entry = {
        ids,
        home: { ...home },
        role,
        objectiveId,
        alerted: false,
        goal: null,
      };
    b.groups.push(entry);
    for (const id of ids) {
      const u = room.game.units.find((u) => u.id === id);
      if (u) b.health.set(id, u.hp);
    }
    return entry;
  }
  function patrol(room, G, point, count, elite = false, role = "patrol", objectiveId = null, reinforcement = false) {
    if (reinforcement && !reinforcementSlots(room)) return [];
    const state = room.game.contract,
      rng = random(state.seed + ++state.wave * 1979),
      ids = [];
    // Initial garrisons keep their full strength; later waves share a live-unit cap.
    const total = reinforcement ? reinforcementCount(room, count) : scaledCount(room, count);
    let squadModel;
    for (let i = 0; i < total; i++) {
      if (i % 3 === 0 || role === "guard") squadModel = pick(room, G, rng);
      const u = spawn(room, G, squadModel, point, elite, reinforcement);
      if (u) ids.push(u.id);
    }
    for (let start = 0; start < ids.length; start += 3) {
      const squad = ids.slice(start, start + 3);
      group(room, squad, point, role, objectiveId);
      if (role !== "guard")
        for (let index = 1; index < squad.length; index++) {
          const unit = room.game.units.find(u => u.id === squad[index]);
          const target = squad.slice(0, index).map(id => room.game.units.find(u => u.id === id))
            .find(other => G.squadJoinTarget(room.game, unit, other.x, other.y, [unit]) === other);
          if (!target) continue;
          G.joinSquad(room.game, unit, target, [unit]);
          unit.x = target.x;
          unit.y = target.y;
        }
    }
    return ids;
  }
  function edge(room, avoidEntry = false, attempt = 0) {
    const game = room.game,
      rng = brain(game).rng,
      side = Math.floor(rng() * 4),
      w = mapWidth(game),
      h = mapHeight(game);
    const point =
      side < 2
        ? { x: side ? w - 5 : 3, y: 4 + Math.floor(rng() * (h - 8)) }
        : { x: 4 + Math.floor(rng() * (w - 8)), y: side === 2 ? 3 : h - 5 };
    return avoidEntry &&
      attempt < 24 &&
      deploymentZones(game.contract).some(entry => inside(point, {
        x: entry.x - 8,
        y: entry.y - 8,
        width: entry.width + 16,
        height: entry.height + 16,
      }))
      ? edge(room, true, attempt + 1)
      : point;
  }
  function reinforcements(room, G, objective, squads = 1, transport = false, airborne = false) {
    const game = room.game,
      b = brain(game);
    const before = game.units.length;
    for (let i = 0; i < squads; i++) {
      const point = airborne ? { x: objective.x + 5, y: objective.y + (i - 1) * 3 } : edge(room);
      if (!transport) {
        const ids = patrol(room, G, point, 3, false, "pursuit", objective.id, true);
        for (const force of b.groups.filter(force => force.ids.some(id => ids.includes(id))))
          force.goal = { x: objective.x, y: objective.y };
        if (airborne)
          for (const id of ids) {
            const u = game.units.find((u) => u.id === id);
            u.airdropRound = game.round;
          }
        continue;
      }
      if (reinforcementSlots(room) < 2) continue;
      const waveCount = reinforcementCount(room, 4);
      const zeon = /ZEON/.test(room.settings.sweepFaction),
        name =
          game.environment === "space"
            ? zeon
              ? "PapuaClass"
              : "ColumbusClass"
            : zeon
              ? "FatUncle"
              : "Medea";
      let carrier = spawn(room, G, G.models[name + "__standard"], point, false, true);
      if (!carrier) throw Error("追击运输单位没有可用入场位置");
      // Match the current enemy faction, including its generic pilot presentation.
      carrier.pilot = G.pilots.roll(null, game.seed + game.contract.serial, 1, 0, {
        ...G.modelOf(carrier),
        faction: room.settings.sweepFaction,
      });
      const compatible = pool(room, G).filter(
        (m) =>
          !m.ship &&
          m.transport?.loadTags?.length &&
          (m.transport.slotCost || 1) <= 2 &&
          G.modelOf(carrier).hangars.some((h) =>
            h.allowedTags.some((tag) => m.transport.loadTags.includes(tag)),
          ),
      );
      if (!compatible.length) throw Error("追击小队没有可搭载单位");
      const ids = [carrier.id];
      const cargoCount = waveCount - 1;
      for (let j = 0; j < cargoCount; j++) {
        const model = pick(room, G, b.rng, compatible),
          cargo = spawn(room, G, model, point, false, true);
        if (!cargo) continue;
        let hangar = G.hangars
          .of(carrier)
          .find((h) => G.hangars.canLoad(game, cargo, carrier, h.id));
        if (!hangar) {
          // Added players may require a second transport; count it within the scaled wave.
          if (j + 1 >= cargoCount) {
            game.units.splice(game.units.indexOf(cargo), 1);
            const escort = spawn(room, G, G.models[name + "__standard"], point, false, true);
            if (!escort) throw Error("追击运输单位没有可用入场位置");
            escort.pilot = G.pilots.roll(null, game.seed + game.contract.serial, 1, 0, {
              ...G.modelOf(escort), faction: room.settings.sweepFaction,
            });
            ids.push(escort.id);
            continue;
          }
          carrier = spawn(room, G, G.models[name + "__standard"], point, false, true);
          if (!carrier) throw Error("追击运输单位没有可用入场位置");
          carrier.pilot = G.pilots.roll(null, game.seed + game.contract.serial, 1, 0, {
            ...G.modelOf(carrier), faction: room.settings.sweepFaction,
          });
          ids.push(carrier.id);
          j++;
          hangar = G.hangars.of(carrier).find((h) => G.hangars.canLoad(game, cargo, carrier, h.id));
          if (!hangar) throw Error("追击小队没有可搭载位置");
        }
        cargo.embarked = { carrierId: carrier.id, hangarId: hangar.id };
        ids.push(cargo.id);
      }
      G.hangars.sync(game);
      const force = group(room, ids, point, "pursuit", objective.id);
      force.goal = { x: objective.x, y: objective.y };
    }
    return game.units.length - before;
  }
  function alertNearby(game, point, objectiveId, radius = 18) {
    for (const force of brain(game).groups) {
      // Event guards belong to their own objective; only roaming forces answer
      // other events' support signals. Direct damage/contact is handled separately.
      if (force.role === "guard" && force.objectiveId !== objectiveId) continue;
      if (
        force.ids.some((id) =>
          game.units.some((u) => u.id === id && u.hp > 0 && distance(u, point) <= radius),
        )
      ) {
        // A radio report supplies a location to investigate, not sight of players.
        if (force.role === "guard") force.alerted = true;
        force.goal = { x: point.x, y: point.y };
      }
    }
  }
  function aiOrder(game, G, actor) {
    if (!game.contract || !actor) return null;
    if (actor.contractAlly) {
      const objective = game.contract.objectives.find(o => o.id === actor.contractObjective);
      const contacts = objective && objective.status !== "available" ? near(game, G, objective, 1, 7)
        .filter(u => G.sensors.visible(game, 0, u) || G.sensors.detected(game, 0, u)) : [];
      return { alerted: contacts.length > 0, goal: objective?.status === "active" ? objective : G.center(actor), targetIds: contacts.map(u => u.id) };
    }
    if (actor.team !== 1) return null;
    const b = brain(game),
      force = b.groups.find((f) => f.ids.includes(actor.id));
    if (!force) return null;
    const members = force.ids
      .map((id) => game.units.find((u) => u.id === id))
      .filter((u) => u && G.onMap(u));
    const targets = game.units.filter(u => u.team === 0 && G.onMap(u) && (!u.contractAlly ||
      game.contract.objectives.some(o => o.id === u.contractObjective && o.status !== "available")));
    // Awareness belongs to this formation, not an omniscient allied observer.
    const query = { observers: members };
    const contact = targets.filter(
      (t) =>
        G.sensors.visible({ ...game, fogMode: "full", intel: undefined }, 1, t, query) ||
        G.sensors.detected({ ...game, fogMode: "full", intel: undefined }, 1, t, query),
    );
    if (force.role !== "guard" && !contact.length) force.alerted = false;
    if (contact.length) {
      force.alerted = true;
      const target = contact.reduce(
        (a, t) => (!a || distance(actor, t) < distance(actor, a) ? t : a),
        null,
      );
      force.goal = { ...G.center(target) };
    }
    if (force.alerted) return { alerted: true, goal: force.goal || force.home, targetIds: contact.map(u => u.id) };
    const origin = members[0] || actor;
    if (!force.goal || distance(origin, force.goal) <= 2 || force.nextRouteRound <= game.round) {
      const rng = b.rng,
        guard = force.role === "guard";
      force.goal = guard
        ? {
            x: Math.max(1, Math.min(mapWidth(game) - 2, force.home.x + Math.floor(rng() * 11) - 5)),
            y: Math.max(
              1,
              Math.min(mapHeight(game) - 2, force.home.y + Math.floor(rng() * 11) - 5),
            ),
          }
        : {
            x: 3 + Math.floor(rng() * (mapWidth(game) - 6)),
            y: 3 + Math.floor(rng() * (mapHeight(game) - 6)),
          };
      force.nextRouteRound = game.round + (guard ? 6 : 18);
    }
    return { alerted: false, goal: force.goal };
  }
  function friendlyGarrison(room, G, objective) {
    const state = room.game.contract, difficulty = config(room.settings.sweepDifficulty).id;
    const faction = factionsForEra(G, room.settings.sweepEra).find(f => f !== room.settings.sweepFaction);
    const friendlyRoom = {settings:{...room.settings,sweepFaction:faction || room.settings.sweepFaction}};
    const candidates = pool(friendlyRoom, G).filter(m => m.unitTags?.includes("MS"));
    const rng = random(state.seed + state.serial * 31);
    const add = (model, point, facility) => {
      const u = spawn(room, G, model, point, false, false, 0);
      if (!u) throw Error("无法放置合约友军");
      u.contractObjective = objective.id;
      if (facility) {
        u.facility = {id:u.id,type:facility,level:1};
        u.missionResourceScale = (40000 + (difficulty - 1) * 5000) / model.hp;
        u.hp = G.modelOf(u).hp;
      }
      objective.protected.push(u.id);
      return u;
    };
    if (objective.type === "defend") {
      const core = add(G.models.Facility_HQ__standard, objective, "hq");
      objective.coreId = core.id;
      for (const dx of [-3,3]) add(G.models.Facility_MG__standard, {x:objective.x+dx,y:objective.y-2}, "mg");
    }
    for (let i=0;i<3;i++) {
      const model = pick(friendlyRoom,G,rng,candidates.length ? candidates : pool(friendlyRoom,G));
      const u = add(model,{x:objective.x-2+i*2,y:objective.y+2});
      if (objective.type === "rescue") u.hp = Math.max(1,Math.floor(u.hp*.5));
    }
  }
  function initialize(room, G, seed, log = () => {}) {
    const game = room.game,
      map = G.getMap(game.mapId),
      d = config(room.settings.sweepDifficulty),
      rng = random(seed),
      players = room.seats.filter((p) => p && !p.bot && G.seatTeam(p.seat) === 0).length,
      { entry, extraction, locations } = game.contractLayout;
    game.contract = {
      seed,
      serial: 0,
      wave: 0,
      players,
      objectives: [],
      cues: [],
      cueSerial: 0,
      entry,
      entries: deploymentZones(game.contractLayout),
      extraction,
      extractions: extractionZones(game.contractLayout),
      lastRound: game.round,
      turn: 0,
      extracted: false,
      contactKills: [],
      commissions: Object.fromEntries(room.seats.filter(p=>p&&!p.bot&&p.seat%2===0).map(p=>[p.id,contacts.active(p.contactTasks)])),
    };
    const state = game.contract,
      types = kinds.slice(),
      initial = game.units.filter((u) => u.team === 1);
    // Seats provide AI ownership, not an extra full army per human participant.
    const initialCount = scaledCount(room, 2);
    for (const u of initial.splice(initialCount)) game.units.splice(game.units.indexOf(u), 1);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    const special = contacts.specialTasks(room);
    for (const task of special) {
      const candidates=[];
      for(let y=9;y<map.height-8;y+=3)for(let x=9;x<map.width-8;x+=3){
        const p={x,y};
        if([...state.entries,...state.extractions].some(r=>inside(p,{x:r.x-3,y:r.y-3,width:r.width+6,height:r.height+6})))continue;
        const all=[...locations,...[...state.entries,...state.extractions].map(r=>({x:r.x+r.width/2,y:r.y+r.height/2}))];
        candidates.push({p,score:Math.min(...all.map(q=>distance(p,q)))});
      }
      candidates.sort((a,b)=>b.score-a.score);
      if(!candidates.length)throw Error("无法放置联络任务事件");
      const point=candidates[0].p;locations.push(point);
      let x=point.x,y=point.y;const goal=locations[0];
      while(x!==goal.x||y!==goal.y){
        for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(game.tiles[y+dy]?.[x+dx]!==undefined)game.tiles[y+dy][x+dx]="plain";
        if(x!==goal.x)x+=Math.sign(goal.x-x);else y+=Math.sign(goal.y-y);
      }
    }
    for (let i = 0; i < d.events + special.length; i++) {
      const task = special[i-d.events],
        definition = task ? {...kinds.find(k=>k.type===(task.kind==="enemybase"?"factory":task.kind)),type:task.kind,name:task.eventName,
          ...(task.kind==="enemybase"?{hint:"摧毁重兵防守的敌军基地，并成功撤离。"}:{})} : types[i % types.length],
        point = { ...locations[i] },
        objective = {
          id: "event-" + i,
          ...definition,
          ...point,
          status: "available",
          progress: 0,
          required: ["capture","defend"].includes(definition.type) ? 5 : ["rescue","upload"].includes(definition.type) ? 3 : 1,
          targets: [],
          protected: [],
          destroyed: [],
          ...(task ? {contactTaskId:task.id} : {}),
        };
      state.objectives.push(objective);
      for (let y = Math.max(0, point.y - 6); y <= Math.min(map.height - 1, point.y + 6); y++)
        for (let x = Math.max(0, point.x - 6); x <= Math.min(map.width - 1, point.x + 6); x++)
          game.tiles[y][x] = "plain";
      if (["defend","rescue"].includes(definition.type)) friendlyGarrison(room,G,objective);
      if (["factory","radar","enemybase"].includes(definition.type)) {
        const count = ["radar","enemybase"].includes(definition.type) ? 1 : task?.id === "efsf-5" ? 4 : 2 + Math.floor((d.id - 1) / 4);
        for (let j = 0; j < count; j++) {
          const model = G.models[definition.type === "enemybase" ? "Facility_HQ__standard" : definition.type === "radar" ? "Facility_Radar__standard" : "Facility_Factory__standard"],
            u = spawn(room, G, model, {
              x: point.x + (j % 2) * 3 - 2,
              y: point.y + Math.floor(j / 2) * 3 - 2,
            });
          if (!u) throw Error("无法放置合约工厂");
          u.facility = { id: u.id, type: definition.type === "enemybase" ? "hq" : definition.type === "radar" ? "radar" : "factory", level: 1 };
          u.missionResourceScale = (20000 + (d.id - 1) * 5000) / model.hp;
          u.hp = G.modelOf(u).hp;
          objective.targets.push(u.id);
          brain(game).health.set(u.id, u.hp);
        }
      }
      const count = task?.guardCount || (task?.id === "efsf-4" ? 12 : task?.id === "efsf-5" ? 12 : 3 + Math.floor((d.id - 1) / 3));
      const guards = (["efsf-3","efsf-4"].includes(task?.id) || task?.targetUnit) ? [] : patrol(
        room,
        G,
        { x: point.x + (["defend","rescue"].includes(definition.type) ? 8 : 3), y: point.y + 2 },
        count,
        false,
        "guard",
        objective.id,
      );
      if(["efsf-3","efsf-4"].includes(task?.id) || task?.targetUnit) {
        const prefab=G.catalog.prefabs.find(p=>p.id===(task.targetUnit || (task.id==="efsf-3"?"RGM_79_G":"MS_06F")));
        for(let j=0;j<(task.targetKits?.length || (task.id==="efsf-3"?3:12));j++){
          const model=G.models[prefab.id+"__"+(task.targetKits?.[j] || prefab.weaponKits[0].id)];
          const u=spawn(room,G,model,{x:point.x+3,y:point.y+j});
          if(!u)throw Error("无法放置联络任务小队");
          if(task.id==="efsf-3" || task.targetPilotGrade) {
            u.pilot={...u.pilot,...G.pilots.rollGrade(task.targetPilotGrade || "veteran",game.seed+state.serial,model)};
            u.pilot.name+=" · "+(task.id==="efsf-7"?"不死的雷纳斯":"文件护卫")+(j+1);
          }
          guards.push(u.id);
        }
        group(room,guards,point,"guard",objective.id);
      }
      if(task?.id === "efsf-5" || task?.turrets)for(let j=0;j<(task.turrets || 4);j++){
        const u=spawn(room,G,G.models.Facility_MG__standard,{x:point.x+(j%2?5:-5),y:point.y+(j<2?-4:4)});
        if(!u)throw Error("无法放置前线营地炮塔");u.facility={id:u.id,type:"mg",level:1};
      }
      if(task?.kind === "salvage") {
        const id=task.id==="efsf-2"?"Medea":"Type74";
        const p=G.catalog.prefabs.find(p=>p.id===id);
        objective.wreckModel = id+"__"+p.weaponKits[0].id;
      }
      if (definition.type === "command") objective.targets = guards.slice();
    }
    // Initial bot formations roam independently rather than gathering or rushing players.
    for (let i = 0; i < initial.length; i += 3) {
      const members = initial.slice(i, i + 3),
        point = edge(room, true);
      for (const u of members) {
        for (let r = 0; r < 10; r++) {
          if (G.fits(game, u, point.x + r, point.y, 180)) {
            Object.assign(u, { x: point.x + r, y: point.y });
            break;
          }
        }
      }
      group(
        room,
        members.map((u) => u.id),
        point,
      );
    }
    for (let i = 0; i < 1 + Math.floor((d.id - 1) / 3); i++) patrol(room, G, edge(room, true), 3);
    for (const u of game.units.filter((u) => u.team === 1)) {
      u.deployed = true;
      u.deploymentStaged = false;
    }
    for (let seat = 1; seat < game.deployment.length; seat += 2) game.deployment[seat] = true;
    log("[合约模式] 事件 " + d.events + " 项；驻守部队在事件附近巡逻。");
  }
  function reward(room, G) {
    const state = room.game?.contract;
    if (!state) return { money: 0, supplies: 0, technology: 0, inventory: {} };
    const completed = state.objectives.filter((o) => o.status === "completed" && !o.contactTaskId).length,
      d = config(room.settings.sweepDifficulty).id,
      era = Math.pow(1.25, Math.max(0, G.technologyWeight(room.settings.sweepEra) - 1)),
      economy = typeof BattleEconomy !== "undefined" ? BattleEconomy : require("./battle-economy.js"),
      share = Math.min(1, completed / d),
      [money, supplies] = completionRewards[d - 1];
    return {
      // Settlement applies its multiplier once; the table already includes it.
      money: money * share * era / economy.completionRewardMultiplier,
      supplies: supplies * share * era / economy.completionRewardMultiplier,
      technology: completed * 125 * era * (1 + (d - 1) * 0.25),
      inventory: {},
    };
  }
  function recordDefeat(room,G,from,to,model,weapon = null) {
    const state=room.game.contract;
    if(to.contactKillRecorded)return;
    to.contactKillRecorded=true;
    if(!from || from.team!==0 || to.team!==1)return;
    const owner=room.seats[G.ownerOf(from)];
    if(!owner || owner.bot)return;
    state.contactKills ||= [];
    if(!state.contactKills.includes(to.id) && model.unitTags?.includes("MS") && (model.availableFactions||[model.faction]).includes("ZEON"))state.contactKills.push(to.id);
    state.contactKillRecords ||= [];
    if(model.unitTags?.includes("MS") && !state.contactKillRecords.some(record=>record.id===to.id))
      state.contactKillRecords.push({id:to.id,factions:model.availableFactions||[model.faction],
        artillery:!!weapon && (weapon.slot==="skill" || !!weapon.special) && weaponClasses.classify(weapon)==="mortar"});
    if(/^RX_80PR(?:_|$)/.test(G.modelOf(from).prefabId))to.contactPaleKill=true;
  }
  function commissionProgress(room,G,player) {
    const state=room.game.contract;if(!state)return [];
    const escaped=room.game.units.some(u=>G.ownerOf(u)===player.seat&&u.hp>0&&u.contractExtracted);
    return (state.commissions?.[player.id]||[]).flatMap(id=>{
      const task=contacts.byId.get(id);if(!contacts.eligible(task,room.settings))return [];
      if(task.kind==="kills")return [{id,amount:task.killMethod==="artillery"
        ? (state.contactKillRecords||[]).filter(record=>record.artillery && record.factions.includes(task.enemyFaction||"ZEON")).length
        : (state.contactKills||[]).length}];
      const o=state.objectives.find(o=>o.contactTaskId===id);
      if(id==="efsf-5"){
        const amount=o?.targets.filter(id=>{const u=room.game.units.find(u=>u.id===id);return u?.hp<=0&&u.contactPaleKill;}).length||0;
        return amount ? [{id,amount}] : [];
      }
      if(o?.status!=="completed" || ((task.kind==="salvage" || task.requiresExtraction)&&!escaped))return [];
      return [{id,amount:1}];
    });
  }
  function startObjective(state, objective) {
    if (objective.status !== "available") return;
    objective.status = "active";
    objective.startedTurn = state.turn;
    state.cues.push({
      id: ++state.cueSerial,
      type: "started",
      objectiveId: objective.id,
      name: objective.name,
    });
  }
  function completeObjective(state, objective) {
    if (["completed","failed"].includes(objective.status)) return;
    startObjective(state, objective);
    objective.status = "completed";
    state.cues.push({
      id: ++state.cueSerial,
      type: "completed",
      objectiveId: objective.id,
      name: objective.name,
    });
    if (state.objectives.every((o) => o.status === "completed") && !state.allCompleted) {
      state.allCompleted = true;
      state.cues.push({ id: ++state.cueSerial, type: "all_completed", name: "已完成所有目标" });
    }
  }
  function failObjective(state, objective) {
    if (["completed","failed"].includes(objective.status)) return;
    objective.status = "failed";
    state.cues.push({id:++state.cueSerial,type:"failed",objectiveId:objective.id,name:objective.name});
  }
  function poll(room, G, log = () => {}) {
    const game = room.game,
      state = game?.contract;
    if (
      !state ||
      game.winner !== null ||
      !["idle", "finished"].includes(room.phase) ||
      room.playback ||
      !game.deployment.every(Boolean)
    )
      return;
    if (!allies(game).length) {
      const evacuated = game.units.some((u) => u.team === 0 && u.hp > 0 && u.contractExtracted);
      state.extracted = evacuated;
      game.winner = evacuated ? 0 : 1;
      room.phase = "finished";
      log(
        evacuated
          ? "[合约模式] 存活部队已全部撤离，行动结束。"
          : "[合约模式] PMC部队全灭，行动结束。",
      );
      return;
    }
    for (const p of progress(room, G)) if (!p.remaining) room.turnDone[p.seat] = true;
    const b = brain(game),
      newTurn = state.lastRound < game.round && game.team === 0;
    if (newTurn) {
      state.lastRound = game.round;
      state.turn++;
      if (state.turn % 4 === 0) {
        if (patrol(room, G, edge(room, true), 3, false, "patrol", null, true).length)
          log("[合约模式] 敌方边缘巡逻队进入战场。");
      }
    }
    for (const force of b.groups)
      for (const id of force.ids) {
        const u = game.units.find((u) => u.id === id);
        if (u && u.hp < (b.health.get(id) ?? u.hp)) {
          force.alerted = true;
          const objective = state.objectives.find((o) => o.id === force.objectiveId);
          if (objective && ["factory", "command", "radar", "enemybase"].includes(objective.type))
            startObjective(state, objective);
          alertNearby(game, u, force.objectiveId);
          const enemy = near(game, G, u, 0, 18).sort((a, c) => distance(a, u) - distance(c, u))[0];
          force.goal = enemy ? G.center(enemy) : { x: u.x, y: u.y };
        }
        if (u) b.health.set(id, u.hp);
      }
    for (const o of state.objectives) {
      if (["completed","failed"].includes(o.status)) continue;
      if (
        ["factory", "command", "radar", "enemybase"].includes(o.type) &&
        near(game, G, o, 0, o.type === "command" ? 6 : 3).length
      )
        startObjective(state, o);
      if (["factory","radar","enemybase"].includes(o.type))
        for (const id of o.targets) {
          const u = game.units.find((u) => u.id === id),
            previous = b.health.get(id);
          if (u && u.hp < (previous ?? u.hp)) {
            startObjective(state, o);
            alertNearby(game, o, o.id);
          }
          if (u) b.health.set(id, u.hp);
          if ((!u || u.hp <= 0) && !o.destroyed.includes(id)) {
            o.destroyed.push(id);
            if (o.type === "factory" && reinforcements(room, G, o))
              log("[合约模式] 工厂被毁，敌方边缘巡逻队增援。");
          }
        }
      if (
        ["factory", "command", "radar", "enemybase"].includes(o.type) &&
        o.targets.length &&
        o.targets.every((id) => !game.units.some((u) => u.id === id && u.hp > 0))
      ) {
        completeObjective(state, o);
        log("[合约模式] 完成事件：" + o.name);
      }
      if (o.type === "radar" && o.status === "active" && !o.responseSent) {
        o.responseSent = true;
        reinforcements(room,G,o,squadCount(config(room.settings.sweepDifficulty).id),false,true);
        alertNearby(game,o,o.id);
      }
      if (["defend","rescue","upload"].includes(o.type)) {
        const pmc = near(game,G,o,0,o.type === "upload" ? 1 : 5).filter(u=>!u.contractAlly);
        if (o.type !== "upload") {
          const protectedAlive = o.type === "defend"
            ? game.units.some(u=>u.id===o.coreId && u.hp>0)
            : game.units.some(u=>o.protected.includes(u.id) && u.hp>0);
          if (!protectedAlive) {
            failObjective(state,o);
            log("[合约模式] 事件失败：" + o.name);
            continue;
          }
        }
        if (o.status === "available" && pmc.length) {
          startObjective(state,o);
          alertNearby(game,o,o.id);
          reinforcements(room,G,o,squadCount(config(room.settings.sweepDifficulty).id),false,true);
          log("[合约模式] 开始事件：" + o.name);
        }
        if (o.status !== "active" || !newTurn || o.startedTurn === state.turn) continue;
        const elapsed = state.turn - o.startedTurn;
        if (o.type === "defend" && elapsed % 2 === 0 && o.progress + 1 < o.required)
          reinforcements(room,G,o,squadCount(config(room.settings.sweepDifficulty).id),false,true);
        if (o.type === "rescue" && elapsed === 2)
          reinforcements(room,G,o,squadCount(config(room.settings.sweepDifficulty).id));
        if (o.type === "defend" || (pmc.length && (o.type === "rescue" || !near(game,G,o,1,1).length))) o.progress++;
        if (o.progress >= o.required) {
          completeObjective(state,o);
          if (o.type === "rescue") for (const u of game.units.filter(u=>o.protected.includes(u.id) && u.hp>0)) {
            u.contractExtracted = true;
            u.deploymentStaged = true;
          }
          log("[合约模式] 完成事件：" + o.name);
        }
        continue;
      }
      if (o.type !== "capture") continue;
      if (o.status === "available" && near(game, G, o, 0, 2).some(u=>!u.contractAlly)) {
        startObjective(state, o);
        alertNearby(game, o, o.id);
        log("[合约模式] 开始占领敌方据点。");
      }
      if (o.status !== "active") continue;
      alertNearby(game, o, o.id);
      if (!newTurn || o.startedTurn === state.turn) continue;
      const elapsed = state.turn - o.startedTurn;
      if (elapsed === 3 && !o.airdrop) {
        o.airdrop = true;
        const arrived = reinforcements(
          room,
          G,
          o,
          squadCount(config(room.settings.sweepDifficulty).id),
          false,
          true,
        );
        if (arrived) log("[合约模式] 敌方空降部队前来防守。");
      }
      if (elapsed % 4 === 0)
        reinforcements(room, G, o, squadCount(config(room.settings.sweepDifficulty).id));
      if (near(game, G, o, 0, 2).some(u=>!u.contractAlly) && !near(game, G, o, 1, 2).length) o.progress++;
      if (o.progress >= 5) {
        completeObjective(state, o);
        log("[合约模式] 完成事件：" + o.name);
      }
    }
  }

  const mapWidth = (g) => g.tiles[0].length,
    mapHeight = (g) => g.tiles.length;
  function action(room, G, member, msg, log = () => {}) {
    const game = room.game,
      state = game.contract;
    if (!state || game.winner !== null || room.phase !== "idle" || game.team !== 0)
      throw Error("当前不能执行合约操作");
    if (member.seat === null || G.seatTeam(member.seat) !== 0 || member.bot)
      throw Error("只有参战PMC可以执行操作");
    if (msg.action === "contract_extract") {
      const actor = game.units.find((u) => u.id === msg.unitId);
      if (!canExtract(game, G, actor, member.seat)) throw Error("请选择撤离区内自己的未撤离单位");
      const leaving = new Set([actor.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const u of game.units)
          if (u.hp > 0 && u.embarked && leaving.has(u.embarked.carrierId) && !leaving.has(u.id)) {
            leaving.add(u.id);
            changed = true;
          }
      }
      for (const u of game.units.filter((u) => leaving.has(u.id))) {
        u.contractExtracted = true;
        u.deploymentStaged = true;
        u.acted = true;
        delete u.plan;
        delete u.pendingMove;
        delete u.squadOrder;
        delete u.squadId;
      }
      log("[合约模式] " + member.name + " 撤离单位 " + leaving.size + " 台。");
      return;
    }
    if (msg.action !== "contract_interact") throw Error("无效的合约操作");
    const objective = state.objectives.find((o) => o.id === msg.objectiveId),
      actor = game.units.find((u) => u.id === msg.unitId);
    if (!objective || objective.status !== "available" || objective.type !== "salvage")
      throw Error("该事件当前不能交互");
    if (
      !actor ||
      !G.canControlUnit(room.settings, [...room.members.values()], member.seat, actor) ||
      !G.onMap(actor) ||
      actor.acted ||
      actor.plan ||
      actor.pendingMove ||
      !G.cells(actor).some((cell) => distance(cell, objective) <= 1)
    )
      throw Error("请选择白色3×3范围内可行动的己方单位");
    const arrived = reinforcements(room, G, objective, 1, true);
    actor.acted = true;
    completeObjective(state, objective);
    objective.progress = 1;
    alertNearby(game, objective, objective.id);
    log("[合约模式] 完成事件：" + objective.name + (arrived ? "，敌方运输机搭载追击部队入场。" : "。"));
  }

  function view(room, G, multipliers = { money: 1, supplies: 1, technology: 1 }) {
    const state = room.game?.contract;
    if (!state) return null;
    const round = (n) => Math.round(n / 25) * 25,
      base = reward(room, G);
    const { seed: privateSeed, ...publicState } = structuredClone(state);
    return {
      ...publicState,
      difficulty: config(room.settings.sweepDifficulty, room.settings.sweepEra),
      completed: state.objectives.filter((o) => o.status === "completed").length,
      participants: progress(room, G),
      pending: {
        money: round(base.money * multipliers.money),
        supplies: round(base.supplies * multipliers.supplies),
        technology: round(base.technology * multipliers.technology),
      },
    };
  }
  return {
    recordDefeat,
    commissionProgress,
    difficulties,
    biomes,
    covers,
    kinds,
    config,
    mapId,
    registerMaps,
    generateMap,
    visualMap,
    roomSettings,
    factionsForEra,
    enemies,
    enemyLimits,
    enemyStage,
    enemyRestrictions,
    initialize,
    poll,
    action,
    view,
    reward,
    canExtract,
    extractionZones,
    deploymentZones,
    progress,
    aiOrder,
    squadCount,
    suitableEnvironment,
  };
})();
if (typeof module !== "undefined") module.exports = ContractMode;
