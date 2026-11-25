/* One cooperative battlefield, with authoritative objectives and shared extraction. */
"use strict";
const ContractMode = (() => {
  const contacts = typeof ContactTasks !== "undefined" ? ContactTasks : require("./contact-tasks.js");
  const technologyTree = typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const weaponClasses = typeof WeaponClasses !== "undefined" ? WeaponClasses : require("./weapon-classes.js");
  const forces = typeof ContractForces !== "undefined" ? ContractForces : require("./contract-forces.js");
  const covers = {
    ground: "assets/maps/covers/contract-ground.svg",
    space: "assets/maps/covers/contract-space.svg",
  };
  const costs = [2000, 3000, 4000, 6000, 8000, 10000];
  const playerCostMultiplier = 1.5;
  const ordinaryForceScale = [.5, .6, .65, .7, .7, .75];
  // Full ordinary-objective completion at baseline era and normal settlement rates.
  const completionRewards = [
    [2500, 3500], [4000, 6000], [6000, 8000],
    [9000, 11000], [12000, 15000], [15000, 20000],
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
    costLimit: costLimit * playerCostMultiplier,
    fleetLimit: 3 + Math.floor(index / 3),
    initialEnemyCount: [9, 12, 18, 24, 30, 36][index],
    patrolLimit: Math.floor([9, 12, 18, 24, 30, 36][index] * 1.5),
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
      hint: "PMC进入5×5覆盖范围启动，保护据点核心五回合。友军自动防守，敌军分批来袭；核心被毁则事件失败。",
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
  const noAlliesFaction = "NONE";
  const noAllies = settings => settings.sweepFaction === noAlliesFaction;
  function factionRoom(room, faction, action) {
    const previous = room.settings;
    room.settings = {...previous, sweepFaction:faction};
    try { return action(); } finally { room.settings = previous; }
  }
  function enemyFactions(G, settings) {
    return noAllies(settings) ? factionsForEra(G,settings.sweepEra) : [settings.sweepFaction];
  }
  function patrolFaction(room,G,point) {
    const state=room.game.contract, factions=state.enemyFactions;
    const faction=factions[(state.factionPatrolSerial = (state.factionPatrolSerial || 0) + 1) % factions.length];
    return faction;
  }
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
    if (era === "CE_0071_T1" && result.id < 2) throw Error("CE0071T1合约最低难度为N2");
    const stage = ["UC_0079_T1", "UC_0079_T2", "UC_0087_T1", "UC_0087_T2", "UC_0093_T1"].indexOf(era);
    // T2 scales the baseline by 1.5; subsequent eras keep the 1.25 progression.
    // Round only the final budget, so rounding does not compound between eras.
    const scale = stage > 0 ? 1.5 * 1.25 ** (stage - 1) : 1;
    return { ...result, costLimit: Math.round(costs[result.id - 1] * scale / 500) * 500 * playerCostMultiplier };
  }
  function scenarioConfig(settings, generation = false) {
    const d = config(settings.sweepDifficulty, settings.sweepEra);
    const result = noAllies(settings) ? {...d, events:d.events + 1,
      width:Math.ceil(d.width * 1.1), height:Math.ceil(d.height * 1.1)} : d;
    return generation ? result : {...result,width:Math.ceil(result.width/2),height:Math.ceil(result.height/2)};
  }
  function compactMap(map) {
    const original = map.tiles, width = Math.ceil(map.width/2), height = Math.ceil(map.height/2);
    const point = value => {
      const result = {...value,x:Math.floor(value.x/2),y:Math.floor(value.y/2)};
      if (value.width != null) result.width = Math.ceil((value.x+value.width)/2)-result.x;
      if (value.height != null) result.height = Math.ceil((value.y+value.height)/2)-result.y;
      return result;
    };
    map.width=width;map.height=height;
    map.tiles=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>original[y*2][x*2]));
    map.spawns=map.spawns.map(point);map.deploymentAreas=map.deploymentAreas.map(point);
    if (map.contractLayout) {
      const layout=map.contractLayout;
      map.contractLayout={...layout,entry:point(layout.entry),entries:layout.entries.map(point),
        extraction:point(layout.extraction),extractions:layout.extractions.map(point),locations:layout.locations.map(point)};
    }
    return map;
  }
  function roomSettings(settings) {
    if (settings.sweepEnvironment !== "ground") throw Error("合约模式宇宙作战暂时禁用");
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
        catalog.maps[id] = compactMap(map);
      }
    delete catalog.maps.battlefield_sweep;
  }
  function generateMap(catalog, settings, seed) {
    const d = scenarioConfig(settings, true),
      map = structuredClone(catalog.maps[mapId(settings.sweepEnvironment, d.id)]),
      rng = random(seed ^ 0xa53c9e17),
      w = map.width = d.width,
      h = map.height = d.height,
      space = settings.sweepEnvironment === "space",
      biome = space ? "space" : biomes[Math.floor(random(seed ^ 0x71b10)() * biomes.length)].id,
      side = Math.floor(rng() * 4),
      entry = edgeArea(w, h, side, rng, 8 + d.fleetLimit * 2, 8 + d.fleetLimit),
      center = (r) => ({ x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y + r.height / 2) }),
      locations = [];
    const baseTerrain = ["snow", "desert"].includes(biome) ? biome : "plain";
    map.tiles = Array.from({length: h}, () => Array(w).fill(baseTerrain));
    // Opposite edges keep the two shared entry pads apart. The remaining
    // two edges each provide one extraction pad, with clearance from entries.
    const entries = [entry, edgeArea(w, h, side ^ 1, rng, entry.width, entry.height)];
    const extractions = [];
    for (const exitSide of (side < 2 ? [2, 3] : [0, 1])) {
      const candidates = [];
      for (let offset = 3; offset <= (exitSide < 2 ? h : w) - 9; offset++) {
        const area = { x: exitSide < 2 ? (exitSide === 0 ? 0 : w - 6) : offset,
          y: exitSide < 2 ? offset : (exitSide === 2 ? 0 : h - 6), width: 6, height: 6 };
        if ([...entries, ...extractions].every(other => area.x + area.width + 2 <= other.x ||
          other.x + other.width + 2 <= area.x || area.y + area.height + 2 <= other.y ||
          other.y + other.height + 2 <= area.y)) candidates.push(area);
      }
      if (!candidates.length) throw Error("无法生成合约撤离区域");
      extractions.push(candidates[Math.floor(rng() * candidates.length)]);
    }
    const extraction = extractions[0];
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
    return compactMap(map);
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
  function factionPairs(G, era) {
    const factions = factionsForEra(G, era);
    return factions.flatMap(enemyFaction => factions.filter(f => f !== enemyFaction)
      .map(alliedFaction => ({enemyFaction, alliedFaction}))).concat({enemyFaction:noAlliesFaction,alliedFaction:noAlliesFaction});
  }
  function alliedFaction(G, settings) {
    if (noAllies(settings)) return noAlliesFaction;
    const available = factionsForEra(G, settings.sweepEra).filter(f => f !== settings.sweepFaction);
    return available.includes(settings.sweepAlliedFaction) ? settings.sweepAlliedFaction : available[0];
  }
  function defenseCoverage(G, unit, objective) {
    return G.cells(unit).some(cell => Math.abs(cell.x - objective.x) <= 2 && Math.abs(cell.y - objective.y) <= 2);
  }
  function pool(room, G) {
    if (noAllies(room.settings)) return enemyFactions(G,room.settings).flatMap(faction =>
      factionRoom(room,faction,()=>pool(room,G)));
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
          forces.aiKitAllowed(m) &&
          G.aiTechnologyAllows(m, faction) &&
          !(G.aiUnitBans?.sweep || []).includes(m.prefabId) &&
          !m.ship &&
          (!G.isFleetCarrier(m) || m.unitTags?.includes("MA")) &&
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
    if (forces.profile(room.settings)) {
      const allowed = new Set(candidates);
      return forces.pick(room.settings,G,rng,model => allowed.has(model));
    }
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
    const hullCosts=new Map();
    for (const model of eligible) hullCosts.set(model.prefabId,Math.max(hullCosts.get(model.prefabId)||0,model.cost));
    const ids=[...hullCosts.keys()],costs=[...hullCosts.values()];
    const maIds=new Set(eligible.filter(model=>model.unitTags?.includes("MA")).map(model=>model.prefabId));
    const ordinaryCosts=costs.filter((cost,index)=>!maIds.has(ids[index]));
    const referenceCosts=ordinaryCosts.length?ordinaryCosts:costs;
    const minimum=Math.min(...referenceCosts), span=Math.max(1,Math.max(...referenceCosts)-minimum);
    const weights=costs.map(cost=>1+Math.max(0,Math.min(1,(cost-minimum)/span))*(config(room.settings.sweepDifficulty).id+1));
    const maWeight=weights.reduce((sum,weight,index)=>sum+(maIds.has(ids[index])?weight:0),0);
    const ordinaryWeight=weights.reduce((sum,weight,index)=>sum+(maIds.has(ids[index])?0:weight),0);
    if (maWeight && ordinaryWeight) {
      // MA are rare encounters. They must not dominate merely because their
      // chassis COST is high; retain normal-unit quality and kit diversity.
      const scale=Math.min(.25,ordinaryWeight/(9*maWeight));
      for (let index=0;index<weights.length;index++) if(maIds.has(ids[index])) weights[index]*=scale;
    }
    let roll=rng()*weights.reduce((sum,weight)=>sum+weight,0);
    const id=ids.find((id,index)=>(roll-=weights[index])<0)||ids[ids.length-1],kits=eligible.filter(model=>model.prefabId===id);
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
    if (brain(room.game).fillSlots != null) return brain(room.game).fillSlots;
    const state = room.game.contract;
    const before = state.enemyBaseCount || 0;
    state.enemyBaseCount = before + count;
    const multiplier = forces.countScale(room.settings.sweepDifficulty) * forces.difficultyScale(room.settings.sweepDifficulty) * 1.1 * ordinaryForceScale[config(room.settings.sweepDifficulty).id - 1] *
      (1 + 0.25 * Math.max(0, state.players - 1));
    return Math.round(state.enemyBaseCount * multiplier) - Math.round(before * multiplier);
  }
  function reinforcementCount(room, count, objectiveId = null) {
    const state = room.game.contract;
    const available = reinforcementSlots(room, objectiveId);
    if (!available) return 0;
    const before = state.reinforcementBaseCount || 0;
    state.reinforcementBaseCount = before + count;
    const multiplier = 0.75 * forces.countScale(room.settings.sweepDifficulty) * forces.difficultyScale(room.settings.sweepDifficulty) * 1.1 * ordinaryForceScale[config(room.settings.sweepDifficulty).id - 1] *
      (1 + 0.25 * Math.max(0, state.players - 1));
    return Math.min(available, Math.round((before + count) * multiplier) - Math.round(before * multiplier));
  }
  function initialEnemyTarget(room) {
    const state = room.game.contract;
    const scale = (1 + .25 * Math.max(0, state.players - 1)) * (state.noAllies ? 1.25 : 1);
    return Math.round(config(room.settings.sweepDifficulty).initialEnemyCount * scale / 3) * 3;
  }
  function reinforcementSlots(room, objectiveId = null) {
    // Event garrisons, scripted targets and event reinforcements have separate budgets.
    if (objectiveId) return Infinity;
    const game = room.game;
    const alive = game.units.filter(unit => unit.team > 0 && unit.hp > 0 &&
      !unit.contractExtracted && !unit.facility && !unit.contractObjectiveId).length;
    return Math.max(0, Math.floor(initialEnemyTarget(room) * 1.5) - alive);
  }
  function normalizeInitialEnemies(room, G) {
    const game = room.game, state = game.contract, b = brain(game);
    const scripted = new Set(state.objectives.filter(o => o.contactTaskId).map(o => o.id));
    const eligible = () => game.units.filter(u => u.team > 0 && !u.facility &&
      !G.modelOf(u).facility && !scripted.has(u.contractObjectiveId));
    const target = initialEnemyTarget(room);
    let excess = eligible().length - target;
    // Remove complete squads, taking the largest ordinary garrison first.
    while (excess > 0) {
      const candidates = b.groups.filter(g => !scripted.has(g.objectiveId) && g.ids.length <= excess &&
        g.ids.every(id => eligible().some(u => u.id === id)) &&
        (!g.objectiveId || state.objectives.find(o => o.id === g.objectiveId)?.type !== "command" ||
          eligible().filter(u => u.contractObjectiveId === g.objectiveId).length > g.ids.length));
      candidates.sort((a,c) => eligible().filter(u => u.contractObjectiveId === c.objectiveId).length -
        eligible().filter(u => u.contractObjectiveId === a.objectiveId).length);
      const squad = candidates[0];
      if (!squad) break;
      const removed = new Set(squad.ids);
      game.units = game.units.filter(u => !removed.has(u.id));
      b.groups.splice(b.groups.indexOf(squad), 1);
      for (const id of removed) b.health.delete(id);
      for (const objective of state.objectives)
        if (objective.targets) objective.targets = objective.targets.filter(id => !removed.has(id));
      excess -= removed.size;
    }
    try {
      for (let attempt = 0; eligible().length < target && attempt < 30; attempt++) {
        b.fillSlots = target - eligible().length;
        patrol(room, G, edge(room, true), b.fillSlots);
      }
    } finally { delete b.fillSlots; }
    if (eligible().length !== target) throw Error("Contract initial enemy quota could not be filled");
  }
  function enemies(room, G, seed) {
    if (noAllies(room.settings)) return factionRoom(room,enemyFactions(G,room.settings)[0],()=>enemies(room,G,seed));
    const rng = random(seed);
    return Array.from({ length: 2 }, () => {
      const m = pick(room, G, rng);
      return { unitId: m.prefabId, kitId: m.kitId };
    });
  }
  function enemyLimits() {
    return { costLimit: 99999, unitCostLimit: 99999 };
  }
  function enemyRestrictions(room, G) {
    return {
      requiresCarriers: false,
      ignoreDevelopment: true,
      aiTechnologyOnly: true,
      unitCostLimit: Infinity,
      characterFaction: noAllies(room.settings) ? factionsForEra(G,room.settings.sweepEra)[0] : room.settings.sweepFaction,
      aiAllowedEras: [room.settings.sweepEra],
      aiBannedUnits: [...(G?.aiUnitBans?.sweep || [])],
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
  function canExtract(game, G, actor, seat, members) {
    return (
      !!game?.contract &&
      !!actor &&
      actor.hp > 0 &&
      !actor.contractExtracted &&
      (G.ownerOf(actor) === seat || (members && G.isSeatUnattended(members, G.ownerOf(actor)) &&
        G.canControlUnit({}, members, seat, actor))) &&
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
        (u.team === team || (game.contract?.noAllies && team===1 && u.team>0)) && G.onMap(u) && G.cells(u).some((cell) => distance(cell, point) <= radius),
    );
  }
  function spawn(room, G, model, point, elite = false, reinforcement = false, team = 1) {
    if (team === 1 && room.game.contract.noAllies) {
      const factions=room.game.contract.enemyFactions;
      const faction=room.settings.sweepFaction === noAlliesFaction ? model.faction : room.settings.sweepFaction;
      team=Math.max(0,factions.indexOf(faction))+1;
    }
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
    if (team > 0) { u.contractEnemy = true; u.contractFaction=room.game.contract.enemyFactions?.[team-1] || room.settings.sweepFaction; }
    else {
      u.contractAlly = true;
      u.missionAutonomous = true;
      u.missionGuest = true;
    }
    if (reinforcement) u.contractReinforcement = true;
    if (team > 0 && !model.facility) assignEnemyPilot(room, G, u, model, game.seed + serial, elite);
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
  function enemyPilotGrade(difficulty, roll = 1) {
    const level = config(difficulty).id;
    if (level < 5) return null;
    const eliteWeight = (level === 5 ? .05 : .1) * 1.15;
    const veteranWeight = (level === 5 ? .2 : .3) * 1.15;
    const total = (level === 5 ? .75 : .6) + eliteWeight + veteranWeight;
    const eliteChance = eliteWeight / total, veteranChance = veteranWeight / total;
    return roll < eliteChance ? "elite" : roll < eliteChance + veteranChance ? "veteran" : null;
  }
  function assignEnemyPilot(room, G, unit, model, seed, elite = false) {
    // Mix adjacent spawn seeds so nearby squad members roll independently.
    let mixed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
    const roll = ((mixed ^ (mixed >>> 15)) >>> 0) / 4294967296;
    const grade = elite ? "elite" : enemyPilotGrade(room.settings.sweepDifficulty, roll);
    unit.pilot = {...unit.pilot, genericGrade: grade || undefined,
      ...(grade ? G.pilots.rollGrade(grade, seed, model) : G.pilots.roll(null, seed, 1, 0, model))};
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
    const first=room.game.units.find(u=>u.id===ids[0]);
    const faction=first?.contractFaction;
    if(room.game.contract.noAllies && role!=="guard") {
      const sites=room.game.contract.objectives.filter(o=>o.enemyFaction===faction);
      const site=sites.sort((a,b)=>distance(a,home)-distance(b,home))[0];
      if(site) home=site;
    }
    const b = brain(room.game),
      entry = {
        ids,
        home: { ...home },
        role,
        objectiveId,
        faction,
        alerted: false,
        goal: null,
      };
    b.groups.push(entry);
    for (const id of ids) {
      const u = room.game.units.find((u) => u.id === id);
      if (u) {
        if (objectiveId) u.contractObjectiveId = objectiveId;
        b.health.set(id, u.hp);
      }
    }
    return entry;
  }
  function patrol(room, G, point, count, elite = false, role = "patrol", objectiveId = null, reinforcement = false) {
    if (noAllies(room.settings)) {
      const state=room.game.contract;
      const faction=state.objectives.find(o=>o.id===objectiveId)?.enemyFaction || patrolFaction(room,G,point);
      // A single shared stream, with one extra patrol wave per ten normal waves.
      const before=state.patrolBaseWaves || 0;
      const waves=brain(room.game).fillSlots != null ? 1 : role==="patrol" ? Math.floor((before+1)*1.1+1e-9)-Math.floor(before*1.1+1e-9) : 1;
      if(role==="patrol") state.patrolBaseWaves=before+1;
      const home=state.objectives.filter(o=>o.enemyFaction===faction).sort((a,b)=>distance(a,point)-distance(b,point))[0];
      const spawnPoint=role==="patrol" && !reinforcement && home ? {x:home.x+7,y:home.y+3} : point;
      return factionRoom(room,faction,()=>Array.from({length:waves},()=>patrol(room,G,spawnPoint,count,elite,role,objectiveId,reinforcement)).flat());
    }
    const profile = forces.profile(room.settings);
    if (profile && role !== "guard")
      return budgetPatrol(room,G,point,profile.waves["factory.first"],elite,role,objectiveId,reinforcement);
    if (reinforcement && !reinforcementSlots(room, objectiveId)) return [];
    const state = room.game.contract,
      rng = random(state.seed + ++state.wave * 1979),
      ids = [];
    // Initial garrisons keep their full strength; later waves share a live-unit cap.
    const total = reinforcement ? reinforcementCount(room, count, objectiveId) : scaledCount(room, count);
    let squadModel;
    for (let i = 0; i < total; i++) {
      if (i % 3 === 0) squadModel = pick(room, G, rng);
      const u = spawn(room, G, squadModel, point, elite, reinforcement);
      if (u) ids.push(u.id);
    }
    groupSquads(room, G, ids, point, role, objectiveId);
    return ids;
  }
  function queueAirborne(room,objectiveId,entries){
    const b=brain(room.game),state=room.game.contract;
    b.airborneWaves ||= [];b.dropLastTurn ||= {};b.dropDirections ||= {};
    let due=Math.max(state.turn,(b.dropLastTurn[objectiveId]??-1)+1,...b.airborneWaves.filter(w=>w.objectiveId===objectiveId).map(w=>w.due+1));
    for(const entry of entries){const side=b.dropDirections[objectiveId]||0;b.dropDirections[objectiveId]=side+1;
      b.airborneWaves.push({...entry,objectiveId,faction:room.settings.sweepFaction,due:due++,side:side%4});}
  }
  function processAirborne(room,G,log){
    const game=room.game,b=brain(game),state=game.contract;
    if(game.team!==0 || !b.airborneWaves?.length)return;
    const pending=[];
    for(const wave of b.airborneWaves){
      const objective=state.objectives.find(o=>o.id===wave.objectiveId);
      if(!objective || ["completed","failed"].includes(objective.status))continue;
      if(wave.due>state.turn || b.dropLastTurn[wave.objectiveId]===state.turn){pending.push(wave);continue;}
      const [dx,dy]=[[1,0],[0,-1],[-1,0],[0,1]][wave.side],point={x:Math.max(1,Math.min(mapWidth(game)-2,objective.x+dx*5)),y:Math.max(1,Math.min(mapHeight(game)-2,objective.y+dy*5))};
      const ids=factionRoom(room,wave.faction,()=>{
        if(!wave.formation)return patrol(room,G,point,wave.count,false,"pursuit",wave.objectiveId,true);
        const spawned=[];for(const model of wave.formation.models){const u=spawn(room,G,model,point,false,true);if(!u)break;spawned.push(u.id);}
        if(spawned.length!==wave.formation.models.length){game.units=game.units.filter(u=>!spawned.includes(u.id));return [];}
        groupSquads(room,G,spawned,point,"pursuit",wave.objectiveId);return spawned;
      });
      b.dropLastTurn[wave.objectiveId]=state.turn;
      for(const id of ids){const u=game.units.find(u=>u.id===id);u.airdropRound=game.round;u.airdropDirection=wave.side;}
      for(const group of b.groups.filter(group=>group.ids.some(id=>ids.includes(id)))){
        group.goal={x:objective.x,y:objective.y};if(wave.formation)group.budget=wave.formation.budget;
      }
      if(ids.length)log("[合约模式] 敌方空降增援分批抵达："+objective.name+"（"+["东","北","西","南"][wave.side]+"侧）。");
    }
    b.airborneWaves=pending;
  }
  function budgetPatrol(room,G,point,amount,elite=false,role="guard",objectiveId=null,reinforcement=false,airborne=false) {
    const state = room.game.contract;
    const slots = reinforcement ? reinforcementSlots(room, objectiveId) : (brain(room.game).fillSlots ?? Infinity);
    if (!slots) return [];
    const rng = random(state.seed + ++state.wave * 1979);
    const budget = brain(room.game).fillSlots != null ? Infinity : forces.budget(room,amount,reinforcement);
    const formations = forces.selectCount(room, forces.draw(room.settings,G,rng,budget,slots), reinforcement), ids = [];
    if(airborne){queueAirborne(room,objectiveId,formations.map(formation=>({formation})));return [];}
    for (const formation of formations) {
      const spawned = [];
      for (const model of formation.models) {
        const unit = spawn(room,G,model,point,elite,reinforcement);
        if (!unit) break;
        if (airborne) unit.airdropRound = room.game.round;
        spawned.push(unit.id);
      }
      // A blocked placement must not leave half of a configured formation.
      if (spawned.length !== formation.models.length) {
        room.game.units = room.game.units.filter(u => !spawned.includes(u.id));
        continue;
      }
      groupSquads(room,G,spawned,point,role,objectiveId);
      for (const force of brain(room.game).groups.filter(f=>f.ids.some(id=>spawned.includes(id)))) {
        force.budget = formation.budget;
        if (role === "pursuit") force.goal = {...point};
      }
      ids.push(...spawned);
    }
    return ids;
  }
  function groupSquads(room, G, ids, point, role = "patrol", objectiveId = null) {
    const game = room.game, squads = [];
    for (const id of ids) {
      const unit = game.units.find(u => u.id === id);
      if (!unit) continue;
      const squad = squads.find(members => members.length < 3 &&
        G.squadJoinTarget(game, unit, members[0].x, members[0].y, [unit]) === members[0]);
      if (squad) {
        const target = squad[0];
        G.joinSquad(game, unit, target, [unit]);
        Object.assign(unit, {x: target.x, y: target.y});
        squad.push(unit);
      } else squads.push([unit]);
    }
    for (const members of squads) group(room, members.map(u => u.id), point, role, objectiveId);
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
  function reinforcements(room, G, objective, squads = 1, transport = false, airborne = false, trigger = "first") {
    if (noAllies(room.settings)) return factionRoom(room,objective.enemyFaction || patrolFaction(room,G,objective),
      ()=>reinforcements(room,G,objective,squads,transport,airborne,trigger));
    const profile = forces.profile(room.settings);
    if (profile) {
      if (transport) return transportWave(room,G,objective,profile.transports);
      const phase = objective.type === "capture" ? (airborne ? "airdrop" : "edge") :
        objective.type === "upload" ? "airdrop" : trigger;
      const amount = profile.waves[objective.type+"."+phase];
      if (!amount) throw Error("合约事件增援预算缺失："+objective.type+"."+phase);
      const point = airborne ? {x:objective.x+5,y:objective.y} : edge(room);
      const ids = budgetPatrol(room,G,point,amount,false,"pursuit",objective.id,true,airborne);
      for (const force of brain(room.game).groups.filter(f=>f.ids.some(id=>ids.includes(id))))
        force.goal = {x:objective.x,y:objective.y};
      return ids.length;
    }
    const game = room.game,
      b = brain(game);
    const before = game.units.length;
    if(airborne && !transport){queueAirborne(room,objective.id,Array.from({length:squads},()=>({count:3})));return 0;}
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
      if (reinforcementSlots(room, objective.id) < 2) continue;
      const waveCount = Math.max(2, reinforcementCount(room, 4, objective.id));
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
      assignEnemyPilot(room, G, carrier, {
        ...G.modelOf(carrier),
        faction: room.settings.sweepFaction,
      }, game.seed + game.contract.serial);
      const compatible = pool(room, G).filter(
        (m) =>
          !m.ship &&
          m.transport?.loadTags?.length &&
          (m.transport.slotCost || 1) <= 2 &&
          G.modelOf(carrier).hangars.some((h) =>
            G.hangarAllowsModel(h, m),
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
            assignEnemyPilot(room, G, escort, {
              ...G.modelOf(escort), faction: room.settings.sweepFaction,
            }, game.seed + game.contract.serial);
            ids.push(escort.id);
            continue;
          }
          carrier = spawn(room, G, G.models[name + "__standard"], point, false, true);
          if (!carrier) throw Error("追击运输单位没有可用入场位置");
          assignEnemyPilot(room, G, carrier, {
            ...G.modelOf(carrier), faction: room.settings.sweepFaction,
          }, game.seed + game.contract.serial);
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
  function transportWave(room,G,objective,definition) {
    const game = room.game, rng = brain(game).rng, before = game.units.length;
    const model = G.models[definition.unitId+"__standard"];
    if (!model) throw Error("合约追击运输机不可用："+definition.unitId);
    for (const amount of definition.budgets) {
      const slots = reinforcementSlots(room, objective.id);
      if (slots < 4) break;
      const point = edge(room), hangars = model.hangars || [];
      const capacity = hangars.reduce((sum,h)=>sum+h.capacity,0);
      const allows = m => !!m.transport?.loadTags?.length && hangars.some(h=>G.hangarAllowsModel(h,m));
      const formations = forces.selectCount(room, forces.draw(room.settings,G,rng,forces.budget(room,amount,true),slots-1,allows,capacity), true);
      if (!formations.length) continue;
      const carrier = spawn(room,G,model,point,false,true);
      if (!carrier) continue;
      const ids = [carrier.id];
      let failed = false;
      for (const formation of formations) for (const cargoModel of formation.models) {
        const cargo = spawn(room,G,cargoModel,point,false,true);
        const hangar = cargo && G.hangars.of(carrier).find(h=>G.hangars.canLoad(game,cargo,carrier,h.id));
        if (!hangar) {if(cargo) ids.push(cargo.id); failed=true;break;}
        cargo.embarked = {carrierId:carrier.id,hangarId:hangar.id};
        ids.push(cargo.id);
      }
      if (failed) {game.units=game.units.filter(u=>!ids.includes(u.id));continue;}
      G.hangars.sync(game);
      const force = group(room,ids,point,"pursuit",objective.id);
      force.goal = {x:objective.x,y:objective.y};
    }
    return game.units.length-before;
  }
  function alertNearby(game, point, objectiveId, radius = 18) {
    for (const force of brain(game).groups) {
      if (game.contract.noAllies && force.faction !== game.contract.objectives.find(o=>o.id===objectiveId)?.enemyFaction) continue;
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
    if (actor.team === 0) return null;
    const b = brain(game),
      force = b.groups.find((f) => f.ids.includes(actor.id));
    if (!force) return null;
    const members = force.ids
      .map((id) => game.units.find((u) => u.id === id))
      .filter((u) => u && G.onMap(u));
    const targets = game.units.filter(u => u.team !== actor.team && G.onMap(u) && (!u.contractAlly ||
      game.contract.objectives.some(o => o.id === u.contractObjective && o.status !== "available")));
    // Awareness belongs to this formation, not an omniscient allied observer.
    const query = { observers: members };
    const contact = targets.filter(
      (t) =>
        G.sensors.visible({ ...game, fogMode: "full", intel: undefined }, actor.team, t, query) ||
        G.sensors.detected({ ...game, fogMode: "full", intel: undefined }, actor.team, t, query),
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
        guard = force.role === "guard" || game.contract.noAllies;
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
    const faction = alliedFaction(G, room.settings);
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
      for (const dx of [-2,2]) add(G.models.Facility_MG__standard, {x:objective.x+dx,y:objective.y-2}, "mg");
    }
    for (let i=0;i<3;i++) {
      const model = pick(friendlyRoom,G,rng,candidates.length ? candidates : pool(friendlyRoom,G));
      const u = add(model,{x:objective.x-2+i*2,y:objective.y+2});
    }
  }
  function initialize(room, G, seed, log = () => {}) {
    const game = room.game,
      map = G.getMap(game.mapId),
      d = scenarioConfig(room.settings),
      rng = random(seed),
      players = room.seats.filter((p) => p && !p.bot && G.seatTeam(p.seat) === 0).length,
      { entry, extraction, locations } = game.contractLayout;
    game.contract = {
      seed,
      noAllies:noAllies(room.settings),
      enemyFactions:enemyFactions(G,room.settings),
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
      types = kinds.filter(kind=>!state.noAllies || kind.type!=="defend"),
      initial = game.units.filter((u) => u.team === 1);
    // Seats provide AI ownership, not an extra full army per human participant.
    const planned = forces.profile(room.settings);
    const initialCount = planned || state.noAllies ? 0 : scaledCount(room, 2);
    for (const u of initial.splice(initialCount)) game.units.splice(game.units.indexOf(u), 1);
    for (const [index,u] of initial.entries()) assignEnemyPilot(room,G,u,G.modelOf(u),game.seed+index);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    const special = contacts.specialTasks(room).flatMap(task => task.stages?.length
      ? task.stages.map(stage => ({...task, ...stage})) : [task]);
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
          required: task?.eventRequired ?? (["capture","defend"].includes(definition.type) ? 5 : definition.type === "upload" ? 3 : 1),
          targets: [],
          protected: [],
          destroyed: [],
          ...(task ? {contactTaskId:task.id} : {}),
        };
      state.objectives.push(objective);
      const previousSettings=room.settings;
      if(state.noAllies) {
        objective.enemyFaction=state.enemyFactions.includes(task?.eventFaction) ? task.eventFaction :
          task?.eventFaction ? (task.eventFaction==="EFSF" ? state.enemyFactions[0] : state.enemyFactions.at(-1)) : state.enemyFactions[i % state.enemyFactions.length];
        objective.enemyTeam=state.enemyFactions.indexOf(objective.enemyFaction)+1;
        room.settings={...room.settings,sweepFaction:objective.enemyFaction};
      }
      const objectiveProfile=forces.profile(room.settings);
      try {
      for (let y = Math.max(0, point.y - 6); y <= Math.min(map.height - 1, point.y + 6); y++)
        for (let x = Math.max(0, point.x - 6); x <= Math.min(map.width - 1, point.x + 6); x++)
          game.tiles[y][x] = "plain";
      if (definition.type === "defend") friendlyGarrison(room,G,objective);
      if (["factory","radar","enemybase"].includes(definition.type)) {
        const count = ["radar","enemybase"].includes(definition.type) ? 1 : task?.targetCount || (task?.id === "efsf-5" ? 4 : 2 + Math.floor((d.id - 1) / 4));
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
      const count = task?.targetUnits?.length || task?.guardCount || (task?.id === "efsf-5" ? 12 : 3 + Math.floor((d.id - 1) / 3));
      const guards = (definition.type === "defend" || (!task?.guardBudget && (["efsf-3","efsf-4"].includes(task?.id) || task?.targetUnit))) ? [] : objectiveProfile && (!task || task.guardBudget) ? budgetPatrol(
        room,G,{x:point.x+3,y:point.y+2},task?.guardBudget ?? objectiveProfile.garrisons[definition.type],false,"guard",objective.id
      ) : patrol(
        room,
        G,
        { x: point.x + (definition.type === "defend" ? 8 : 3), y: point.y + 2 },
        count,
        false,
        "guard",
        objective.id,
      );
      if(["efsf-3","efsf-4"].includes(task?.id) || task?.targetUnit) {
        const prefab=G.catalog.prefabs.find(p=>p.id===(task.targetUnit || (task.id==="efsf-3"?"RGM_79_G":"MS_06F")));
        const targets=task.targetUnits || Array.from({length:task.targetCount || task.targetKits?.length || (task.id==="efsf-3"?3:12)},(_,j)=>
          ({unitId:prefab.id,kitId:task.targetKits?.[j] || prefab.weaponKits[0].id}));
        const scriptedIds=[];
        for(const [j,target] of targets.entries()){
          const model=target.kitId ? G.models[target.unitId+"__"+target.kitId] :
            Object.values(G.models).find(m=>m.prefabId===target.unitId && !m.formOnly && forces.aiKitAllowed(m));
          if (!model || !forces.aiKitAllowed(model)) throw Error("联络任务目标没有可用的非核弹套件："+target.unitId);
          const u=spawn(room,G,model,{x:point.x+3,y:point.y+j});
          if(!u)throw Error("无法放置联络任务小队");
          if(task.id==="efsf-3" || task.targetPilotGrade || task.targetLeaderPilot) {
            const leader = j === 0 ? task.targetLeaderPilot : null;
            const grade = leader?.grade || task.targetPilotGrade || (task.id==="efsf-3" ? "veteran" : null);
            if(grade) u.pilot={...u.pilot,...G.pilots.rollGrade(grade,game.seed+state.serial,model),genericGrade:grade};
            u.pilot.name+=" · "+(leader?.name || task.targetName || (task.id==="efsf-7"?"雷纳斯卫队":"文件护卫"))+(j+1);
            if (leader?.dialogue) u.pilot.missionDialogue = G.pilots.normalizeDialogue(leader.dialogue);
          }
          guards.push(u.id);
          scriptedIds.push(u.id);
        }
        groupSquads(room,G,scriptedIds,point,"guard",objective.id);
      }
      if(task?.id === "efsf-5" || task?.turrets)for(let j=0;j<(task.turrets || 4);j++){
        const u=spawn(room,G,G.models.Facility_MG__standard,{x:point.x+(j%2?5:-5),y:point.y+(j<2?-4:4)});
        if(!u)throw Error("无法放置前线营地炮塔");u.facility={id:u.id,type:"mg",level:1};
      }
      if(task?.kind === "salvage") {
        const id=task.wreckUnit || (task.id==="efsf-2"?"Medea":"Type74");
        const p=G.catalog.prefabs.find(p=>p.id===id);
        objective.wreckModel = id+"__"+p.weaponKits[0].id;
      }
      if (definition.type === "command") objective.targets = guards.slice();
      } finally { room.settings=previousSettings; }
    }
    // Initial bot formations roam independently rather than gathering or rushing players.
    for (let i = 0; i < initial.length; i += 3) {
      const members = initial.slice(i, i + 3),
        point = edge(room, true);
      for (const u of members) {
        u.deployed = true;
        u.deploymentStaged = false;
        for (let r = 0; r < 10; r++) {
          if (G.fits(game, u, point.x + r, point.y, 180)) {
            Object.assign(u, { x: point.x + r, y: point.y });
            break;
          }
        }
      }
      groupSquads(
        room, G,
        members.map((u) => u.id),
        point,
      );
    }
    for (let i = 0; i < 1 + Math.floor((d.id - 1) / 3); i++) patrol(room, G, edge(room, true), 3);
    normalizeInitialEnemies(room, G);
    // Other initial patrols/garrisons must not accidentally spawn in a friendly
    // defense area either. Keep their units and relocate only overlapping ones.
    const defenses = state.objectives.filter(o => o.type === "defend");
    for (const unit of game.units.filter(u => u.team === 1)) {
      if (!defenses.some(o => defenseCoverage(G, unit, o))) continue;
      const origin = {x:unit.x, y:unit.y}, members = G.squadMembers(game,unit);
      let placed = false;
      for (let radius = 3; radius < Math.max(map.width, map.height) && !placed; radius++)
        for (let dy = -radius; dy <= radius && !placed; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx),Math.abs(dy)) !== radius) continue;
            const x=origin.x+dx,y=origin.y+dy;
            if (!members.every(member => G.fits(game,member,x,y,member.facing) &&
                !defenses.some(o => defenseCoverage(G,{...member,x,y},o)))) continue;
            for (const member of members) Object.assign(member,{x,y});
            placed=true;break;
          }
      if (!placed) throw Error("无法避开友军据点放置初始敌军");
    }
    G.hangars.sync(game);
    for (const u of game.units.filter((u) => u.team > 0)) {
      u.deployed = true;
      u.deploymentStaged = false;
    }
    for (let seat = 1; seat < game.deployment.length; seat += 2) game.deployment[seat] = true;
    log("[合约模式] 事件 " + d.events + " 项；驻守部队在事件附近巡逻。");
  }
  function reward(room, G, experienceMultiplier = 1) {
    const state = room.game?.contract;
    if (!state) return { money: 0, supplies: 0, technology: 0, experience: 0, inventory: {} };
    const completed = state.objectives.filter((o) => o.status === "completed" && !o.contactTaskId).length,
      d = config(room.settings.sweepDifficulty).id,
      era = Math.pow(1.25, Math.max(0, G.technologyWeight(room.settings.sweepEra) - 1)),
      economy = typeof BattleEconomy !== "undefined" ? BattleEconomy : require("./battle-economy.js"),
      share = Math.min(1, completed / Math.max(1, state.objectives.filter(o => !o.contactTaskId).length)),
      [money, supplies] = completionRewards[d - 1],
      bonus = 1.25 * [1, 1, 1.2, 1.3, 1.6, 1.9][d - 1] * (state.noAllies ? 1.25 : 1);
    return {
      // Settlement applies its multiplier once; the table already includes it.
      money: money * share * era * bonus / economy.completionRewardMultiplier,
      supplies: supplies * share * era * bonus / economy.completionRewardMultiplier,
      experience: Math.max(0, Math.round([500, 1000, 1500, 3000, 4000, 5000][d - 1] * share * bonus * .5 * experienceMultiplier / 50) * 50),
      technology: completed * 125 * era * (1 + (d - 1) * 0.25) * bonus,
      inventory: {},
    };
  }
  function recordDefeat(room,G,from,to,model,weapon = null) {
    const state=room.game.contract;
    if(to.contactKillRecorded)return;
    to.contactKillRecorded=true;
    if(!from || from.team!==0 || to.team===0)return;
    const owner=room.seats[G.ownerOf(from)];
    if(!owner || owner.bot)return;
    to.contractPlayerDefeat=true;
    state.contactKills ||= [];
    if(!state.contactKills.includes(to.id) && model.unitTags?.includes("MS") && (model.availableFactions||[model.faction]).includes("ZEON"))state.contactKills.push(to.id);
    state.contactKillRecords ||= [];
    if(model.unitTags?.includes("MS") && !state.contactKillRecords.some(record=>record.id===to.id))
      state.contactKillRecords.push({id:to.id,factions:model.availableFactions||[model.faction],
        attackerUnit:G.modelOf(from).prefabId,attackerPlugins:[...(from.plugins || [])],
        melee:weapon?.type==="melee",
        artillery:!!weapon && (weapon.slot==="skill" || !!weapon.special) && weaponClasses.classify(weapon)==="mortar"});
    if(/^RX_80PR(?:_|$)/.test(G.modelOf(from).prefabId))to.contactPaleKill=true;
    to.contactAttackerUnit = G.modelOf(from).prefabId;
  }
  function commissionProgress(room,G,player) {
    const state=room.game.contract;if(!state)return [];
    const escaped=room.game.units.some(u=>G.ownerOf(u)===player.seat&&u.hp>0&&u.contractExtracted);
    return (state.commissions?.[player.id]||[]).flatMap(id=>{
      const task=contacts.byId.get(id);if(!contacts.eligible(task,room.settings))return [];
      if(task.requiresExtraction && !escaped)return [];
      if(task.kind==="all_events") return room.game.units.some(u=>G.ownerOf(u)===player.seat && u.hp>0 && u.contractExtracted && u.contractAllEventsAtExtraction) && state.objectives.length > 0 && state.objectives.every(o=>o.status==="completed") ? [{id,amount:1}] : [];
      if(task.kind==="kills")return [{id,amount:(state.contactKillRecords||[]).filter(record=>
        (task.enemyFaction==="NONE" || record.factions.includes(task.enemyFaction||"ZEON")) &&
        (!task.requiredAttackerUnit || record.attackerUnit===task.requiredAttackerUnit) &&
        (!task.requiredAttackerPlugin || record.attackerPlugins?.includes(task.requiredAttackerPlugin)) &&
        (task.killMethod!=="artillery" || record.artillery) && (task.killMethod!=="melee" || record.melee)).length}];
      const objectives=state.objectives.filter(o=>o.contactTaskId===id),o=objectives[0];
      if(id==="efsf-5" || task.requiredAttackerUnit){
        const amount=o?.targets.filter(id=>{const u=room.game.units.find(u=>u.id===id);return u?.hp<=0&&
          (task.requiredAttackerUnit ? u.contactAttackerUnit===task.requiredAttackerUnit : u.contactPaleKill);}).length||0;
        return amount ? [{id,amount}] : [];
      }
      if(objectives.length!==(task.stages?.length || 1) || objectives.some(o=>o.status!=="completed") ||
        (task.kind==="salvage"&&!escaped))return [];
      return [{id,amount:1}];
    });
  }
  // Absolute, read-only progress for this recipient. Settlement remains the
  // sole persistent credit, so repeated snapshots cannot award progress twice.
  function commissionStatus(room, G, player) {
    if (!player || player.bot || player.seat == null) return [];
    const deltas = new Map(commissionProgress(room, G, player).map(entry => [entry.id, entry.amount]));
    return contacts.normalize(player.contactTasks).map(entry => {
      if (entry.status !== "accepted") return entry;
      const task = contacts.byId.get(entry.id),
        progress = Math.min(task.required, entry.progress + (deltas.get(entry.id) || 0));
      return {...entry, progress, status: progress >= task.required ? "ready" : "accepted"};
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
    // Restored matches may still contain objectives generated by older builds.
    // Remove the retired rescue event and its NPCs before UI/progress checks.
    if (state?.objectives.some(o => o.type === "rescue")) {
      const removed = state.objectives.filter(o => o.type === "rescue"),
        ids = new Set(removed.map(o => o.id)),
        protectedIds = new Set(removed.flatMap(o => o.protected || []));
      state.objectives = state.objectives.filter(o => !ids.has(o.id));
      state.allCompleted = state.objectives.length > 0 && state.objectives.every(o => o.status === "completed");
      state.cues = (state.cues || []).filter(c => !ids.has(c.objectiveId) && (c.type !== "all_completed" || state.allCompleted));
      for (const unit of game.units)
        if (unit.contractAlly && (protectedIds.has(unit.id) || ids.has(unit.contractObjective))) {
          unit.contractExtracted = true;
          unit.deploymentStaged = true;
          unit.acted = true;
          delete unit.plan;
          delete unit.pendingMove;
        }
    }
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
        if(state.noAllies && o.targets.some(id=>!game.units.find(u=>u.id===id)?.contractPlayerDefeat)) {
          failObjective(state,o);
          log("[合约模式] 事件目标被其他敌军击毁，不计入玩家战果："+o.name);
        } else {
          completeObjective(state, o);
          log("[合约模式] 完成事件：" + o.name);
        }
      }
      if (o.type === "radar" && o.status === "active" && !o.responseSent) {
        o.responseSent = true;
        reinforcements(room,G,o,squadCount(config(room.settings.sweepDifficulty).id),false,true);
        alertNearby(game,o,o.id);
      }
      if (["defend","upload"].includes(o.type)) {
        const pmc = (o.type === "defend"
          ? game.units.filter(u => u.team === 0 && G.onMap(u) && defenseCoverage(G,u,o))
          : near(game,G,o,0,1)).filter(u=>!u.contractAlly);
        if (o.type !== "upload") {
          const protectedAlive = game.units.some(u=>u.id===o.coreId && u.hp>0);
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
          reinforcements(room,G,o,squadCount(config(room.settings.sweepDifficulty).id),false,true,"followup");
        if (o.type === "defend" || (pmc.length && !near(game,G,o,1,1).length)) o.progress++;
        if (o.progress >= o.required) {
          completeObjective(state,o);
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
    processAirborne(room,G,log);
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
      if (!canExtract(game, G, actor, member.seat, [...room.members.values()])) throw Error("请选择撤离区内自己的未撤离单位");
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
        u.contractAllEventsAtExtraction = state.objectives.length > 0 && state.objectives.every(o=>o.status === "completed");
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
      difficulty: scenarioConfig(room.settings),
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
    commissionStatus,
    difficulties,
    biomes,
    covers,
    kinds,
    config,
    scenarioConfig,
    mapId,
    registerMaps,
    generateMap,
    visualMap,
    roomSettings,
    factionsForEra,
    factionPairs,
    alliedFaction,
    defenseCoverage,
    enemies,
    enemyLimits,
    enemyStage,
    enemyPilotGrade,
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
