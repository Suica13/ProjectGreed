/* 服务端与离线试玩共用的规则，不在这里调整 UI 尺寸或特效。
 * g = 对局，u = 单位，a/b = 攻防双方，w = 武器。
 */
"use strict";
const Tactics = (() => {
  // 机体数值配置。视觉大小另存于 client/ui-layout.json，不影响战斗属性。
  const catalog =
    typeof ART !== "undefined" ? ART : require("../tools/load-catalog.cjs").loadCatalog();
  const models = catalog.models;
  const turnTransitionMs = 3600;
  const W = catalog.map.width,
    H = catalog.map.height;
  const maxCostLimit = 99999;
  const seatTeam = (seat) => (seat === null ? null : seat % 2);
  const ownerOf = (unit) => unit.ownerSeat ?? unit.team;
  const mapWidth = (g) => g.tiles[0].length;
  const mapHeight = (g) => g.tiles.length;
  function getMap(id = catalog.defaultMap) {
    if (typeof id !== "string" || !Object.hasOwn(catalog.maps, id)) throw Error("未知地图");
    return catalog.maps[id];
  }
  function validateCostLimit(value) {
    const minimum = Math.min(...Object.values(models).map((m) => m.cost));
    if (!Number.isInteger(value) || value < minimum || value > maxCostLimit)
      throw Error("编组 COST 上限无效");
    return value;
  }
  function validateUnitLimit(value = catalog.formation.maxUnits) {
    if (!Number.isInteger(value) || value < 3 || value > catalog.formation.maxUnits)
      throw Error("编组单位上限必须为3～12台");
    return value;
  }
  // 玩家默认最多12台；裁定端可为AI显式传入倍率后的上限（最多24台）。
  function validateFormation(
    entries,
    maxCost = catalog.formation.maxCost,
    unitLimit = catalog.formation.maxUnits,
  ) {
    if (
      !Array.isArray(entries) ||
      !entries.length ||
      entries.length > unitLimit ||
      !Number.isInteger(unitLimit) ||
      unitLimit < 1 ||
      unitLimit > catalog.formation.maxUnits * 2
    )
      throw Error("编组数量无效，请检查单位数量上限");
    let cost = 0;
    const clean = entries.map((entry) => {
      const id = entry?.unitId + "__" + entry?.kitId,
        model = models[id];
      if (!model) throw Error("编组包含不可用单位或武器套件");
      cost += model.cost;
      return { unitId: model.prefabId, kitId: model.kitId };
    });
    if (cost > maxCost) throw Error("编组 COST 超出上限");
    return clean;
  }
  const factions = ["EFSF", "ZEON"];
  const eras = [
    ...new Set(
      catalog.prefabs.flatMap((prefab) => prefab.tags.filter((tag) => /^\d{4}$/.test(tag))),
    ),
  ].sort();
  function validateUnitCostLimit(value) {
    if (!Number.isInteger(value) || value < 1 || value > maxCostLimit)
      throw Error("单位 COST 上限无效");
    return value;
  }
  function validateTagRestrictions(value = {}) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !["bannedFactions", "bannedEras"].includes(key))
    )
      throw Error("标签限制无效");
    const clean = {};
    for (const [key, allowed] of [
      ["bannedFactions", factions],
      ["bannedEras", eras],
    ]) {
      const tags = value[key] ?? [];
      if (!Array.isArray(tags) || tags.some((tag) => !allowed.includes(tag)))
        throw Error("标签限制无效");
      clean[key] = [...new Set(tags)].sort();
    }
    return clean;
  }
  function validateTeamRestrictions(value) {
    if (!Array.isArray(value) || value.length !== 2) throw Error("队伍标签限制无效");
    return value.map(validateTagRestrictions);
  }
  function defaultRoomSettings() {
    return {
      mapId: catalog.defaultMap,
      costLimit: catalog.formation.maxCost,
      unitLimit: catalog.formation.defaultUnits,
      unitCostLimit: catalog.formation.unitCostLimit,
      ...validateTagRestrictions(),
      teamRestrictions: [validateTagRestrictions(), validateTagRestrictions()],
    };
  }
  function formationRestrictions(settings = {}, seat = null) {
    const team = seat === null ? {} : settings.teamRestrictions?.[seatTeam(seat)] || {};
    return {
      unitCostLimit: settings.unitCostLimit ?? Infinity,
      bannedFactions: [
        ...new Set([...(settings.bannedFactions || []), ...(team.bannedFactions || [])]),
      ],
      bannedEras: [...new Set([...(settings.bannedEras || []), ...(team.bannedEras || [])])],
    };
  }
  function restrictionReason(model, restrictions = {}) {
    if (
      restrictions.bannedFactions?.includes(model.faction) ||
      model.tags.some((tag) => restrictions.bannedEras?.includes(tag))
    )
      return "not_allowed";
    if (model.cost > (restrictions.unitCostLimit ?? Infinity)) return "cost";
    return null;
  }
  // 先排除被禁标签和超出单机 COST 的单位，再从编组末尾向前停用直到预算允许。
  function planFormation(
    entries,
    maxCost = catalog.formation.maxCost,
    restrictions = {},
    unitLimit = catalog.formation.maxUnits,
  ) {
    const clean = validateFormation(entries, Infinity, unitLimit);
    const costs = clean.map((entry) => models[entry.unitId + "__" + entry.kitId].cost);
    const totalCost = costs.reduce((sum, value) => sum + value, 0);
    const reasons = {};
    clean.forEach((entry, index) => {
      const reason = restrictionReason(models[entry.unitId + "__" + entry.kitId], restrictions);
      if (reason) reasons[index] = reason;
    });
    let deployCost = costs.reduce((sum, value, index) => sum + (reasons[index] ? 0 : value), 0);
    for (let index = clean.length - 1; index >= 0 && deployCost > maxCost; index--) {
      if (reasons[index]) continue;
      reasons[index] = "cost";
      deployCost -= costs[index];
    }
    const disabled = Object.keys(reasons)
      .map(Number)
      .sort((a, b) => a - b);
    return {
      entries: clean,
      totalCost,
      deployCost,
      disabled,
      reasons,
      deployable: clean.filter((_, index) => !reasons[index]),
      indices: clean.map((_, index) => index).filter((index) => !reasons[index]),
    };
  }
  const aiCountPercentages = Object.freeze([50, 75, 100, 125, 150, 175, 200]);
  const aiDefaults = Object.freeze({ difficulty: "medium", fill: 100, countPercent: 100 });
  const aiPerformance = Object.freeze({ easy: 0.75, medium: 1, hard: 1.25 });
  function validateAISettings(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("AI 设置无效");
    const clean = { ...aiDefaults, ...value };
    if (
      !Object.hasOwn(aiPerformance, clean.difficulty) ||
      ![50, 75, 100, 125, 150].includes(clean.fill) ||
      !aiCountPercentages.includes(clean.countPercent) ||
      Object.keys(value).some((key) => !Object.hasOwn(aiDefaults, key))
    )
      throw Error("AI 设置无效");
    return { difficulty: clean.difficulty, fill: clean.fill, countPercent: clean.countPercent };
  }
  const aiBudget = (limit, config) => Math.floor((limit * validateAISettings(config).fill) / 100);
  const aiUnitLimit = (limit, config) =>
    Math.max(
      1,
      Math.floor((validateUnitLimit(limit) * validateAISettings(config).countPercent) / 100),
    );
  function randomFormation(
    seed = 7319,
    maxCost = catalog.formation.maxCost,
    restrictions = {},
    unitLimit = catalog.formation.maxUnits,
  ) {
    if (!Number.isInteger(unitLimit) || unitLimit < 1 || unitLimit > catalog.formation.maxUnits * 2)
      throw Error("AI 编组数量上限无效");
    if (
      !Number.isInteger(maxCost) ||
      maxCost <= 0 ||
      maxCost > maxCostLimit * 1.5 ||
      !restrictions ||
      typeof restrictions !== "object" ||
      Array.isArray(restrictions)
    )
      throw Error("AI 编组设置无效");
    const choices = Object.values(models).filter(
        (model) => !restrictionReason(model, restrictions),
      ),
      entries = [];
    const minimum = Math.min(...choices.map((model) => model.cost));
    const count = Math.min(unitLimit, Math.floor(maxCost / minimum));
    let remaining = maxCost;
    for (let i = 0; i < count; i++) {
      const reserve = minimum * (count - i - 1);
      const legal = choices.filter((model) => model.cost <= remaining - reserve);
      if (!legal.length) break;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const model = legal[seed % legal.length];
      entries.push({ unitId: model.prefabId, kitId: model.kitId });
      remaining -= model.cost;
    }
    return entries;
  }
  // 模型目录保持不变，每个 AI 实例只应用一次难度倍率。
  function weaponStats(weapon, unit) {
    const factor = unit.performance ?? 1;
    if (factor === 1 || weapon.performance === factor) return weapon;
    return {
      ...weapon,
      performance: factor,
      get name() {
        return weapon.name;
      },
      get description() {
        return weapon.description;
      },
      damagePerShot: weapon.damagePerShot * factor,
      damage: weapon.damage * factor,
      hit: Math.min(100, weapon.hit * factor),
      damageComponents: Object.fromEntries(
        Object.entries(weapon.damageComponents).map(([key, value]) => [key, value * factor]),
      ),
    };
  }
  const scaledModels = new WeakMap();
  function modelOf(unit) {
    const base = models[unit.model],
      factor = unit.performance ?? 1;
    if (factor === 1) return base;
    let variants = scaledModels.get(base);
    if (!variants) scaledModels.set(base, (variants = new Map()));
    if (!variants.has(factor)) {
      const defense = (channels) =>
        Object.fromEntries(
          Object.entries(channels).map(([key, value]) => [
            key,
            { flat: value.flat * factor, percent: Math.min(100, value.percent * factor) },
          ]),
        );
      variants.set(factor, {
        ...base,
        get name() {
          return base.name;
        },
        get description() {
          return base.description;
        },
        get kitName() {
          return base.kitName;
        },
        hp: Math.round(base.hp * factor),
        en: Math.round(base.en * factor),
        move: Math.max(1, Math.round(base.move * factor)),
        mobility: base.mobility * factor,
        defenses: defense(base.defenses),
        shield: {
          ...base.shield,
          hp: Math.round(base.shield.hp * factor),
          defenses: defense(base.shield.defenses),
        },
        weapons: base.weapons.map((weapon) => weaponStats(weapon, unit)),
      });
    }
    return variants.get(factor);
  }
  function deploymentCells(g, seat) {
    const map = getMap(g.mapId),
      spawn = map.spawns[seat],
      cells = [];
    if (!spawn) return cells;
    const radius = map.deploymentRadius;
    for (
      let y = Math.max(0, spawn.y - radius);
      y <= Math.min(mapHeight(g) - 1, spawn.y + radius);
      y++
    )
      for (
        let x = Math.max(0, spawn.x - radius);
        x <= Math.min(mapWidth(g) - 1, spawn.x + radius);
        x++
      )
        if (dist({ x, y }, spawn) <= radius && Number.isFinite(terrain[g.tiles[y][x]].cost))
          cells.push({ x, y });
    return cells.sort((a, b) => dist(a, spawn) - dist(b, spawn) || a.y - b.y || a.x - b.x);
  }
  function deploy(g, team, id, x, y) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再调整");
    const u = g.units.find((u) => u.id === id && ownerOf(u) === team);
    if (
      !u ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !deploymentCells(g, team).some((c) => c.x === x && c.y === y)
    )
      throw Error("请在己方出生区的有效格子部署");
    if (g.units.some((other) => other.id !== id && other.x === x && other.y === y))
      throw Error("该部署位置已有单位");
    u.x = x;
    u.y = y;
  }
  function confirmDeployment(g, team) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再次确认");
    for (const u of g.units.filter((u) => ownerOf(u) === team)) {
      if (!deploymentCells(g, team).some((c) => c.x === u.x && c.y === u.y))
        throw Error("单位不在有效部署区域");
      if (g.units.some((other) => other.id !== u.id && other.x === u.x && other.y === u.y))
        throw Error("部署位置重叠");
    }
    g.deployment[team] = true;
    return g.deployment.every(Boolean);
  }
  const terrain = {
    plain: { name: "平地", cost: 1, cover: 0, color: "#243b3d" },
    forest: { name: "林地", cost: 2, cover: 15, color: "#294738" },
    rubble: { name: "废墟", cost: 2, cover: 10, color: "#43494a" },
    rock: { name: "山岩", cost: Infinity, cover: 0, color: "#596064" },
    water: { name: "水域", cost: Infinity, cover: 0, color: "#234c61" },
  };
  // 地图配色只影响显示；移动消耗和掩护仍使用共用地形规则。
  function terrainStyle(mapId, kind) {
    const base = terrain[kind],
      color = getMap(mapId).appearance?.colors?.[kind];
    return color ? { ...base, color } : base;
  }
  const key = (x, y) => x + "," + y,
    dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    typeNames = { beam: "光束", shell: "实弹", melee: "格斗" };
  function create(ai = false, seed = 7319, formations, deploying = false, settings = {}) {
    const map = getMap(settings.mapId),
      costLimit = validateCostLimit(settings.costLimit ?? catalog.formation.maxCost),
      unitLimit = validateUnitLimit(settings.unitLimit ?? catalog.formation.maxUnits);
    formations ??= map.spawns.map((_, seat) =>
      randomFormation(
        seed + seat,
        settings.seatCostLimits?.[seat] ?? costLimit,
        formationRestrictions(settings, seat),
        settings.seatUnitLimits?.[seat] ?? unitLimit,
      ),
    );
    if (formations.length !== map.spawns.length) throw Error("编组数量必须匹配地图席位");
    const tiles = map.tiles.map((row) => row.slice());
    let units = [];
    for (let seat = 0; seat < formations.length; seat++) {
      // null 明确表示空出生点，不生成单位，也无需确认部署。
      if (formations[seat] === null) continue;
      validateFormation(
        formations[seat],
        settings.seatCostLimits?.[seat] ?? costLimit,
        settings.seatUnitLimits?.[seat] ?? unitLimit,
      ).forEach((entry, i) => {
        if (
          restrictionReason(
            models[entry.unitId + "__" + entry.kitId],
            formationRestrictions(settings, seat),
          )
        )
          throw Error("编组包含不被允许的单位");
        const team = seatTeam(seat);
        const model = entry.unitId + "__" + entry.kitId;
        const position = deploymentCells({ tiles, mapId: map.id }, seat).filter(
          (cell) => !units.some((u) => u.x === cell.x && u.y === cell.y),
        )[0];
        if (!position) throw Error("出生区没有足够位置容纳编组，请检查目录配置");
        const performance = settings.performances?.[seat] ?? 1;
        if (![0.75, 1, 1.25].includes(performance)) throw Error("性能倍率无效");
        let m = modelOf({ model, performance });
        units.push({
          id: seat + "-" + (settings.formationIndices?.[seat]?.[i] ?? i),
          ownerSeat: seat,
          model,
          performance,
          team,
          x: position.x,
          y: position.y,
          hp: m.hp,
          shield: m.shield.hp,
          en: m.en,
          moved: false,
          acted: false,
          origin: null,
          counterCount: 0,
          angle: team ? -90 : 90,
          heldWeapon: m.weapons[0].id,
        });
      });
    }
    return {
      tiles,
      units,
      deployment: deploying ? formations.map((army) => army === null) : null,
      mapId: map.id,
      costLimit,
      unitLimit,
      team: 0,
      round: 1,
      ai,
      seed: seed >>> 0,
      winner: null,
    };
  }
  function at(g, x, y) {
    return g.units.find((u) => u.hp > 0 && u.x === x && u.y === y);
  }
  // 敌军上下左右相邻的格子消耗至少3点；地形更昂贵时仍按地形计算。
  function movementCost(g, u, x, y) {
    const base = terrain[g.tiles[y][x]].cost;
    return g.units.some(
      (enemy) => enemy.hp > 0 && enemy.team !== u.team && dist(enemy, { x, y }) === 1,
    )
      ? Math.max(base, 3)
      : base;
  }
  // 按地形消耗搜索可达格子，同时保存各格子的移动路径。
  function reachable(g, u) {
    let best = new Map([[key(u.x, u.y), { x: u.x, y: u.y, cost: 0, path: [] }]]),
      queue = [best.get(key(u.x, u.y))];
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      let n = queue.shift();
      if (n.cost !== best.get(key(n.x, n.y)).cost) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let x = n.x + dx,
          y = n.y + dy;
        if (x < 0 || x >= mapWidth(g) || y < 0 || y >= mapHeight(g)) continue;
        let occupant = at(g, x, y);
        if (occupant && occupant.team !== u.team) continue;
        let cost = n.cost + movementCost(g, u, x, y);
        if (cost > modelOf(u).move) continue;
        let k = key(x, y);
        if (best.has(k) && best.get(k).cost <= cost) continue;
        let entry = { x, y, cost, path: [...n.path, { x, y }] };
        best.set(k, entry);
        queue.push(entry);
      }
    }
    // 友军可作为路径中间点，但不能作为移动终点。
    for (const [cell, entry] of best) {
      const occupant = at(g, entry.x, entry.y);
      if (occupant && occupant.id !== u.id) best.delete(cell);
    }
    return best;
  }
  // 朝向由裁定状态保存，快照、重连和各客户端使用同一个结果。
  function faceTarget(unit, target) {
    const dx = target.x - unit.x,
      dy = target.y - unit.y;
    if (dx || dy) unit.angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  }
  function move(g, u, x, y) {
    if (g.winner !== null || u.team !== g.team || u.acted || u.moved) throw Error("本单位无法移动");
    let tile = reachable(g, u).get(key(x, y));
    if (!tile || !tile.path.length) throw Error("该位置不可移动");
    // 只有同一玩家的后续成功移动才会提交先前移动；友军玩家独立撤回。
    for (const other of g.units) {
      if (ownerOf(other) === ownerOf(u)) other.origin = null;
    }
    u.origin = { x: u.x, y: u.y, angle: u.angle };
    const from = tile.path.length > 1 ? tile.path[tile.path.length - 2] : u;
    const direction = { ...from };
    faceTarget(direction, { x, y });
    u.angle = direction.angle;
    u.x = x;
    u.y = y;
    u.moved = true;
    return tile.path;
  }
  function canUndo(g, u) {
    return (
      g.winner === null &&
      u.hp > 0 &&
      u.team === g.team &&
      !u.acted &&
      u.moved &&
      !!u.origin &&
      !at(g, u.origin.x, u.origin.y)
    );
  }
  function undo(g, u) {
    if (!canUndo(g, u)) throw Error("无法撤销：己方编组的后续单位已移动或原位置被占用");
    Object.assign(u, u.origin);
    u.origin = null;
    u.moved = false;
  }
  function canUse(u, w) {
    return u.hp > 0 && u.en >= w.en;
  }
  function inRange(a, b, w) {
    let d = dist(a, b);
    return d >= w.min && d <= w.max;
  }
  function canAttack(g, a, b, w) {
    return (
      !!a && !!b && a.hp > 0 && b.hp > 0 && a.team !== b.team && canUse(a, w) && inRange(a, b, w)
    );
  }
  function countersRemaining(u) {
    return Math.max(0, Math.min(1, modelOf(u).counterLimit ?? 1) - (u.counterCount ?? 0));
  }
  function canCounter(g, a, b, w) {
    return (
      !!a &&
      countersRemaining(a) > 0 &&
      (!a.counterTargetId || a.counterTargetId === b?.id) &&
      canAttack(g, a, b, w)
    );
  }
  // 返回预估命中率和命中后的伤害，不修改对局。
  function estimate(g, a, b, w, response = "counter", isCounter = false) {
    w = weaponStats(w, a);
    const bonuses = modelOf(a).attackBonuses,
      categoryBonus = 1 + bonuses[w.type === "melee" ? "melee" : "shooting"] / 100;
    const defender = modelOf(b),
      cover = terrain[g.tiles[b.y][b.x]].cover,
      mobilityPenalty = (defender.mobility * (response === "evade" ? 1.25 : 1) - 100) * 0.25,
      baseHit =
        Math.max(10, Math.min(100, w.hit - cover - mobilityPenalty)) * (isCounter ? 0.75 : 1),
      // 最终回避加成在机动性、地形与反击惩罚计算后生效。
      hit = Math.max(0, baseHit - (response === "evade" ? 15 : 0)),
      multiplier = w.type === "melee" ? 1 : 1 - cover / 100,
      defenseMultiplier = response === "defend" ? 1.25 : 1,
      finalDamageMultiplier = response === "defend" ? 0.75 : 1,
      strikes = w.attack.strikes;
    // MOD: subtract flat protection per projectile/component, then apply percentage protection.
    function protectedDamage(defenses, damageMultiplier, share = 1) {
      return (
        Object.entries(w.damageComponents).reduce((sum, [channel, value]) => {
          const percentKey =
              channel === "meleeBeam" ? "beam" : channel === "meleeShell" ? "shell" : channel,
            flatKey = channel.startsWith("melee") ? "melee" : channel;
          const element =
              channel === "meleeBeam" ? "beam" : channel === "meleeShell" ? "shell" : channel,
            elementBonus =
              element === "beam" || element === "shell" ? 1 + bonuses[element] / 100 : 1;
          return (
            sum +
            Math.max(
              0,
              value * damageMultiplier * categoryBonus * elementBonus * share -
                defenses[flatKey].flat * defenseMultiplier,
            ) *
              (1 - Math.min(100, defenses[percentKey].percent * defenseMultiplier) / 100)
          );
        }, 0) *
        multiplier *
        finalDamageMultiplier
      );
    }
    let damage = 0,
      shieldDamage = 0,
      blockedDamage = 0;
    let shieldLeft = Math.max(0, b.shield ?? 0);
    for (const strike of strikes) {
      const strikeMultiplier = strike.damageMultiplier ?? 1;
      damage += Math.round(protectedDamage(defender.defenses, strikeMultiplier));
      const coverage = shieldLeft > 0 ? defender.shield.coverage : 0;
      // 先分流原始伤害；盾牌防护只决定自己的耐久损耗，不能当成本体减伤值。
      const shieldRequired =
        coverage > 0
          ? Math.round(protectedDamage(defender.shield.defenses, strikeMultiplier, coverage))
          : 0;
      const absorbedShare =
        coverage * (shieldRequired > 0 ? Math.min(1, shieldLeft / shieldRequired) : 1);
      const loss = Math.min(shieldLeft, shieldRequired);
      shieldDamage += loss;
      shieldLeft -= loss;
      blockedDamage += Math.round(
        protectedDamage(defender.defenses, strikeMultiplier, 1 - absorbedShare),
      );
    }
    return {
      hit,
      damage,
      shieldDamage,
      blockedDamage,
      blockChance:
        b.shield > 0
          ? Math.min(1, defender.shield.blockChance + (response === "defend" ? 0.25 : 0))
          : 0,
    };
  }
  function spend(u, w) {
    if (w.en) u.en -= w.en;
    if (w.changeHeldWeapon !== false) u.heldWeapon = w.id;
  }
  function random(g) {
    g.seed = (Math.imul(1664525, g.seed) + 1013904223) >>> 0;
    return g.seed / 4294967296;
  }
  // 真正结算入口：校验 → 扣资源 → 随机命中 → 扣血 → 生成演出事件。
  function fight(g, a, b, w, response, counterId, allowCounter = true) {
    if (g.winner !== null || a.team !== g.team || a.acted || !canAttack(g, a, b, w))
      throw Error("攻击条件已失效");
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    let cw = modelOf(b).weapons.find((x) => x.id === counterId);
    if (response === "counter" && allowCounter && (!cw || !canCounter(g, b, a, cw)))
      throw Error("反击次数已用完，或武器不满足射程与 EN 条件");
    let events = [],
      dodgeSeed = (g.seed ^ 0x9e3779b9) >>> 0;
    const dodgeSlots = { [a.id]: 0, [b.id]: 0 };
    function dodgeSide() {
      // Independent visual RNG: choosing a dodge direction never changes hit rolls.
      dodgeSeed = (Math.imul(1664525, dodgeSeed) + 1013904223) >>> 0;
      return dodgeSeed < 0x80000000 ? -1 : 1;
    }
    function fire(from, to, weapon, stance, isCounter = false) {
      faceTarget(from, to);
      faceTarget(to, from);
      weapon = weaponStats(weapon, from);
      spend(from, weapon);
      const before = to.hp,
        shieldBefore = to.shield,
        sourceDodgeSlot = dodgeSlots[from.id],
        targetDodgeSlot = dodgeSlots[to.id],
        strikes = [];
      // One server roll per bullet / melee strike. Resources are spent once per attack.
      for (const step of weapon.attack.strikes) {
        const e = estimate(
            g,
            from,
            to,
            { ...weapon, attack: { ...weapon.attack, strikes: [step] } },
            stance,
            isCounter,
          ),
          executed = to.hp > 0,
          hit = executed && random(g) < e.hit / 100,
          blocked = hit && to.shield > 0 && random(g) < e.blockChance,
          shieldDamage = blocked ? e.shieldDamage : 0,
          damage = hit ? Math.min(to.hp, blocked ? e.blockedDamage : e.damage) : 0;
        let dodgeTo = null;
        if (executed && !hit) {
          dodgeTo = dodgeSlots[to.id] === 0 ? dodgeSide() : 0;
          dodgeSlots[to.id] = dodgeTo;
        }
        strikes.push({
          ...step,
          executed,
          hit,
          dodgeTo,
          blocked,
          damage,
          shieldDamage,
          before: to.hp,
          after: to.hp - damage,
          shieldBefore: to.shield,
          shieldAfter: to.shield - shieldDamage,
          hitChance: e.hit,
        });
        to.hp -= damage;
        to.shield -= shieldDamage;
      }
      events.push({
        from: from.id,
        to: to.id,
        weapon: weapon.id,
        model: from.model,
        type: weapon.type,
        clip: weapon.clip,
        heldWeapon: from.heldWeapon,
        shotCount: weapon.shotCount,
        damagePerShot: weapon.damagePerShot,
        sourceDodgeSlot,
        targetDodgeSlot,
        targetDodgeEnd: dodgeSlots[to.id],
        strikes,
        hit: strikes.some((s) => s.hit),
        hitCount: strikes.filter((s) => s.hit).length,
        strikeCount: strikes.filter((s) => s.executed).length,
        damage: before - to.hp,
        before,
        blocked: strikes.some((s) => s.blocked),
        shieldBefore,
        shieldAfter: to.shield,
        shieldDamage: shieldBefore - to.shield,
        after: to.hp,
        hitChance: strikes[0].hitChance,
        response: stance,
      });
    }
    fire(a, b, w, response);
    if (response === "counter" && allowCounter && b.hp > 0 && canCounter(g, b, a, cw)) {
      b.counterCount = (b.counterCount ?? 0) + 1;
      b.counterTargetId = a.id;
      fire(b, a, cw, "counter", true);
    }
    a.acted = true;
    a.origin = null;
    let alive = [0, 1].map((t) => g.units.some((u) => u.team === t && u.hp > 0));
    if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
    return events;
  }
  function wait(g, u) {
    if (g.winner !== null || u.team !== g.team || u.acted) throw Error("无法待机");
    u.acted = true;
    u.origin = null;
  }
  function end(g) {
    if (g.winner !== null) throw Error("战斗已经结束");
    g.team = 1 - g.team;
    g.round++;
    // One round number is one team action phase; all counter budgets refresh on handoff.
    for (const u of g.units) {
      u.counterCount = 0;
      delete u.counterTargetId;
    }
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0)) {
      u.acted = false;
      u.moved = false;
      u.origin = null;
      u.en = Math.min(modelOf(u).en, u.en + Math.round(15 * (u.performance ?? 1)));
    }
  }
  // 没有技能系统时，合法行动由移动和攻击构成；待机不阻止自动结束。
  function hasActions(g) {
    if (g.winner !== null || (g.deployment && !g.deployment.every(Boolean))) return false;
    const enemies = g.units.filter((u) => u.team !== g.team && u.hp > 0);
    return g.units.some((u) => {
      if (u.team !== g.team || u.hp <= 0 || u.acted) return false;
      if (!u.moved && reachable(g, u).size > 1) return true;
      return modelOf(u).weapons.some((w) => enemies.some((e) => canAttack(g, u, e, w)));
    });
  }
  function bestResponse(g, a, b, w) {
    let attack = estimate(g, a, b, w),
      counter = modelOf(b)
        .weapons.filter((c) => canCounter(g, b, a, c))
        .sort((x, y) => {
          let ex = estimate(g, b, a, x, "counter", true),
            ey = estimate(g, b, a, y, "counter", true);
          return ey.damage * ey.hit - ex.damage * ex.hit;
        })[0];
    const defense = estimate(g, a, b, w, "defend"),
      evasion = estimate(g, a, b, w, "evade"),
      expected = (e) =>
        (e.hit / 100) * ((1 - e.blockChance) * e.damage + e.blockChance * e.blockedDamage);
    if (!counter || b.hp <= expected(attack))
      return { response: expected(defense) < expected(evasion) ? "defend" : "evade" };
    return counter ? { response: "counter", weapon: counter.id } : { response: "evade" };
  }
  function aiChoice(g, u) {
    let cells = u.moved ? [{ x: u.x, y: u.y, cost: 0, path: [] }] : [...reachable(g, u).values()],
      enemies = g.units.filter((e) => e.team !== u.team && e.hp > 0),
      best = null;
    for (const c of cells) {
      let virtual = { ...u, x: c.x, y: c.y },
        near = Math.min(...enemies.map((e) => dist(virtual, e)));
      let score = -near * 0.12 - c.cost * 0.025 + terrain[g.tiles[c.y][c.x]].cover * 0.006,
        target = null,
        weapon = null;
      for (const e of enemies)
        for (const w of modelOf(u).weapons)
          if (canAttack(g, virtual, e, w)) {
            let ex = estimate(g, virtual, e, w),
              s =
                2 +
                (ex.damage * ex.hit) / 100000 +
                Math.min(1, ex.damage / e.hp) * 0.6 -
                c.cost * 0.025;
            if (s > score) {
              score = s;
              target = e.id;
              weapon = w.id;
            }
          }
      if (!best || score > best.score) best = { ...c, score, target, weapon };
    }
    return best;
  }
  return {
    W,
    getMap,
    mapWidth,
    mapHeight,
    seatTeam,
    ownerOf,
    validateCostLimit,
    validateUnitLimit,
    validateUnitCostLimit,
    validateTagRestrictions,
    validateTeamRestrictions,
    defaultRoomSettings,
    formationRestrictions,
    restrictionReason,
    factions,
    eras,
    maxCostLimit,
    movementCost,
    H,
    models,
    catalog,
    validateFormation,
    randomFormation,
    planFormation,
    aiDefaults,
    aiCountPercentages,
    aiUnitLimit,
    aiPerformance,
    validateAISettings,
    aiBudget,
    modelOf,
    weaponStats,
    deploymentCells,
    deploy,
    confirmDeployment,
    terrain,
    terrainStyle,
    typeNames,
    key,
    dist,
    create,
    at,
    reachable,
    faceTarget,
    move,
    undo,
    canUndo,
    countersRemaining,
    canCounter,
    canUse,
    inRange,
    canAttack,
    estimate,
    fight,
    wait,
    end,
    hasActions,
    turnTransitionMs,
    bestResponse,
    aiChoice,
  };
})();
if (typeof module !== "undefined") module.exports = Tactics;
