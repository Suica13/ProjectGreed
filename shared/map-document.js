/* Portable TileMap document and editing operations, shared by the editor and importer. */
const MapDocument = (() => {
  "use strict";
  const format = "ProjectGreedTileMap";
  const terrains = {
    plain: { name: "普通", color: "#52626b" },
    water: { name: "水", color: "#346c99" },
    rock: { name: "山", color: "#73747a" },
    forest: { name: "林", color: "#39704f" },
    rubble: { name: "废墟", color: "#7c6963" },
    snow: { name: "雪地", color: "#d7e5ee" },
    desert: { name: "沙漠", color: "#c5a86d" },
    highland: { name: "高地（兼容）", color: "#93885e" },
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  function layer(doc, name = "图块图层") {
    return {
      id: uid("layer"),
      name,
      type: "tile",
      placement: "below",
      decorative: false,
      dynamic: false,
      visible: true,
      opacity: 1,
      data: Array(doc.width * doc.height).fill(null),
    };
  }
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }
  function setPlayers(doc, teams, playersPerTeam) {
    if (!integer(teams, 2, 8) || !integer(playersPerTeam, 1, 5))
      throw Error("队伍需为2–8队，每队1–5名玩家。");
    doc.maxTeams = teams;
    doc.playersPerTeam = playersPerTeam;
    doc.spawns = [];
    doc.deploymentAreas = [];
    // Teams occupy disjoint vertical strips; players within a team occupy separate rows.
    for (let position = 0; position < playersPerTeam; position++) {
      for (let team = 0; team < teams; team++) {
        const strip = Math.max(1, Math.floor(doc.width / teams));
        const width = Math.max(1, Math.min(10, strip));
        const x = teams === 2 ? (team ? doc.width - width : 0) : team * strip;
        const y = Math.floor((position * doc.height) / playersPerTeam);
        const height = Math.floor(((position + 1) * doc.height) / playersPerTeam) - y;
        doc.deploymentAreas.push({ x, y, width, height });
        doc.spawns.push({
          team,
          position: position + 1,
          x: x + Math.floor(width / 2),
          y: y + Math.floor(height / 2),
        });
      }
    }
  }
  function create(options = {}) {
    const doc = {
      format,
      version: 1,
      id: "custom_map",
      name: "新地图",
      description: "",
      width: 48,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      environment: "ground",
      defaultTerrain: "plain",
      maxTeams: 2,
      playersPerTeam: 1,
      supportedModes: ["regular", "quick"],
      seed: 1,
      tilesets: [],
      tiles: [],
      layers: [],
      rules: [],
      spawns: [],
      deploymentAreas: [],
      ...options,
    };
    doc.tiles = Object.entries(terrains).map(([terrain, info]) => ({
      id: "terrain_" + terrain,
      name: info.name,
      terrain,
      environment: doc.environment,
      color: info.color,
      decorative: false,
      dynamic: false,
    }));
    doc.layers = [layer(doc, "地形")];
    setPlayers(doc, doc.maxTeams, doc.playersPerTeam);
    return doc;
  }
  function snapshot(doc) {
    // Images are immutable strings. Share them across history, instead of cloning base64 repeatedly.
    return {
      ...doc,
      supportedModes: [...doc.supportedModes],
      tilesets: doc.tilesets.map((t) => ({ ...t })),
      tiles: doc.tiles.map((t) => ({ ...t })),
      layers: doc.layers.map((l) => ({
        ...l,
        data: l.data?.slice(),
        image: l.image && { ...l.image },
      })),
      spawns: doc.spawns.map((s) => ({ ...s })),
      deploymentAreas: doc.deploymentAreas.map((a) => ({ ...a })),
      rules: copy(doc.rules),
    };
  }
  function validate(doc) {
    if (!doc || doc.format !== format || doc.version !== 1) throw Error("不是受支持的地图工程。");
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(doc.id) ||
      doc.id === "constructor" ||
      typeof doc.name !== "string" ||
      !doc.name.trim()
    )
      throw Error("地图ID需以小写字母开头，仅含小写字母、数字、下划线；名称不能为空。");
    if (
      !integer(doc.width, 12, 128) ||
      !integer(doc.height, 9, 128) ||
      !integer(doc.tileWidth, 4, 512) ||
      !integer(doc.tileHeight, 4, 512)
    )
      throw Error("地图应为12–128列、9–128行；Tile尺寸应为4–512像素。");
    if (!["ground", "space"].includes(doc.environment) || !terrains[doc.defaultTerrain])
      throw Error("地图环境或默认地形无效。");
    if (!integer(doc.maxTeams, 2, 8) || !integer(doc.playersPerTeam, 1, 5))
      throw Error("玩家配置无效。");
    if (
      !Array.isArray(doc.supportedModes) ||
      !doc.supportedModes.length ||
      doc.supportedModes.some((m) => !["regular", "quick"].includes(m))
    )
      throw Error("至少启用一种有效对战模式。");
    if (!Number.isSafeInteger(doc.seed)) throw Error("随机种子必须为整数。");
    const arrays = [
      doc.tilesets,
      doc.tiles,
      doc.layers,
      doc.rules,
      doc.spawns,
      doc.deploymentAreas,
    ];
    if (
      arrays.some((a) => !Array.isArray(a)) ||
      doc.layers.length < 1 ||
      doc.layers.length > 32 ||
      doc.tiles.length > 16384 ||
      doc.tilesets.length > 32 ||
      doc.rules.length > 128
    )
      throw Error("地图结构或图层/图块数量无效。");
    const ids = (list) => {
      if (
        list.some((t) => typeof t.id !== "string" || !/^[\w-]{1,100}$/.test(t.id)) ||
        new Set(list.map((t) => t.id)).size !== list.length
      )
        throw Error("图块、规则或图层ID重复/无效。");
    };
    [doc.tilesets, doc.tiles, doc.layers, doc.rules].forEach(ids);
    const image = (value) => {
      if (
        typeof value !== "string" ||
        value.length > 48 * 1024 * 1024 + 64 ||
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
      )
        throw Error("图片必须嵌入为PNG/JPEG/WebP/GIF，单图不超过36MB。");
    };
    const sets = new Map(doc.tilesets.map((t) => [t.id, t]));
    const tiles = new Set(doc.tiles.map((t) => t.id));
    for (const set of doc.tilesets) {
      image(set.image);
      if (
        ![set.width, set.height].every((n) => integer(n, 1, 8192)) ||
        ![set.tileWidth, set.tileHeight].every((n) => integer(n, 4, 512)) ||
        !integer(set.margin, 0, 512) ||
        !integer(set.spacing, 0, 512)
      )
        throw Error("图集尺寸无效。");
    }
    for (const tile of doc.tiles) {
      if (
        !terrains[tile.terrain] ||
        !["ground", "space"].includes(tile.environment) ||
        !/^#[a-f0-9]{6}$/i.test(tile.color || "")
      )
        throw Error("图块属性无效：" + tile.id);
      if (tile.tilesetId) {
        const set = sets.get(tile.tilesetId);
        if (
          !set ||
          !integer(tile.x, 0, 8192) ||
          !integer(tile.y, 0, 8192) ||
          tile.x + set.tileWidth > set.width ||
          tile.y + set.tileHeight > set.height
        )
          throw Error("图块超出图集：" + tile.id);
      }
    }
    for (const l of doc.layers) {
      if (
        !["tile", "image"].includes(l.type) ||
        !["below", "above"].includes(l.placement) ||
        !Number.isFinite(l.opacity) ||
        l.opacity < 0 ||
        l.opacity > 1 ||
        typeof l.visible !== "boolean" ||
        typeof l.decorative !== "boolean"
      )
        throw Error("图层属性无效。");
      if (
        l.type === "tile" &&
        (!Array.isArray(l.data) ||
          l.data.length !== doc.width * doc.height ||
          l.data.some((id) => id !== null && !tiles.has(id)))
      )
        throw Error("图层包含未知Tile或尺寸不符。");
      if (l.type === "image") {
        image(l.image?.src);
        if (
          ![l.image.x, l.image.y, l.image.width, l.image.height].every(Number.isFinite) ||
          l.image.width <= 0 ||
          l.image.height <= 0
        )
          throw Error("整图图层的位置或尺寸无效。");
      }
    }
    for (const rule of doc.rules) {
      if (rule.type === "random") {
        if (
          !Array.isArray(rule.variants) ||
          !rule.variants.length ||
          rule.variants.length > 256 ||
          rule.variants.some(
            (v) => !tiles.has(v.tileId) || !Number.isFinite(v.weight) || v.weight <= 0,
          )
        )
          throw Error("随机规则需包含有效图块及正权重。");
      } else if (rule.type === "nine") {
        if (
          !Array.isArray(rule.tiles) ||
          rule.tiles.length !== 9 ||
          rule.tiles.some((id) => !tiles.has(id))
        )
          throw Error("九宫格规则必须包含9个有效Tile。");
      } else throw Error("未知图块规则。");
    }
    if (
      doc.spawns.length !== doc.maxTeams * doc.playersPerTeam ||
      doc.deploymentAreas.length !== doc.spawns.length
    )
      throw Error("出生地与部署区域数量必须匹配玩家人数。");
    for (const [i, spawn] of doc.spawns.entries()) {
      const a = doc.deploymentAreas[i];
      if (
        spawn.team !== i % doc.maxTeams ||
        spawn.position !== Math.floor(i / doc.maxTeams) + 1 ||
        !integer(spawn.x, 0, doc.width - 1) ||
        !integer(spawn.y, 0, doc.height - 1) ||
        !a ||
        !integer(a.x, 0, doc.width - 1) ||
        !integer(a.y, 0, doc.height - 1) ||
        !integer(a.width, 1, doc.width - a.x) ||
        !integer(a.height, 1, doc.height - a.y)
      )
        throw Error("出生地或部署区域超出地图。");
    }
    return doc;
  }
  function resize(doc, width, height) {
    if (!integer(width, 12, 128) || !integer(height, 9, 128)) throw Error("地图尺寸超出范围。");
    for (const l of doc.layers) {
      if (l.type !== "tile") continue;
      const data = Array(width * height).fill(null);
      for (let y = 0; y < Math.min(doc.height, height); y++)
        for (let x = 0; x < Math.min(doc.width, width); x++)
          data[y * width + x] = l.data[y * doc.width + x];
      l.data = data;
    }
    doc.width = width;
    doc.height = height;
    for (const [i, s] of doc.spawns.entries()) {
      s.x = Math.min(s.x, width - 1);
      s.y = Math.min(s.y, height - 1);
      const a = doc.deploymentAreas[i];
      a.x = Math.min(a.x, width - 1);
      a.y = Math.min(a.y, height - 1);
      a.width = Math.min(a.width, width - a.x);
      a.height = Math.min(a.height, height - a.y);
    }
  }
  function addTileset(doc, set) {
    const id = set.id || uid("atlas");
    const value = { id, margin: 0, spacing: 0, ...set };
    doc.tilesets.push(value);
    for (
      let y = value.margin;
      y + value.tileHeight <= value.height - value.margin;
      y += value.tileHeight + value.spacing
    )
      for (
        let x = value.margin;
        x + value.tileWidth <= value.width - value.margin;
        x += value.tileWidth + value.spacing
      )
        doc.tiles.push({
          id: id + "_" + x + "_" + y,
          name: value.name + " " + x + "," + y,
          tilesetId: id,
          x,
          y,
          terrain: doc.defaultTerrain,
          environment: doc.environment,
          color: terrains[doc.defaultTerrain].color,
          decorative: false,
          dynamic: false,
        });
    return id;
  }
  function inside(doc, x, y) {
    return x >= 0 && y >= 0 && x < doc.width && y < doc.height;
  }
  function rect(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) + 1,
      height: Math.abs(a.y - b.y) + 1,
    };
  }
  function random(seed, x, y, salt = 0) {
    let n =
      Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ seed ^ Math.imul(salt, 83492791);
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    n = Math.imul(n ^ (n >>> 13), 3266489909);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function ruleTile(doc, rule, tileId, x, y, bounds, salt = 0) {
    if (!rule) return tileId;
    if (rule.type === "nine") {
      const row = y === bounds.y ? 0 : y === bounds.y + bounds.height - 1 ? 2 : 1;
      const col = x === bounds.x ? 0 : x === bounds.x + bounds.width - 1 ? 2 : 1;
      return rule.tiles[row * 3 + col];
    }
    const sum = rule.variants.reduce((n, v) => n + v.weight, 0);
    let pick = random(doc.seed, x, y, salt) * sum;
    return (rule.variants.find((v) => (pick -= v.weight) < 0) || rule.variants.at(-1)).tileId;
  }
  function paintRect(doc, l, bounds, tileId, rule = null, outline = false) {
    for (let y = bounds.y; y < bounds.y + bounds.height; y++)
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        if (
          !inside(doc, x, y) ||
          (outline &&
            x !== bounds.x &&
            y !== bounds.y &&
            x !== bounds.x + bounds.width - 1 &&
            y !== bounds.y + bounds.height - 1)
        )
          continue;
        l.data[y * doc.width + x] =
          tileId === null ? null : ruleTile(doc, rule, tileId, x, y, bounds);
      }
  }
  function line(a, b, visit) {
    let { x, y } = a;
    const dx = Math.abs(b.x - x),
      dy = -Math.abs(b.y - y),
      sx = x < b.x ? 1 : -1,
      sy = y < b.y ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      visit(x, y);
      if (x === b.x && y === b.y) break;
      const twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x += sx;
      }
      if (twice <= dx) {
        error += dx;
        y += sy;
      }
    }
  }
  function fill(doc, l, x, y, tileId, rule = null) {
    if (!inside(doc, x, y)) return;
    const original = l.data[y * doc.width + x],
      seen = new Set(),
      queue = [[x, y]];
    const bounds = { x: 0, y: 0, width: doc.width, height: doc.height };
    for (let i = 0; i < queue.length; i++) {
      const [cx, cy] = queue[i],
        index = cy * doc.width + cx;
      if (!inside(doc, cx, cy) || seen.has(index) || l.data[index] !== original) continue;
      seen.add(index);
      l.data[index] = ruleTile(doc, rule, tileId, cx, cy, bounds);
      queue.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }
  }
  function selection(doc, l, bounds) {
    return {
      width: bounds.width,
      height: bounds.height,
      data: Array.from({ length: bounds.width * bounds.height }, (_, i) => {
        const x = bounds.x + (i % bounds.width),
          y = bounds.y + Math.floor(i / bounds.width);
        return inside(doc, x, y) ? l.data[y * doc.width + x] : null;
      }),
    };
  }
  function paste(doc, l, block, x, y) {
    block.data.forEach((id, i) => {
      const cx = x + (i % block.width),
        cy = y + Math.floor(i / block.width);
      if (inside(doc, cx, cy)) l.data[cy * doc.width + cx] = id;
    });
  }
  function terrainData(doc) {
    const tiles = Array.from({ length: doc.height }, () =>
      Array(doc.width).fill(doc.defaultTerrain),
    );
    const cellEnvironments = Array.from({ length: doc.height }, () =>
      Array(doc.width).fill(doc.environment),
    );
    const lookup = new Map(doc.tiles.map((t) => [t.id, t]));
    for (const l of doc.layers) {
      if (l.type !== "tile" || l.decorative || !l.visible) continue;
      l.data.forEach((id, i) => {
        const tile = lookup.get(id);
        if (!tile || tile.decorative) return;
        const y = Math.floor(i / doc.width),
          x = i % doc.width;
        tiles[y][x] = tile.terrain;
        cellEnvironments[y][x] = tile.environment;
      });
    }
    return { tiles, cellEnvironments };
  }
  function compile(doc) {
    validate(doc);
    const { tiles, cellEnvironments } = terrainData(doc);
    return {
      id: doc.id,
      name: doc.name,
      description: doc.description,
      width: doc.width,
      height: doc.height,
      environment: doc.environment,
      maxTeams: doc.maxTeams,
      playersPerTeam: doc.playersPerTeam,
      supportedModes: [...doc.supportedModes],
      deploymentRadius: 4,
      spawns: copy(doc.spawns),
      deploymentAreas: copy(doc.deploymentAreas),
      tiles,
      cellEnvironments,
      tileMap: snapshot(doc),
    };
  }
  function gameIssues(doc, maxUnits = 72) {
    try {
      validate(doc);
    } catch (error) {
      return [error.message];
    }
    const problems = [],
      map = compile(doc);
    if (doc.maxTeams !== 2)
      problems.push("当前游戏支持2队；多队配置可保存工程，暂不能注册为对战地图。");
    for (const [i, area] of doc.deploymentAreas.entries()) {
      const s = doc.spawns[i];
      if (s.x < area.x || s.y < area.y || s.x >= area.x + area.width || s.y >= area.y + area.height)
        problems.push("玩家" + (i + 1) + "的出生地不在自己的部署区内。");
      let capacity = 0;
      for (let y = area.y; y < area.y + area.height; y++)
        for (let x = area.x; x < area.x + area.width; x++)
          if (!["rock", "water"].includes(map.tiles[y][x])) capacity++;
      if (capacity < maxUnits)
        problems.push("玩家" + (i + 1) + "部署区可通行格数不足" + maxUnits + "。");
      if (
        doc.deploymentAreas
          .slice(0, i)
          .some(
            (b) =>
              area.x < b.x + b.width &&
              b.x < area.x + area.width &&
              area.y < b.y + b.height &&
              b.y < area.y + area.height,
          )
      )
        problems.push("玩家" + (i + 1) + "部署区与其他部署区重叠。");
    }
    return problems;
  }
  function importMap(value) {
    if (value?.tileMap) return validate(copy(value.tileMap));
    if (value?.format === format) return validate(copy(value));
    if (!value?.tiles || !value?.spawns) throw Error("不是地图工程或游戏地图文件。");
    const doc = create({
      id: value.id,
      name: value.name,
      width: value.width,
      height: value.height,
      description: value.description || "",
      environment: value.environment || "ground",
      maxTeams: value.maxTeams || 2,
      playersPerTeam: value.playersPerTeam || 1,
      supportedModes: value.supportedModes || ["regular", "quick"],
    });
    doc.layers[0].data = value.tiles.flat().map((t) => "terrain_" + t);
    doc.spawns = copy(value.spawns);
    if (value.deploymentAreas) doc.deploymentAreas = copy(value.deploymentAreas);
    else
      doc.deploymentAreas = doc.spawns.map((s) => {
        const r = value.deploymentRadius || 4;
        return {
          x: Math.max(0, s.x - r),
          y: Math.max(0, s.y - r),
          width: Math.min(doc.width, s.x + r + 1) - Math.max(0, s.x - r),
          height: Math.min(doc.height, s.y + r + 1) - Math.max(0, s.y - r),
        };
      });
    return validate(doc);
  }
  return {
    format,
    terrains,
    uid,
    create,
    snapshot,
    validate,
    resize,
    layer,
    setPlayers,
    addTileset,
    inside,
    rect,
    random,
    ruleTile,
    paintRect,
    line,
    fill,
    selection,
    paste,
    terrainData,
    compile,
    gameIssues,
    importMap,
  };
})();
if (typeof module !== "undefined") module.exports = MapDocument;
