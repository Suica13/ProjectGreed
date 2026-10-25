/* 服务端与离线试玩共用的规则，不在这里调整 UI 尺寸或特效。
 * g = 对局，u = 单位，a/b = 攻防双方，w = 武器。
 */
"use strict";
const Tactics = (() => {
  // 机体数值配置。视觉大小另存于 client/ui-layout.json，不影响战斗属性。
  const catalog =
    typeof ART !== "undefined" ? ART : require("../tools/load-catalog.cjs").loadCatalog();
  const models = catalog.models;
  const parts = typeof UnitParts !== "undefined" ? UnitParts : require("./unit-parts.js");
  const skillModule = typeof UnitSkills !== "undefined" ? UnitSkills : require("./unit-skills.js");
  const hangarModule = typeof UnitHangars !== "undefined" ? UnitHangars : require("./hangars.js");
  const onMap = (u) => !!u && u.hp > 0 && !u.embarked;
  const turnTransitionMs = 3600;
  const W = catalog.map.width,
    H = catalog.map.height;
  const maxCostLimit = 99999;
  const seatTeam = (seat) => (seat === null ? null : seat % 2);
  const ownerOf = (unit) => unit.ownerSeat ?? unit.team;
  function canControlUnit(settings, members, seat, unit) {
    if (!unit || !Number.isInteger(seat) || seat < 0 || !members?.some((m) => m.seat === seat))
      return false;
    if (ownerOf(unit) === seat) return true;
    return (
      unit.team === seatTeam(seat) &&
      (settings?.shareAlliedUnits === true ||
        members.some((m) => m.seat === ownerOf(unit) && m.shareUnits === true))
    );
  }
  const mapWidth = (g) => g.tiles[0].length;
  const mapHeight = (g) => g.tiles.length;
  // 列坐标从零开始，显示为 A…Z、AA…ZZ、AAA…，大型单位落在格间时取左侧格。
  function columnLabel(index) {
    let value = Math.floor(index) + 1,
      label = "";
    if (!Number.isSafeInteger(value) || value < 1) return "—";
    while (value > 0) {
      value--;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }
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
  function normalizeUnitName(value) {
    if (value === undefined) return "";
    if (typeof value !== "string") throw Error("单位名称无效");
    const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (Array.from(name).length > 24) throw Error("单位名称最多24个字符");
    return name;
  }
  function generateUnitName(baseName, entries, random = Math.random) {
    const used = new Set(entries.map((entry) => entry.customName?.match(/\[([A-Z]\d{2})\]$/)?.[1]));
    const start = Math.floor(random() * 2600);
    for (let offset = 0; offset < 2600; offset++) {
      const value = (start + offset) % 2600;
      const code =
        String.fromCharCode(65 + Math.floor(value / 100)) + String(value % 100).padStart(2, "0");
      if (!used.has(code)) return Array.from(baseName).slice(0, 19).join("") + "[" + code + "]";
    }
    throw Error("没有可用的单位编号");
  }
  const unitName = (unit) => unit.customName || modelOf(unit).name;
  // 房间基础上限12台；玩家与AI可按数量比例扩展到36台。
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
      unitLimit > catalog.formation.maxUnits * 3
    )
      throw Error("编组数量无效，请检查单位数量上限");
    let cost = 0;
    const clean = entries.map((entry) => {
      const alias = catalog.prefabs.find((p) => p.id === entry?.unitId)?.kitAliases?.[entry?.kitId];
      const id = entry?.unitId + "__" + (alias || entry?.kitId),
        model = models[id];
      if (!model || model.formOnly) throw Error("编组包含不可用单位或武器套件");
      cost += model.cost;
      const customName = normalizeUnitName(entry.customName);
      return { unitId: model.prefabId, kitId: model.kitId, ...(customName ? { customName } : {}) };
    });
    const capacity = new Map();
    entries.forEach((entry, index) => {
      if (entry.preload === undefined) return;
      const preload = entry.preload;
      if (
        !preload ||
        !Number.isInteger(preload.carrierIndex) ||
        preload.carrierIndex < 0 ||
        preload.carrierIndex >= clean.length ||
        preload.carrierIndex === index ||
        typeof preload.hangarId !== "string"
      )
        throw Error("预先搭载关系无效");
      const carrier =
          models[clean[preload.carrierIndex].unitId + "__" + clean[preload.carrierIndex].kitId],
        passenger = models[clean[index].unitId + "__" + clean[index].kitId],
        hangar = carrier.hangars?.find((h) => h.id === preload.hangarId);
      if (
        !hangar ||
        passenger.hangars?.length ||
        entries[preload.carrierIndex].preload ||
        !hangar.allowedTags.some((tag) => passenger.transport?.loadTags.includes(tag))
      )
        throw Error("该单位不能预先搭载至此格纳库");
      const key = preload.carrierIndex + "/" + preload.hangarId,
        used = (capacity.get(key) || 0) + (passenger.transport?.slotCost || 1);
      if (used > hangar.capacity) throw Error("预先搭载超出格纳库容量");
      capacity.set(key, used);
      clean[index].preload = { carrierIndex: preload.carrierIndex, hangarId: preload.hangarId };
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
  const unitTags = [...new Set(catalog.prefabs.flatMap((p) => p.unitTags || []))].sort();
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
      Object.keys(value).some(
        (key) => !["bannedFactions", "bannedEras", "bannedTypes"].includes(key),
      )
    )
      throw Error("标签限制无效");
    const clean = {};
    for (const [key, allowed] of [
      ["bannedFactions", factions],
      ["bannedEras", eras],
      ["bannedTypes", unitTags],
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
      shareAlliedUnits: false,
      ...validateTagRestrictions(),
      teamRestrictions: [validateTagRestrictions(), validateTagRestrictions()],
    };
  }
  function formationRestrictions(settings = {}, seat = null) {
    const team = seat === null ? {} : settings.teamRestrictions?.[seatTeam(seat)] || {};
    return {
      ...(settings.mapId
        ? {
            environment: getMap(settings.mapId).environment,
            mapId: settings.mapId,
            deploymentSeat: seat ?? 0,
          }
        : {}),
      unitCostLimit: settings.unitCostLimit ?? Infinity,
      bannedFactions: [
        ...new Set([...(settings.bannedFactions || []), ...(team.bannedFactions || [])]),
      ],
      bannedEras: [...new Set([...(settings.bannedEras || []), ...(team.bannedEras || [])])],
      bannedTypes: [...new Set([...(settings.bannedTypes || []), ...(team.bannedTypes || [])])],
    };
  }
  function restrictionReason(model, restrictions = {}) {
    if (restrictions.environment && (model.adaptability?.[restrictions.environment] ?? 100) <= 0)
      return "not_allowed";
    if (
      model.movementType === "naval" &&
      restrictions.mapId &&
      !getMap(restrictions.mapId).navalDeployment
    )
      return "not_allowed";
    if (
      restrictions.bannedFactions?.includes(model.faction) ||
      model.tags.some((tag) => restrictions.bannedEras?.includes(tag)) ||
      (model.unitTags || []).some((tag) => restrictions.bannedTypes?.includes(tag))
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
      deployable: clean
        .filter((_, index) => !reasons[index])
        .map((entry) => {
          if (!entry.preload) return entry;
          const indices = clean.map((_, index) => index).filter((index) => !reasons[index]),
            carrierIndex = indices.indexOf(entry.preload.carrierIndex);
          const { preload, ...plain } = entry;
          return carrierIndex < 0 ? plain : { ...plain, preload: { ...preload, carrierIndex } };
        }),
      indices: clean.map((_, index) => index).filter((index) => !reasons[index]),
    };
  }
  const armyPercentages = Object.freeze(Array.from({ length: 12 }, (_, i) => (i + 1) * 25));
  const aiCountPercentages = armyPercentages;
  const aiDefaults = Object.freeze({ difficulty: "medium", fill: 100, countPercent: 100 });
  const aiPerformance = Object.freeze({
    easy: 0.75,
    medium: 1,
    hard: 1.25,
    ...Object.fromEntries(armyPercentages.map((percent) => [percent, percent / 100])),
  });
  function validateAISettings(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("AI 设置无效");
    const clean = { ...aiDefaults, ...value };
    if (
      !(
        armyPercentages.includes(clean.difficulty) ||
        ["easy", "medium", "hard"].includes(clean.difficulty)
      ) ||
      !armyPercentages.includes(clean.fill) ||
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
  // 玩家与 AI 共用编组设置；旧 AI 配置保留为兼容输入。
  function validateArmySettings(value = {}) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) => ![...Object.keys(aiDefaults), "unitCostLimit", "unitCostPercent"].includes(key),
      )
    )
      throw Error("玩家编组设置无效");
    const config = validateAISettings(
      Object.fromEntries(
        Object.keys(aiDefaults)
          .filter((key) => Object.hasOwn(value, key))
          .map((key) => [key, value[key]]),
      ),
    );
    const unitCostPercent = value.unitCostPercent ?? 100;
    if (!armyPercentages.includes(unitCostPercent)) throw Error("单机COST比例无效");
    return {
      ...config,
      unitCostPercent,
      unitCostLimit:
        value.unitCostLimit == null ? null : validateUnitCostLimit(value.unitCostLimit),
    };
  }
  const armySettings = (player) =>
    validateArmySettings(player?.armySettings || player?.aiSettings || {});
  function armyBudget(settings, player) {
    if (player?.formationPreset)
      return Math.max(
        maxCostLimit,
        player.formationPreset.units.reduce(
          (sum, e) => sum + models[e.unitId + "__" + e.kitId].cost,
          0,
        ),
      );
    return Math.floor((settings.costLimit * armySettings(player).fill) / 100);
  }
  function armyUnitLimit(settings, player) {
    return player?.formationPreset
      ? player.formationPreset.units.length
      : Math.max(1, Math.floor((settings.unitLimit * armySettings(player).countPercent) / 100));
  }
  function armyRestrictions(settings, player) {
    const rules = formationRestrictions(settings, player?.seat ?? null);
    const config = armySettings(player);
    rules.unitCostLimit =
      config.unitCostLimit ??
      Math.max(1, Math.floor((rules.unitCostLimit * config.unitCostPercent) / 100));
    if (player?.formationPreset) {
      rules.unitCostLimit = maxCostLimit;
      rules.bannedFactions = [];
      rules.bannedEras = [];
      rules.bannedTypes = [];
    }
    return rules;
  }
  function randomFormation(
    seed = 7319,
    maxCost = catalog.formation.maxCost,
    restrictions = {},
    unitLimit = catalog.formation.maxUnits,
  ) {
    if (!Number.isInteger(unitLimit) || unitLimit < 1 || unitLimit > catalog.formation.maxUnits * 3)
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
    const environment = restrictions.environment ?? "ground";
    const adaptation = (model) => model.adaptability?.[environment] ?? 100;
    const choices = Object.values(models).filter(
        (model) =>
          !model.formOnly &&
          !restrictionReason(model, { ...restrictions, environment }) &&
          adaptation(model) > 0 &&
          (model.weapons.length > 0 ||
            model.supplyAura ||
            model.skills?.some((s) => ["repair", "recon"].includes(s.type))),
      ),
      entries = [];
    const minimum = Math.min(...choices.map((model) => model.cost));
    const count = Math.min(unitLimit, Math.floor(maxCost / minimum));
    const bestAdaptation = Math.max(...choices.map(adaptation));
    const preferredMinimum = Math.min(
      ...choices.filter((model) => adaptation(model) === bestAdaptation).map((model) => model.cost),
    );
    const shipInterval = 6 + ((seed >>> 0) % 3);
    const desiredShips = count >= 6 ? Math.max(1, Math.floor(count / shipInterval)) : 0;
    let remaining = maxCost;
    for (let i = 0; i < count; i++) {
      // 优先填满槽位；能全员使用最佳适应性时，为后续单位保留对应预算。
      const slots = count - i;
      let reserveMinimum = remaining >= preferredMinimum * slots ? preferredMinimum : minimum;
      if (restrictions.mapId && getMap(restrictions.mapId).navalDeployment) {
        // 混合海陆出生带需保留能跨水的一格单位预算，避免末尾只剩水格却买不起空军。
        const flexibleMinimum = Math.min(
          ...choices
            .filter(
              (m) =>
                !m.footprint &&
                ["air", "hover", "amphibious"].includes(m.movementType) &&
                adaptation(m) === bestAdaptation,
            )
            .map((m) => m.cost),
        );
        if (remaining >= flexibleMinimum * slots)
          reserveMinimum = Math.max(reserveMinimum, flexibleMinimum);
      }
      const placementCache = new Map();
      const legal = choices.filter((model) => {
        if (model.cost > remaining - reserveMinimum * (slots - 1)) return false;
        if (!restrictions.mapId) return true;
        const shape = JSON.stringify([
          model.footprint || null,
          model.movementType || "ground",
          !!model.ship,
        ]);
        if (!placementCache.has(shape)) {
          const map = getMap(restrictions.mapId);
          const area = map.deploymentAreas?.[restrictions.deploymentSeat ?? 0];
          const size = (entry) => {
            const f = models[entry.unitId + "__" + entry.kitId].footprint;
            return f ? f.width * f.height : 1;
          };
          const candidate = { unitId: model.prefabId, kitId: model.kitId };
          if (
            area &&
            entries.reduce((total, entry) => total + size(entry), 0) +
              size(candidate) +
              (slots - 1) >
              area.width * area.height
          ) {
            placementCache.set(shape, false);
            return false;
          }
          placementCache.set(
            shape,
            !!deploymentPlacements(
              { mapId: map.id, tiles: map.tiles, environment: map.environment, units: [] },
              [...entries, { unitId: model.prefabId, kitId: model.kitId }],
              restrictions.deploymentSeat ?? 0,
            ),
          );
        }
        return placementCache.get(shape);
      });
      if (!legal.length) break;
      const bestLegalAdaptation = Math.max(...legal.map(adaptation));
      let preferred = legal.filter((model) => adaptation(model) === bestLegalAdaptation);
      const ships = entries.filter(
        (entry) => models[entry.unitId + "__" + entry.kitId].ship,
      ).length;
      const kind = preferred.filter((model) => !!model.ship === ships < desiredShips);
      if (kind.length) preferred = kind;
      if (ships < desiredShips) {
        const carriers = preferred.filter((model) => model.ship && model.hangars?.length);
        if (carriers.length) preferred = carriers;
      }
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const model = preferred[seed % preferred.length];
      entries.push({
        unitId: model.prefabId,
        kitId: model.kitId,
        customName: generateUnitName(model.name, entries, () => seed / 4294967296),
      });
      remaining -= model.cost;
    }
    // Assign existing squad entries to compatible hangars; never create free passengers.
    const hangars = entries.flatMap((entry, carrierIndex) =>
      (models[entry.unitId + "__" + entry.kitId].hangars || []).map((h) => ({
        carrierIndex,
        hangar: h,
        remaining: h.capacity,
      })),
    );
    for (const [index, entry] of entries.entries()) {
      const model = models[entry.unitId + "__" + entry.kitId];
      if (model.hangars?.length || !model.transport) continue;
      const compatible = hangars.filter(
        (slot) =>
          slot.carrierIndex !== index &&
          slot.remaining >= model.transport.slotCost &&
          slot.hangar.allowedTags.some((tag) => model.transport.loadTags.includes(tag)),
      );
      if (!compatible.length) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed / 4294967296 >= 0.5) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const slot = compatible[seed % compatible.length];
      entry.preload = { carrierIndex: slot.carrierIndex, hangarId: slot.hangar.id };
      slot.remaining -= model.transport.slotCost;
    }
    return entries;
  }
  // 武器只应用部位损坏惩罚；玩家强度仅影响本体耐久和 EN。
  function weaponStats(weapon, unit) {
    const attackMultiplier = parts.penalties(unit).attackMultiplier,
      previousAttack = weapon.partDamageMultiplier ?? 1;
    const liveChannels =
      weapon.pairedChannels && weapon.energySpent === undefined
        ? new Set(availableStrikes(unit, weapon).map((s) => s.channelId))
        : null;
    const en = liveChannels
      ? weapon.pairedChannels.filter((c) => liveChannels.has(c.id)).reduce((n, c) => n + c.en, 0)
      : unit.model &&
          weapon.nativeTiming?.energyMode === "perShot" &&
          weapon.energySpent === undefined
        ? new Set(
            availableStrikes(unit, weapon).map(
              (s) => `${s.at}:${weapon.attack.muzzleIndices[s.shotIndex]}`,
            ),
          ).size * weapon.nativeTiming.energyPerEmission
        : weapon.en;
    if (attackMultiplier === previousAttack && en === weapon.en) return weapon;
    const damageRatio = attackMultiplier / previousAttack;
    return {
      ...weapon,
      en,
      partDamageMultiplier: attackMultiplier,
      get name() {
        return weapon.name;
      },
      get description() {
        return weapon.description;
      },
      damagePerShot: weapon.damagePerShot * damageRatio,
      damage: weapon.damage * damageRatio,
      hit: weapon.hit,
      attack: {
        ...weapon.attack,
        strikes: weapon.attack.strikes.map((step) => ({
          ...step,
          ...(step.damageComponents
            ? {
                damageComponents: Object.fromEntries(
                  Object.entries(step.damageComponents).map(([key, value]) => [
                    key,
                    value * damageRatio,
                  ]),
                ),
              }
            : {}),
        })),
      },
      damageComponents: Object.fromEntries(
        Object.entries(weapon.damageComponents).map(([key, value]) => [key, value * damageRatio]),
      ),
    };
  }
  const scaledModels = new WeakMap();
  function performanceModelOf(unit) {
    const base = models[unit.model],
      factor = unit.performance ?? 1;
    if (factor === 1) return base;
    let variants = scaledModels.get(base);
    if (!variants) scaledModels.set(base, (variants = new Map()));
    if (!variants.has(factor)) {
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
      });
    }
    return variants.get(factor);
  }
  // Derive damage penalties from current parts; never modify a shared catalog or AI variant.
  function modelOf(unit) {
    const original = performanceModelOf(unit),
      base = unit.flying ? { ...original, movementType: "air" } : original,
      penalty = parts.penalties(base.partsBreakable === false ? {} : unit),
      environment = unit.environment ?? "ground",
      adaptability = (base.adaptability?.[environment] ?? 100) / 100;
    if (
      penalty.attackMultiplier === 1 &&
      penalty.moveMultiplier === 1 &&
      !penalty.resistancePenalty &&
      adaptability === 1
    )
      return base;
    return {
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
      move:
        adaptability === 0
          ? 0
          : penalty.moveMultiplier < 1
            ? Math.max(1, Math.floor(base.move * adaptability * penalty.moveMultiplier))
            : base.move * adaptability,
      mobility: base.mobility * adaptability,
      defenses: Object.fromEntries(
        Object.entries(base.defenses).map(([type, value]) => [
          type,
          { ...value, percent: value.percent - penalty.resistancePenalty },
        ]),
      ),
      weapons:
        penalty.attackMultiplier === 1
          ? base.weapons
          : base.weapons.map((w) => weaponStats(w, unit)),
    };
  }
  function deploymentCells(g, seat, unit = null) {
    const map = getMap(g.mapId),
      spawn = map.spawns[seat],
      cells = [];
    if (!spawn) return cells;
    const area = map.deploymentAreas?.[seat];
    if (area) {
      for (let y = area.y; y < Math.min(mapHeight(g), area.y + area.height); y++)
        for (let x = area.x; x < Math.min(mapWidth(g), area.x + area.width); x++)
          if (Number.isFinite(unit ? terrainCost(g, unit, x, y) : terrain[g.tiles[y][x]].cost))
            cells.push({ x, y });
      return cells.sort((a, b) => dist(a, spawn) - dist(b, spawn) || a.y - b.y || a.x - b.x);
    }
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
        if (
          dist({ x, y }, spawn) <= radius &&
          Number.isFinite(unit ? terrainCost(g, unit, x, y) : terrain[g.tiles[y][x]].cost)
        )
          cells.push({ x, y });
    return cells.sort((a, b) => dist(a, spawn) - dist(b, spawn) || a.y - b.y || a.x - b.x);
  }
  function deploy(g, team, id, x, y) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再调整");
    const u = g.units.find((u) => u.id === id && ownerOf(u) === team);
    if (
      !onMap(u) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !deploymentCells(g, team, u).some((c) => c.x === x && c.y === y)
    )
      throw Error("请在己方出生区的有效格子部署");
    if (!fits(g, u, x, y, u.angle, false, team)) throw Error("该部署位置已有单位");
    delete u.rotationPivot;
    u.x = x;
    u.y = y;
  }
  function confirmDeployment(g, team) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再次确认");
    for (const u of g.units.filter((u) => ownerOf(u) === team && onMap(u))) {
      if (!deploymentCells(g, team, u).some((c) => c.x === u.x && c.y === u.y))
        throw Error("单位不在有效部署区域");
      if (!fits(g, u, u.x, u.y, u.angle, false, team)) throw Error("部署位置重叠");
    }
    g.deployment[team] = true;
    return g.deployment.every(Boolean);
  }
  const terrain = {
    plain: { name: "平地", cost: 1, cover: 0, color: "#243b3d" },
    highland: { name: "高地", cost: 1, cover: 0, color: "#9c986b" },
    forest: { name: "林地", cost: 1, cover: 10, meleeCover: 10, color: "#294738" },
    rubble: { name: "废墟", cost: 2, cover: 25, meleeCover: 0, color: "#43494a" },
    rock: { name: "山岩", cost: Infinity, cover: 0, color: "#596064" },
    water: { name: "水域", cost: Infinity, cover: 0, color: "#234c61" },
  };
  // 地图配色只影响显示；移动消耗和掩护仍使用共用地形规则。
  function terrainStyle(mapId, kind) {
    const base = terrain[kind],
      color = getMap(mapId).appearance?.colors?.[kind];
    const spaceName =
      getMap(mapId).environment === "space"
        ? { plain: "宇宙空域", rock: "小行星", rubble: "漂浮残骸" }[kind]
        : null;
    return { ...base, ...(color ? { color } : {}), ...(spaceName ? { name: spaceName } : {}) };
  }
  const key = (x, y) => x + "," + y,
    dist = (a, b) => {
      const aa = dimensions(a),
        bb = dimensions(b);
      return (
        Math.max(0, a.x - (b.x + bb.width - 1), b.x - (a.x + aa.width - 1)) +
        Math.max(0, a.y - (b.y + bb.height - 1), b.y - (a.y + aa.height - 1))
      );
    },
    typeNames = { beam: "光束", shell: "实弹", melee: "格斗" };
  const skills = skillModule.create({
    models,
    modelOf,
    fits,
    dist,
    mapWidth,
    mapHeight,
    dimensions,
    parts,
  });
  // Grid anchors remain integers; a ship's explicit heading determines its whole rectangle.
  function inSupplyRange(provider, target) {
    const aura = modelOf(provider).supplyAura;
    return !!aura && dist(provider, target) <= aura.range;
  }
  function supplyCells(g, provider) {
    const aura = modelOf(provider).supplyAura;
    if (!aura) return [];
    const size = dimensions(provider),
      result = [];
    for (
      let y = Math.max(0, provider.y - aura.range);
      y < Math.min(mapHeight(g), provider.y + size.height + aura.range);
      y++
    )
      for (
        let x = Math.max(0, provider.x - aura.range);
        x < Math.min(mapWidth(g), provider.x + size.width + aura.range);
        x++
      )
        if (inSupplyRange(provider, { x, y })) result.push({ x, y });
    return result;
  }
  function dimensions(unit, angle = unit.angle ?? 0) {
    if (unit.visualOnly) return { width: 1, height: 1 };
    const footprint = models[unit.model]?.footprint || { width: 1, height: 1 };
    const horizontal = Math.abs(Math.round(angle / 90)) % 2 === 1;
    return horizontal ? { width: footprint.height, height: footprint.width } : footprint;
  }
  function cells(unit, x = unit.x, y = unit.y, angle = unit.angle) {
    const size = dimensions(unit, angle),
      result = [];
    for (let yy = 0; yy < size.height; yy++)
      for (let xx = 0; xx < size.width; xx++) result.push({ x: x + xx, y: y + yy });
    return result;
  }
  function center(unit) {
    const size = dimensions(unit);
    return { x: unit.x + (size.width - 1) / 2, y: unit.y + (size.height - 1) / 2 };
  }
  // UI destinations denote the hull centre. Integer anchors remain an internal grid representation.
  function anchorAt(unit, x, y, angle = unit.angle) {
    const size = dimensions(unit, angle);
    return { x: Math.round(x - (size.width - 1) / 2), y: Math.round(y - (size.height - 1) / 2) };
  }
  function occupies(unit, x, y) {
    const size = dimensions(unit);
    return x >= unit.x && x < unit.x + size.width && y >= unit.y && y < unit.y + size.height;
  }
  function fits(
    g,
    unit,
    x = unit.x,
    y = unit.y,
    angle = unit.angle,
    throughAllies = false,
    seat = null,
    deploymentArea = null,
  ) {
    const footprint = cells(unit, x, y, angle),
      area =
        seat === null
          ? null
          : deploymentArea || new Set(deploymentCells(g, seat, unit).map((c) => key(c.x, c.y)));
    return footprint.every(
      (c) =>
        c.x >= 0 &&
        c.y >= 0 &&
        c.x < mapWidth(g) &&
        c.y < mapHeight(g) &&
        Number.isFinite(terrainCost(g, unit, c.x, c.y)) &&
        (!area || area.has(key(c.x, c.y))) &&
        !(g.units || []).some(
          (other) =>
            other.id !== unit.id &&
            onMap(other) &&
            occupies(other, c.x, c.y) &&
            (!throughAllies || other.team !== unit.team),
        ),
    );
  }
  function canRotate(g, unit, direction) {
    if (
      !models[unit.model]?.ship ||
      ![-1, 1].includes(direction) ||
      !onMap(unit) ||
      unit.acted ||
      unit.plan
    )
      return false;
    const deploying = g.deployment && !g.deployment.every(Boolean);
    if (
      deploying
        ? g.deployment[ownerOf(unit)]
        : unit.team !== g.team || unit.moved || g.winner !== null
    )
      return false;
    const angle = (((unit.angle + direction * 90) % 360) + 360) % 360;
    // Check the entire swept bounding square; rotation cannot clip an asteroid or another unit.
    const size = dimensions(unit),
      next = dimensions(unit, angle),
      pivot = unit.rotationPivot || center(unit),
      nextAnchor = anchorAt(unit, pivot.x, pivot.y, angle),
      sweep = {
        width:
          Math.max(unit.x + size.width, nextAnchor.x + next.width) - Math.min(unit.x, nextAnchor.x),
        height:
          Math.max(unit.y + size.height, nextAnchor.y + next.height) -
          Math.min(unit.y, nextAnchor.y),
      };
    const left = Math.min(unit.x, nextAnchor.x),
      top = Math.min(unit.y, nextAnchor.y);
    for (let y = top; y < top + sweep.height; y++)
      for (let x = left; x < left + sweep.width; x++) {
        if (
          x < 0 ||
          y < 0 ||
          x >= mapWidth(g) ||
          y >= mapHeight(g) ||
          !Number.isFinite(unit ? terrainCost(g, unit, x, y) : terrain[g.tiles[y][x]].cost) ||
          g.units.some((other) => other.id !== unit.id && onMap(other) && occupies(other, x, y))
        )
          return false;
      }
    return fits(
      g,
      unit,
      nextAnchor.x,
      nextAnchor.y,
      angle,
      false,
      deploying ? ownerOf(unit) : null,
    );
  }
  function rotate(g, unit, direction) {
    if (!canRotate(g, unit, direction)) throw Error("战舰无法转向：行动已使用，或旋转区域被占用");
    const deploying = g.deployment && !g.deployment.every(Boolean);
    if (!deploying) {
      for (const other of g.units) if (ownerOf(other) === ownerOf(unit)) other.origin = null;
      unit.origin = {
        x: unit.x,
        y: unit.y,
        angle: unit.angle,
        ...(unit.rotationPivot ? { rotationPivot: { ...unit.rotationPivot } } : {}),
      };
      unit.moved = true;
    }
    unit.rotationPivot = unit.rotationPivot || center(unit);
    const nextAngle = (((unit.angle + direction * 90) % 360) + 360) % 360;
    Object.assign(unit, anchorAt(unit, unit.rotationPivot.x, unit.rotationPivot.y, nextAngle));
    unit.angle = (((unit.angle + direction * 90) % 360) + 360) % 360;
    unit.aimAngle = unit.angle;
  }
  // AI预选和真正创建单位共用完整占地检查；大舰优先，避免碎片化空位。
  function deploymentPlacements(world, formation, seat) {
    const placed = { ...world, units: [...(world.units || [])] },
      result = [],
      terrainCells = new Map();
    const entries = formation
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => !entry.preload)
      .sort((a, b) => {
        const size = (entry) => {
          const f = models[entry.unitId + "__" + entry.kitId].footprint;
          return f ? f.width * f.height : 1;
        };
        return size(b.entry) - size(a.entry) || a.i - b.i;
      });
    for (const { entry, i } of entries) {
      const model = entry.unitId + "__" + entry.kitId,
        team = seatTeam(seat);
      const heading = team ? -90 : 90;
      const probe = { id: seat + "-" + i, model, team, ownerSeat: seat, hp: 1, angle: heading };
      const movement = models[model].movementType || "ground";
      if (!terrainCells.has(movement)) {
        const cells = deploymentCells(placed, seat, probe);
        terrainCells.set(movement, { cells, area: new Set(cells.map((c) => key(c.x, c.y))) });
      }
      const available = terrainCells.get(movement);
      const position = available.cells.find((cell) =>
        fits(placed, probe, cell.x, cell.y, heading, false, seat, available.area),
      );
      if (!position) return null;
      placed.units.push({ ...probe, ...position });
      result.push({ entry, i, position, heading });
    }
    formation.forEach((entry, i) => {
      if (!entry.preload) return;
      const carrier = result.find((p) => p.i === entry.preload.carrierIndex);
      if (carrier)
        result.push({ entry, i, position: { ...carrier.position }, heading: carrier.heading });
    });
    return result;
  }
  function create(ai = false, seed = 7319, formations, deploying = false, settings = {}) {
    const map = getMap(settings.mapId),
      costLimit = validateCostLimit(settings.costLimit ?? catalog.formation.maxCost),
      unitLimit = validateUnitLimit(settings.unitLimit ?? catalog.formation.maxUnits);
    formations ??= map.spawns.map((_, seat) =>
      randomFormation(
        seed + seat,
        settings.seatCostLimits?.[seat] ?? costLimit,
        formationRestrictions({ ...settings, mapId: map.id }, seat),
        settings.seatUnitLimits?.[seat] ?? unitLimit,
      ),
    );
    if (formations.length !== map.spawns.length) throw Error("编组数量必须匹配地图席位");
    const rulesForSeat = (seat) =>
      settings.seatFormationRules?.[seat] ||
      formationRestrictions({ ...settings, mapId: map.id }, seat);
    const tiles = map.tiles.map((row) => row.slice());
    let units = [];
    for (let seat = 0; seat < formations.length; seat++) {
      // null 明确表示空出生点，不生成单位，也无需确认部署。
      if (formations[seat] === null) continue;
      formations[seat] = validateFormation(
        formations[seat],
        settings.seatCostLimits?.[seat] ?? costLimit,
        settings.seatUnitLimits?.[seat] ?? unitLimit,
      );
      const placements = deploymentPlacements(
        { tiles, units, mapId: map.id, environment: map.environment },
        formations[seat],
        seat,
      );
      if (!placements) throw Error("出生区没有足够位置容纳编组，请检查目录配置");
      placements.forEach(({ entry, i, position, heading }) => {
        if (restrictionReason(models[entry.unitId + "__" + entry.kitId], rulesForSeat(seat)))
          throw Error("编组包含不被允许的单位");
        const team = seatTeam(seat);
        const model = entry.unitId + "__" + entry.kitId;
        const performance = settings.performances?.[seat] ?? 1;
        if (!armyPercentages.some((percent) => percent / 100 === performance))
          throw Error("性能倍率无效");
        let m = modelOf({ model, performance, environment: map.environment });
        units.push({
          id: seat + "-" + (settings.formationIndices?.[seat]?.[i] ?? i),
          ownerSeat: seat,
          ...(entry.preload
            ? {
                embarked: {
                  carrierId:
                    seat +
                    "-" +
                    (settings.formationIndices?.[seat]?.[entry.preload.carrierIndex] ??
                      entry.preload.carrierIndex),
                  hangarId: entry.preload.hangarId,
                  boardRound: null,
                },
              }
            : {}),
          environment: map.environment || "ground",
          model,
          ...(entry.customName ? { customName: entry.customName } : {}),
          performance,
          team,
          x: position.x,
          y: position.y,
          hp: m.hp,
          brokenParts: {},
          ...(m.ship
            ? {
                moduleHp: Object.fromEntries(m.modules.map((module) => [module.id, module.hp])),
              }
            : {}),
          shield: m.shield.hp,
          en: m.en,
          moved: false,
          acted: false,
          actionPoints: m.actionPoints ?? 5,
          origin: null,
          counterCount: 0,
          angle: heading,
          heldWeapon: m.weapons[0]?.id ?? null,
        });
      });
    }
    units.sort(
      (a, b) =>
        a.ownerSeat - b.ownerSeat || Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]),
    );
    return {
      tiles,
      units,
      deployment: deploying ? formations.map((army) => army === null) : null,
      mapId: map.id,
      environment: map.environment || "ground",
      costLimit,
      unitLimit,
      team: 0,
      round: 1,
      ai,
      seed: seed >>> 0,
      partSeed: (seed ^ 0x85ebca6b) >>> 0,
      winner: null,
    };
  }
  function at(g, x, y) {
    return g.units.find((u) => onMap(u) && occupies(u, x, y));
  }
  // 敌军上下左右相邻的格子消耗至少3点；地形更昂贵时仍按地形计算。
  function terrainCost(g, u, x, y) {
    const movement = modelOf(u).movementType;
    const tile = g.tiles[y][x];
    if (g.environment !== "space") {
      if (movement === "air") return 1;
      if (movement === "naval") return tile === "water" ? 1 : Infinity;
      if (tile === "water" && ["amphibious", "hover"].includes(movement)) return 1;
    }
    return terrain[g.tiles[y][x]].cost;
  }
  function movementCost(g, u, x, y) {
    const base = terrainCost(g, u, x, y);
    return g.units.some(
      (enemy) => onMap(enemy) && enemy.team !== u.team && dist(enemy, { x, y }) === 1,
    )
      ? Math.max(base, 3)
      : base;
  }
  // 按地形消耗搜索可达格子，同时保存各格子的移动路径。
  function reachable(g, u, starts = null) {
    if (!onMap(u)) return new Map();
    const moveLimit = modelOf(u).move;
    const initial = starts || [{ x: u.x, y: u.y, cost: 0, path: [] }];
    let best = new Map(initial.filter((p) => p.cost <= moveLimit).map((p) => [key(p.x, p.y), p])),
      queue = [...best.values()];
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
        if (!fits(g, u, x, y, u.angle, true)) continue;
        let cost = n.cost + Math.max(...cells(u, x, y).map((c) => movementCost(g, u, c.x, c.y)));
        if (cost > moveLimit) continue;
        let k = key(x, y);
        if (best.has(k) && best.get(k).cost <= cost) continue;
        let entry = { x, y, cost, path: [...n.path, { x, y }] };
        best.set(k, entry);
        queue.push(entry);
      }
    }
    // 友军可作为路径中间点，但不能作为移动终点。
    for (const [cell, entry] of best) {
      if (!fits(g, u, entry.x, entry.y)) best.delete(cell);
    }
    return best;
  }
  // 朝向由裁定状态保存，快照、重连和各客户端使用同一个结果。
  function faceTarget(unit, target) {
    const sourceCenter = center(unit),
      targetCenter = center(target),
      dx = targetCenter.x - sourceCenter.x,
      dy = targetCenter.y - sourceCenter.y;
    if (dx || dy) {
      const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (!models[unit.model]?.ship) unit.angle = angle;
    }
  }
  function move(g, u, x, y) {
    if (!onMap(u) || g.winner !== null || u.team !== g.team || u.acted || u.moved)
      throw Error("本单位无法移动");
    let tile = reachable(g, u).get(key(x, y));
    if (!tile || !tile.path.length) throw Error("该位置不可移动");
    // 只有同一玩家的后续成功移动才会提交先前移动；友军玩家独立撤回。
    for (const other of g.units) {
      if (ownerOf(other) === ownerOf(u)) other.origin = null;
    }
    u.origin = {
      x: u.x,
      y: u.y,
      angle: u.angle,
      ...(u.rotationPivot ? { rotationPivot: { ...u.rotationPivot } } : {}),
    };
    const from = tile.path.length > 1 ? tile.path[tile.path.length - 2] : u;
    const direction = { ...from };
    faceTarget(direction, { x, y });
    if (!models[u.model]?.ship) u.angle = direction.angle;
    u.x = x;
    u.y = y;
    delete u.rotationPivot;
    u.moved = true;
    return tile.path;
  }
  function canUndo(g, u) {
    return (
      g.winner === null &&
      onMap(u) &&
      u.team === g.team &&
      !u.acted &&
      u.moved &&
      !!u.origin &&
      u.lastCargoLaunchRound !== g.round &&
      fits(g, u, u.origin.x, u.origin.y, u.origin.angle)
    );
  }
  function undo(g, u) {
    if (!canUndo(g, u)) throw Error("无法撤销：己方编组的后续单位已移动或原位置被占用");
    Object.assign(u, u.origin);
    if (!u.origin.rotationPivot) delete u.rotationPivot;
    u.origin = null;
    u.moved = false;
  }
  function moduleCanBear(unit, moduleId, target) {
    if (!moduleId || !target) return true;
    const module = models[unit.model]?.modules?.find((m) => m.id === moduleId);
    if (!module) return false;
    const a = center(unit),
      b = center(target),
      aim = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
    const delta = ((((aim - (unit.angle ?? 0) - module.idleDir + 180) % 360) + 360) % 360) - 180;
    return Math.abs(delta) <= module.arc;
  }
  function availableStrikes(u, w, target = null) {
    if (parts.unavailable(u, w).length) return [];
    return w.attack.strikes.filter(
      (step) => !parts.unavailable(u, step).length && moduleCanBear(u, step.moduleId, target),
    );
  }
  function actionBudget(u) {
    return modelOf(u).actionPoints ?? 5;
  }
  function counterActionBudget(u) {
    return Math.ceil(actionBudget(u) * 0.75);
  }
  function actionPoints(u) {
    return u.actionPoints ?? actionBudget(u);
  }
  function actionCost(w) {
    return w.actionCost ?? 2;
  }
  function attackQueue(g, u, target, weapons) {
    if (!Array.isArray(weapons) || !weapons.length || weapons.length > 32)
      throw Error("请选择有效的武器序列");
    if (weapons.some((w) => !w || !canAttack(g, u, target, w)))
      throw Error("武器、目标、射程或部位条件不满足");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    const ap = weapons.reduce((n, w) => n + actionCost(w), 0);
    const en = weapons.reduce((n, w) => n + weaponStats(w, u).en, 0);
    if (ap > actionPoints(u) + (u.plan?.actionCost ?? 0)) throw Error("行动点不足");
    if (en > u.en) throw Error("武器序列总EN不足");
    return { ap, en };
  }
  function counterQueue(g, u, target, weapons) {
    if (!Array.isArray(weapons) || !weapons.length || weapons.length > 32)
      throw Error("请选择有效的反击武器序列");
    if (weapons.some((w) => !w || !canCounter(g, u, target, w)))
      throw Error("反击次数已用完，或武器不满足射程与 EN 条件");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    const ap = weapons.reduce((n, w) => n + actionCost(w), 0);
    const en = weapons.reduce((n, w) => n + weaponStats(w, u).en, 0);
    if (ap > counterActionBudget(u)) throw Error("反击行动点不足");
    if (en > u.en) throw Error("反击武器序列总EN不足");
    return { ap, en };
  }
  function weaponCooldown(u, w) {
    return u.weaponCooldowns?.[w?.id] || 0;
  }
  function startWeaponCooldown(u, w) {
    if (["mortar", "snipe"].includes(w?.special?.type)) (u.weaponCooldowns ||= {})[w.id] = 2;
  }
  function canUse(u, w) {
    return (
      !!w &&
      !weaponCooldown(u, w) &&
      onMap(u) &&
      u.en >= weaponStats(w, u).en &&
      !parts.unavailable(u, w).length &&
      availableStrikes(u, w).length > 0
    );
  }
  function inRange(a, b, w) {
    let d = dist(a, b);
    return d >= w.min && d <= w.max;
  }
  function targetModifier(g, target, weapon) {
    const targetModel = modelOf(target);
    if (
      ["bomb", "mortar"].includes(weapon.special?.type) &&
      (targetModel.movementType === "air" ||
        targetModel.sourceStats?.nativeTags?.includes("Aircraft"))
    )
      return 0;
    if (!weapon.targetModifiers) return 1;
    const category =
      g.environment === "space"
        ? "space"
        : targetModel.movementType === "air"
          ? "air"
          : g.tiles[target.y][target.x] === "water"
            ? "water"
            : "ground";
    return weapon.targetModifiers[category] ?? 1;
  }
  function groundTarget(g, a, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !g.tiles[y]?.[x]) return null;
    return {
      id: null,
      x,
      y,
      team: 1 - a.team,
      model: a.model,
      hp: 1,
      visualOnly: true,
      groundTarget: true,
    };
  }
  function canAttack(g, a, b, w) {
    if (b?.groundTarget)
      return (
        !!groundTarget(g, a, b.x, b.y) &&
        w?.special?.type === "mortar" &&
        onMap(a) &&
        canUse(a, w) &&
        inRange(a, b, w) &&
        availableStrikes(a, w, b).length > 0
      );
    return (
      !!a &&
      !!b &&
      onMap(a) &&
      onMap(b) &&
      a.team !== b.team &&
      canUse(a, w) &&
      targetModifier(g, b, w) > 0 &&
      inRange(a, b, w) &&
      availableStrikes(a, w, b).length > 0
    );
  }
  // Scatter records carry only shot indices and energy actually paid; clients rebuild the same visual slice.
  function eventWeapon(unit, event) {
    const weapon = modelOf(unit).weapons.find((w) => w.id === event.weapon);
    if (!event.shotIndices) return weapon;
    const indices = event.shotIndices;
    const strikes = weapon.attack.strikes
      .filter((s) => indices.includes(s.shotIndex))
      .map((s, i) => ({
        ...s,
        shotIndex: indices.indexOf(s.shotIndex),
        at: s.at,
        hitIndex: s.hitIndex || 0,
      }));
    const attack = {
      ...weapon.attack,
      shots: indices.map((i) => weapon.attack.shots[i]),
      duration: Math.max(...indices.map((i) => weapon.attack.shots[i])) + 0.3,
      strikes,
      muzzleIndices: indices.map((i) => weapon.attack.muzzleIndices[i] || 0),
      muzzleShotIndices: indices.map((i) => weapon.attack.muzzleShotIndices?.[i] || 0),
      animations: weapon.attack.animations,
    };
    return {
      ...weapon,
      en: event.energySpent ?? weapon.en,
      energySpent: event.energySpent,
      min: 0,
      max: 1000,
      shotCount: indices.length,
      damage: strikes.reduce(
        (n, s) =>
          n +
          Object.values(s.damageComponents || weapon.damageComponents).reduce(
            (sum, value) => sum + value,
            0,
          ) *
            (s.damageMultiplier ?? 1),
        0,
      ),
      attack,
    };
  }
  function countersRemaining(u) {
    return Math.max(0, Math.min(1, modelOf(u).counterLimit ?? 1) - (u.counterCount ?? 0));
  }
  function canCounter(g, a, b, w) {
    return (
      !!a &&
      !!w &&
      !w.noCounter &&
      actionCost(w) <= counterActionBudget(a) &&
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
      ground = terrain[g.tiles[b.y][b.x]],
      cover = w.type === "melee" ? (ground.meleeCover ?? 0) : ground.cover,
      mobilityPenalty = (defender.mobility * (response === "evade" ? 1.25 : 1) - 100) * 0.25,
      sizeModifier = w.antiSize?.[defender.ship ? "large" : "small"] || { damage: 1, accuracy: 1 },
      targetFactor = targetModifier(g, b, w),
      sensorBonus =
        b.spottedUntilRound >= g.round
          ? 10
          : defender.stealth &&
              (!defender.stealth.waterOnly || g.tiles[b.y][b.x] === "water") &&
              dist(a, b) > 1
            ? -10
            : 0,
      baseHit =
        Math.max(
          10,
          Math.min(
            100,
            (w.attack.strikes.length === 1 && w.attack.strikes[0].accuracy !== undefined
              ? (w.attack.strikes[0].accuracy * w.hit) / (w.sourceHit || w.hit || 1)
              : w.hit) *
              (modelOf(a).accuracy / 100) *
              sizeModifier.accuracy *
              targetFactor +
              sensorBonus -
              cover -
              mobilityPenalty,
          ),
        ) * (isCounter ? 0.75 : 1),
      // 最终回避加成在机动性、地形与反击惩罚计算后生效。
      hit = Math.min(
        100,
        Math.max(0, baseHit - (response === "evade" ? 15 : 0)) * (w.hitScale || 1),
      ),
      defenseMultiplier = response === "defend" ? 1.25 : 1,
      finalDamageMultiplier = response === "defend" ? 0.75 : 1,
      strikes = availableStrikes(a, w, b);
    // MOD: subtract flat protection per projectile/component, then apply percentage protection.
    let components = w.damageComponents;
    function protectedDamage(defenses, damageMultiplier, share = 1) {
      return (
        Object.entries(components).reduce((sum, [channel, value]) => {
          const ap = channel.endsWith("AP");
          if (ap && defenses === defender.shield.defenses) return sum;
          if (ap) channel = channel.slice(0, -2);
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
              value *
                damageMultiplier *
                categoryBonus *
                elementBonus *
                sizeModifier.damage *
                targetFactor *
                (ap ? 1 : share) -
                (ap ? 0 : defenses[flatKey].flat * defenseMultiplier),
            ) *
              (1 -
                Math.min(100, (defenses[percentKey].percent * defenseMultiplier) / (ap ? 4 : 1)) /
                  100)
          );
        }, 0) * finalDamageMultiplier
      );
    }
    let damage = 0,
      shieldDamage = 0,
      blockedDamage = 0;
    const shieldAvailable = parts.shieldUsable(b, defender.shield);
    let shieldLeft = shieldAvailable ? Math.max(0, b.shield ?? 0) : 0;
    for (const strike of strikes) {
      components = strike.damageComponents || w.damageComponents;
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
        shieldAvailable && b.shield > 0
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
    const counterIds = Array.isArray(counterId) ? counterId : [counterId];
    if (response === "counter" && allowCounter)
      counterQueue(
        g,
        b,
        a,
        counterIds.map((id) => modelOf(b).weapons.find((w) => w.id === id)),
      );
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
        partsBefore = { ...to.brokenParts },
        modulesBefore = to.moduleHp ? { ...to.moduleHp } : null,
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
          executed =
            to.hp > 0 &&
            !parts.unavailable(from, step).length &&
            moduleCanBear(from, step.moduleId, to),
          hit = executed && random(g) < e.hit / 100,
          blocked = hit && to.shield > 0 && random(g) < e.blockChance,
          shieldDamage = blocked ? e.shieldDamage : 0,
          damage = hit ? Math.min(to.hp, blocked ? e.blockedDamage : e.damage) : 0;
        const hpBefore = to.hp,
          shieldBeforeStrike = to.shield;
        to.hp -= damage;
        to.shield -= shieldDamage;
        const brokenPart = hit
          ? parts.applyHit(
              g,
              to,
              modelOf(to),
              damage,
              step.partBreakModifier ?? weapon.partBreakModifier ?? 1,
            )
          : null;
        const wasOverdrive = !!to.overdrive;
        const formReverted = skills.revertDamaged(to);
        const overdriveEnded = wasOverdrive && !to.overdrive;
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
          shieldDamage: shieldBeforeStrike - to.shield,
          before: hpBefore,
          after: to.hp,
          shieldBefore: shieldBeforeStrike,
          shieldAfter: to.shield,
          brokenParts: brokenPart ? [brokenPart] : [],
          partsAfter: { ...to.brokenParts },
          modelAfter: to.model,
          flyingAfter: !!to.flying,
          formReverted,
          overdriveEnded,
          ...(to.moduleHp ? { modulesAfter: { ...to.moduleHp } } : {}),
          hitChance: e.hit,
        });
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
        partsBefore,
        ...(modulesBefore ? { modulesBefore, modulesAfter: { ...to.moduleHp } } : {}),
        partsAfter: { ...to.brokenParts },
        targetModelAfter: to.model,
        overdriveEnded: strikes.some((s) => s.overdriveEnded),
        brokenParts: strikes.flatMap((strike) => strike.brokenParts),
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
    if (response === "counter" && allowCounter && b.hp > 0 && a.hp > 0) {
      let remaining = counterActionBudget(b),
        started = false;
      for (const id of counterIds) {
        const weapon = modelOf(b).weapons.find((w) => w.id === id);
        if (b.hp <= 0 || a.hp <= 0) break;
        if (
          !weapon ||
          weapon.noCounter ||
          actionCost(weapon) > remaining ||
          !canAttack(g, b, a, weapon)
        )
          continue;
        if (!started) {
          b.counterCount = (b.counterCount ?? 0) + 1;
          b.counterTargetId = a.id;
          started = true;
        }
        remaining -= actionCost(weapon);
        fire(b, a, weapon, "counter", true);
      }
    }
    a.acted = true;
    a.origin = null;
    const evacuations = hangars.evacuate(g);
    for (const event of events)
      event.evacuations = evacuations.filter(
        (e) => e.carrierId === event.to && event.after <= 0 && event.before > 0,
      );
    let alive = [0, 1].map((t) => g.units.some((u) => u.team === t && u.hp > 0));
    if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
    return events;
  }
  function wait(g, u) {
    if (!onMap(u) || g.winner !== null || u.team !== g.team || u.acted) throw Error("无法待机");
    u.acted = true;
    u.actionPoints = 0;
    u.origin = null;
  }
  function end(g) {
    if (g.winner !== null) throw Error("战斗已经结束");
    g.turnEffects = [];
    for (const u of g.units) if (!u.overdrive) skills.revertDamaged(u);
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0 && u.overdrive)) {
      const active = u.overdrive,
        m = modelOf(u);
      const forced = !!u.brokenParts?.head;
      if (!forced) {
        u.hp = Math.max(0, u.hp - Math.round((m.hp * active.hpDrainPercent) / 100));
        u.en = Math.max(0, u.en - (m.en * active.enDrainPercent) / 100);
        active.remaining--;
      }
      const expired = forced || active.remaining <= 0;
      if (expired) skills.endOverdrive(u);
      g.turnEffects.push({
        type: "overdrive",
        unitId: u.id,
        skillId: active.skillId,
        expired,
        hp: u.hp,
        en: u.en,
      });
    }
    g.team = 1 - g.team;
    g.round++;
    // One round number is one team action phase; all counter budgets refresh on handoff.
    for (const u of g.units) {
      u.counterCount = 0;
      delete u.counterTargetId;
    }
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0)) {
      for (const id of Object.keys(u.weaponCooldowns || {})) {
        if (--u.weaponCooldowns[id] <= 0) delete u.weaponCooldowns[id];
      }
      // Hangar maintenance ticks only on the passenger team's incoming turn.
      if (
        u.embarked &&
        g.units.some((carrier) => carrier.id === u.embarked.carrierId && carrier.hp > 0)
      ) {
        const m = modelOf(u);
        u.hp = Math.min(m.hp, u.hp + Math.round(m.hp * 0.25));
        u.en = Math.min(m.en, u.en + m.en * 0.5);
        const damaged = Object.keys(u.brokenParts || {}).filter((part) => u.brokenParts[part]);
        for (let i = 0; i < 2 && damaged.length; i++) {
          const part = damaged.splice(Math.floor(random(g) * damaged.length), 1)[0];
          delete u.brokenParts[part];
          const module = m.modules?.find((entry) => entry.id === part);
          if (module && u.moduleHp) u.moduleHp[part] = module.hp;
        }
      }
      const maintenance = modelOf(u).autoRepair;
      if (maintenance && u.hp < modelOf(u).hp && u.en >= maintenance.enCost) {
        u.en -= maintenance.enCost;
        u.hp = Math.min(
          modelOf(u).hp,
          u.hp + Math.round((modelOf(u).hp * maintenance.hpPercent) / 100),
        );
      }
      u.acted = false;
      u.actionPoints = actionBudget(u);
      u.moved = false;
      u.origin = null;
    }
    // Supply ticks once on the recipient team's turn, with no stacking from overlapping providers.
    const providers = g.units.filter((u) => onMap(u) && u.team === g.team && modelOf(u).supplyAura);
    for (const u of g.units.filter((u) => onMap(u) && u.team === g.team)) {
      const aura = providers
        .map((provider) => ({ provider, aura: modelOf(provider).supplyAura }))
        .find(({ provider, aura }) => inSupplyRange(provider, u));
      if (!aura) continue;
      const m = modelOf(u);
      u.hp = Math.min(m.hp, u.hp + Math.round((m.hp * aura.aura.hpPercent) / 100));
      u.en = Math.min(m.en, u.en + (m.en * aura.aura.enPercent) / 100);
    }
    for (const u of g.units.filter((u) => u.team === g.team && u.snipeOrder)) {
      const order = u.snipeOrder;
      if (order.readyRound > g.round) continue;
      delete u.snipeOrder;
      const target = g.units.find((t) => t.id === order.target),
        weapon = modelOf(u).weapons.find((w) => w.id === order.weapon);
      if (target && weapon && canAttack(g, u, target, weapon)) {
        u.readySnipe = { target: target.id, weapon: weapon.id };
        u.plan = { ...u.readySnipe, charged: true };
        u.acted = true;
        u.actionPoints = 0;
      }
    }
    g.turnEffects.push(...hangars.evacuate(g).map((e) => ({ type: "evacuation", ...e })));
    const alive = [0, 1].map((team) => g.units.some((u) => u.team === team && u.hp > 0));
    if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
  }
  // 待机不阻止自动结束；仍可使用脱出等非攻击技能时保留行动机会。
  function hasActions(g, ownerSeat = null) {
    if (g.winner !== null || (g.deployment && !g.deployment.every(Boolean))) return false;
    const enemies = g.units.filter((u) => u.team !== g.team && onMap(u));
    return g.units.some((u) => {
      if (
        u.team !== g.team ||
        u.hp <= 0 ||
        (u.embarked && !hangars.launchCells(g, u).length) ||
        u.acted ||
        (ownerSeat !== null && ownerOf(u) !== ownerSeat)
      )
        return false;
      if (u.embarked) return true;
      if (skills.of(u).some((skill) => skills.targets(g, u, skill.id).length)) return true;
      if (!u.moved && (reachable(g, u).size > 1 || canRotate(g, u, 1) || canRotate(g, u, -1)))
        return true;
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
  function aiChoice(g, u, destinations = null) {
    let cells =
        destinations ??
        (u.moved ? [{ x: u.x, y: u.y, cost: 0, path: [] }] : [...reachable(g, u).values()]),
      enemies = g.units.filter((e) => e.team !== u.team && onMap(e)),
      best = null;
    if (!destinations && models[u.model]?.ship && !u.moved)
      for (const direction of [-1, 1])
        if (canRotate(g, u, direction)) {
          const pivot = u.rotationPivot || center(u);
          cells.push({
            ...anchorAt(u, pivot.x, pivot.y, u.angle + direction * 90),
            cost: 1,
            rotation: direction,
            path: [],
          });
        }
    for (const c of cells) {
      let virtual = {
          ...u,
          x: c.x,
          y: c.y,
          ...(c.rotation ? { angle: u.angle + c.rotation * 90 } : {}),
        },
        near = Math.min(...enemies.map((e) => dist(virtual, e)));
      let score = -near * 0.12 - c.cost * 0.025 + terrain[g.tiles[c.y][c.x]].cover * 0.006,
        target = null,
        weapon = null;
      for (const e of enemies)
        for (const w of modelOf(u).weapons)
          if (
            (!destinations || w.slot !== "skill") &&
            actionCost(w) <= actionPoints(u) + (u.plan?.actionCost ?? 0) &&
            canAttack(g, virtual, e, w)
          ) {
            let ex = estimate(g, virtual, e, w),
              s =
                2 +
                (ex.damage * ex.hit) / 100000 +
                Math.min(1, ex.damage / e.hp) * 0.6 -
                c.cost * 0.025 -
                (destinations ? near * 0.12 : 0);
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
  function aiLaunchChoice(g, u) {
    if (!hangars.shouldLaunch(g, u)) return null;
    const destinations = hangars.launchCells(g, u);
    if (!destinations.length) return null;
    const passenger = {
      ...u,
      embarked: undefined,
      moved: true,
      actionPoints: Math.ceil(actionPoints(u) * 0.75),
    };
    return aiChoice(g, passenger, destinations);
  }
  const hangars = hangarModule.create({
    modelOf,
    ownerOf,
    canControlUnit,
    cells,
    fits,
    mapWidth,
    mapHeight,
    reachable,
    movementCost,
  });
  return {
    onMap,
    unitTagName: (tag) =>
      ({
        MS: "MS",
        MA: "MA",
        MobilePod: "机动吊舱",
        Ship: "舰船",
        Tank: "坦克",
        Vehicle: "车辆",
        Aircraft: "航空器",
        Helicopter: "直升机",
        Infantry: "步兵",
        Amphibious: "两栖",
        Hover: "气垫",
        Support: "补给",
        Recon: "侦察",
        Transport: "搭载",
      })[tag] || tag,
    hangars,
    W,
    getMap,
    mapWidth,
    mapHeight,
    columnLabel,
    seatTeam,
    ownerOf,
    canControlUnit,
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
    unitTags,
    maxCostLimit,
    movementCost,
    H,
    models,
    catalog,
    validateFormation,
    normalizeUnitName,
    generateUnitName,
    unitName,
    randomFormation,
    unitSkills: skills.of,
    canUseSkill: skills.canUse,
    skillTargets: skills.targets,
    useSkill: skills.use,
    terrainCost,
    planFormation,
    validateArmySettings,
    armySettings,
    armyBudget,
    armyUnitLimit,
    armyRestrictions,
    aiDefaults,
    aiCountPercentages,
    armyPercentages,
    aiUnitLimit,
    aiPerformance,
    validateAISettings,
    aiBudget,
    modelOf,
    weaponStats,
    inSupplyRange,
    supplyCells,
    dimensions,
    cells,
    center,
    anchorAt,
    occupies,
    fits,
    canRotate,
    rotate,
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
    eventWeapon,
    random,
    weaponCooldown,
    startWeaponCooldown,
    canUse,
    actionBudget,
    counterActionBudget,
    actionPoints,
    actionCost,
    attackQueue,
    counterQueue,
    moduleCanBear,
    availableStrikes,
    partNames: {
      ...parts.names,
      ...Object.fromEntries(
        catalog.prefabs.flatMap((p) => (p.stats.modules || []).map((m) => [m.id, m.name])),
      ),
    },
    partPenalties: parts.penalties,
    brokenWeaponParts: parts.unavailable,
    partBreakChance: parts.chance,
    inRange,
    groundTarget,
    canAttack,
    estimate,
    fight,
    wait,
    end,
    hasActions,
    turnTransitionMs,
    bestResponse,
    aiChoice,
    aiLaunchChoice,
  };
})();
if (typeof module !== "undefined") module.exports = Tactics;
