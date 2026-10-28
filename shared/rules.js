/* 服务端与离线试玩共用的规则，不在这里调整 UI 尺寸或特效。
 * g = 对局，u = 单位，a/b = 攻防双方，w = 武器。
 */
"use strict";
const Tactics = (() => {
  // 机体数值配置。视觉大小另存于 client/ui-layout.json，不影响战斗属性。
  const catalog =
    typeof ART !== "undefined" ? ART : require("../tools/load-catalog.cjs").loadCatalog();
  const models = catalog.models;
  const development =
    typeof Development !== "undefined" ? Development : require("./development.js");
  const parts = typeof UnitParts !== "undefined" ? UnitParts : require("./unit-parts.js");
  const skillModule = typeof UnitSkills !== "undefined" ? UnitSkills : require("./unit-skills.js");
  const hangarModule = typeof UnitHangars !== "undefined" ? UnitHangars : require("./hangars.js");
  const sensorModule =
    typeof UnitSensors !== "undefined" ? UnitSensors : require("./unit-sensors.js");
  const pilots = typeof PilotSystem !== "undefined" ? PilotSystem : require("./pilots.js");
  // SFS passengers remain independent combat actors; enclosed cargo stays hidden.
  const onMap = (u) => !!u && u.hp > 0 && (!u.embarked || u.embarked.exposed === true);
  const sensors = sensorModule.create({ modelOf, cells, onMap, minovskyAt });
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
      throw Error("编组单位点数上限必须为3～" + catalog.formation.maxUnits + "点");
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
  const formationWeight = (model) => (model.ship ? 4 : model.unitTags?.includes("MS") ? 2 : 1);
  const formationPoints = (entries) =>
    entries.reduce((total, entry) => {
      const model = models[entry.unitId + "__" + entry.kitId];
      return total + (model ? formationWeight(model) : 0);
    }, 0);
  // 编组与房间的单位限制均按占用点数计算。
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
      unitLimit > catalog.formation.maxUnits
    )
      throw Error("编组无效，请检查单位点数上限");
    let cost = 0;
    const assignedPilots = new Set();
    const clean = entries.map((entry) => {
      const alias = catalog.prefabs.find((p) => p.id === entry?.unitId)?.kitAliases?.[entry?.kitId];
      const id = entry?.unitId + "__" + (alias || entry?.kitId),
        model = models[id];
      if (!model || model.formOnly) throw Error("编组包含不可用单位或武器套件");
      const customPilot = entry.customPilot ? pilots.custom(entry.customPilot) : null;
      cost += model.cost + pilots.cost(customPilot);
      const customName = normalizeUnitName(entry.customName);
      const pilotId = customPilot?.id || pilots.validate(entry.pilotId, model);
      if (pilotId && assignedPilots.has(pilotId)) throw Error("同一驾驶员不能配属多台单位");
      if (pilotId) assignedPilots.add(pilotId);
      return {
        unitId: model.prefabId,
        kitId: model.kitId,
        ...(customName ? { customName } : {}),
        ...(customPilot ? { customPilot } : pilotId ? { pilotId } : {}),
      };
    });
    if (formationPoints(clean) > unitLimit) throw Error("编组单位点数超出上限");
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
        used =
          (capacity.get(key) || 0) +
          (hangar.kind === "sfs" ? 1 : passenger.transport?.slotCost || 1);
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
      catalog.prefabs.flatMap((prefab) =>
        prefab.tags.filter((tag) => /^\d{4}(?:[EL])?$/.test(tag)),
      ),
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
      let tags = value[key] ?? [];
      // Saved pre-split room rules used 0079 for both early and late units.
      if (key === "bannedEras" && Array.isArray(tags))
        tags = tags.flatMap((tag) =>
          tag === "0079" ? eras.filter((era) => era.startsWith("0079")) : [tag],
        );
      if (!Array.isArray(tags) || tags.some((tag) => !allowed.includes(tag)))
        throw Error("标签限制无效");
      clean[key] = [...new Set(tags)].sort();
    }
    return clean;
  }
  function validateTeamFactions(value) {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some((faction) => faction !== null && !["PMC", "EFSF", "ZEON"].includes(faction))
    )
      throw Error("队伍强制阵营无效。");
    return [...value];
  }
  function validateTeamRestrictions(value) {
    if (!Array.isArray(value) || value.length !== 2) throw Error("队伍标签限制无效");
    return value.map(validateTagRestrictions);
  }
  function validateFogMode(value = "full") {
    if (!["full", "visible", "disabled"].includes(value)) throw Error("战争迷雾设置无效");
    return value;
  }
  function validateBattleMode(value = "regular") {
    if (!["regular", "quick"].includes(value)) throw Error("对战模式无效");
    return value;
  }
  function defaultRoomSettings() {
    return {
      mode: "regular",
      fogMode: "full",
      mapId: catalog.defaultMap,
      costLimit: 900,
      unitLimit: 12,
      unitCostLimit: 250,
      shareAlliedUnits: false,
      ...validateTagRestrictions(),
      teamRestrictions: [validateTagRestrictions(), validateTagRestrictions()],
      teamFactions: [null, null],
    };
  }
  function formationRestrictions(settings = {}, seat = null) {
    const teamRules =
      seat === null || settings.mode !== "quick"
        ? null
        : settings.teamRestrictions?.[seatTeam(seat)];
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
        ...new Set([...(settings.bannedFactions || []), ...(teamRules?.bannedFactions || [])]),
      ],
      bannedEras: [...new Set([...(settings.bannedEras || []), ...(teamRules?.bannedEras || [])])],
      bannedTypes: [
        ...new Set([...(settings.bannedTypes || []), ...(teamRules?.bannedTypes || [])]),
      ],
    };
  }
  function normalizeInventory(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("单位库存无效");
    const result = {};
    for (const [id, count] of Object.entries(value)) {
      if (!catalog.prefabs.some((p) => p.id === id) || !Number.isSafeInteger(count) || count < 0)
        throw Error("单位库存无效：" + id);
      result[id] = count;
    }
    return result;
  }
  function inventoryPlan(entries, inventory) {
    const used = {},
      required = {},
      missing = [];
    entries.forEach((entry, index) => {
      const id = entry.unitId;
      required[id] = (required[id] || 0) + 1;
      used[id] = (used[id] || 0) + 1;
      if (used[id] > (inventory[id] || 0)) missing.push(index);
    });
    return { missing, required };
  }
  function restrictionReason(model, restrictions = {}) {
    if (model.wip) return "wip";
    if (
      ["EFSF", "ZEON"].includes(restrictions.characterFaction) &&
      !(model.availableFactions || [model.faction]).includes(restrictions.characterFaction)
    )
      return "faction_mismatch";
    if (
      ["PMC", "EFSF", "ZEON"].includes(restrictions.characterFaction) &&
      !development.allows(restrictions.characterFaction, model.prefabId, restrictions.researched) &&
      !((restrictions.inventory ?? restrictions.ownedInventory)?.[model.prefabId] > 0)
    )
      return "not_developed";
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
      model.tags.some(
        (tag) =>
          restrictions.bannedEras?.includes(tag) ||
          (restrictions.bannedEras?.includes("0079") && /^0079[EL]$/.test(tag)),
      ) ||
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
    const clean = validateFormation(entries, Infinity, catalog.formation.maxUnits);
    const costs = clean.map(
      (entry) => models[entry.unitId + "__" + entry.kitId].cost + pilots.cost(entry.customPilot),
    );
    const totalCost = costs.reduce((sum, value) => sum + value, 0);
    const reasons = {};
    clean.forEach((entry, index) => {
      const reason = restrictionReason(models[entry.unitId + "__" + entry.kitId], restrictions);
      if (reason) reasons[index] = reason;
    });
    if (restrictions.inventory !== undefined) {
      const inventory = normalizeInventory(restrictions.inventory);
      // Disabled units do not reserve stock ahead of units that can actually deploy.
      const candidates = clean.flatMap((entry, index) =>
        reasons[index] ? [] : [{ entry, index }],
      );
      for (const i of inventoryPlan(
        candidates.map((c) => c.entry),
        inventory,
      ).missing)
        reasons[candidates[i].index] = "inventory";
    }
    let occupied = 0;
    clean.forEach((entry, index) => {
      if (reasons[index]) return;
      const weight = formationWeight(models[entry.unitId + "__" + entry.kitId]);
      if (occupied + weight > unitLimit) reasons[index] = "count";
      else occupied += weight;
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
          (sum, e) => sum + models[e.unitId + "__" + e.kitId].cost + pilots.cost(e.customPilot),
          0,
        ),
      );
    return Math.floor((settings.costLimit * armySettings(player).fill) / 100);
  }
  function armyUnitLimit(settings, player) {
    return player?.formationPreset
      ? formationPoints(player.formationPreset.units)
      : Math.min(
          catalog.formation.maxUnits,
          Math.max(1, Math.floor((settings.unitLimit * armySettings(player).countPercent) / 100)),
        );
  }
  function armyRestrictions(settings, player) {
    const rules = formationRestrictions(settings, player?.seat ?? null);
    rules.characterFaction = ["PMC", "EFSF", "ZEON"].includes(player?.characterFaction)
      ? player.characterFaction
      : null;
    // Bots have no persistent player progression. Give them the complete tech
    // catalog while preserving faction, era, WIP, map and COST restrictions.
    rules.researched = player?.bot
      ? Object.fromEntries(
          ["EFSF", "ZEON"].map((faction) => [
            faction,
            development.nodes(faction).map((node) => node.id),
          ]),
        )
      : player?.researched;
    if (player && !player.bot) {
      rules.inventory = normalizeInventory(player.inventory);
      // Readiness may skip quantity checks while retaining ownership-based deployment access.
      rules.ownedInventory = rules.inventory;
    }
    const config = armySettings(player);
    rules.unitCostLimit =
      config.unitCostLimit ??
      Math.max(1, Math.floor((rules.unitCostLimit * config.unitCostPercent) / 100));
    if (player?.formationPreset) {
      rules.unitCostLimit = maxCostLimit;
    }
    return rules;
  }
  // Keep half of the previous ship-preference slots, using a separate seeded stream.
  // Unlike rounding a halved quota up, this permits zero ships in small formations.
  function aiShipQuota(count, seed) {
    const interval = 6 + ((seed >>> 0) % 3);
    const previousQuota = count >= 6 ? Math.max(1, Math.floor(count / interval)) : 0;
    let shipSeed = (seed ^ 0x85ebca6b) >>> 0;
    for (let warmup = 0; warmup < 4; warmup++)
      shipSeed = (Math.imul(shipSeed, 1664525) + 1013904223) >>> 0;
    let quota = 0;
    for (let slot = 0; slot < previousQuota; slot++) {
      shipSeed = (Math.imul(shipSeed, 1664525) + 1013904223) >>> 0;
      if (shipSeed < 0x80000000) quota++;
    }
    return quota;
  }
  function randomFormation(
    seed = 7319,
    maxCost = catalog.formation.maxCost,
    restrictions = {},
    unitLimit = catalog.formation.maxUnits,
  ) {
    if (!Number.isInteger(unitLimit) || unitLimit < 1 || unitLimit > catalog.formation.maxUnits)
      throw Error("AI 编组点数上限无效");
    if (
      !Number.isInteger(maxCost) ||
      maxCost <= 0 ||
      maxCost > maxCostLimit * 1.5 ||
      !restrictions ||
      typeof restrictions !== "object" ||
      Array.isArray(restrictions)
    )
      throw Error("AI 编组设置无效");
    const environment =
      restrictions.environment ??
      (restrictions.mapId ? getMap(restrictions.mapId).environment : "ground");
    const adaptation = (model) => model.adaptability?.[environment] ?? 100;
    const infantry = (model) => model.unitTags?.includes("Infantry");
    const support = (model) =>
      !!model.supplyAura ||
      model.unitTags?.includes("Support") ||
      model.skills?.some((skill) => ["repair", "resupply"].includes(skill.type));
    const frontlineMS = (model) =>
      model.unitTags?.includes("MS") && !model.unitTags.includes("Recon") && !support(model);
    const commander = (model) =>
      !model.ship &&
      model.commandAuras?.some((aura) => ["cmdAtk", "cmdCom", "cmdDef"].includes(aura.type));
    const copies = (id) => entries.filter((entry) => entry.unitId === id).length;
    const choices = Object.values(models).filter(
        (model) =>
          !model.formOnly &&
          !restrictionReason(model, { ...restrictions, environment }) &&
          adaptation(model) > 0 &&
          !(environment === "space" && infantry(model) && adaptation(model) < 100) &&
          (model.weapons.length > 0 ||
            model.supplyAura ||
            model.skills?.some((s) => ["repair", "recon"].includes(s.type))),
      ),
      entries = [];
    if (!choices.length) return entries;
    const costPerPoint = (model) => model.cost / formationWeight(model);
    const combatChoices = choices.filter((model) => !support(model));
    const coreChoices = combatChoices.length ? combatChoices : choices;
    const minimum = Math.min(...coreChoices.map((model) => model.cost));
    const minimumWeight = Math.min(...coreChoices.map(formationWeight));
    const count = Math.min(Math.floor(unitLimit / minimumWeight), Math.floor(maxCost / minimum));
    const bestAdaptation = Math.max(...coreChoices.map(adaptation));
    // 达到正常适应性即可进入预算竞争；不能因少数廉价机体的适应性更高，
    // 将所有正常适应性的高级机体永久排除。全员不足100%时仍优先最高适应性。
    const preferredAdaptation = Math.min(100, bestAdaptation);
    const minimumRate = Math.min(...coreChoices.map(costPerPoint));
    const preferredMinimum = Math.min(
      ...coreChoices.filter((model) => adaptation(model) >= preferredAdaptation).map(costPerPoint),
    );
    // Each three non-ship units unlock one independent 50% command-slot roll.
    // A separate seeded stream keeps the decision stable across previews and reconnects.
    const commandAllowances = [0];
    let commandSeed = (seed ^ 0x6d2b79f5) >>> 0;
    for (let group = 1; group <= Math.floor(unitLimit / 3); group++) {
      commandSeed = (Math.imul(commandSeed, 1664525) + 1013904223) >>> 0;
      commandAllowances[group] = commandAllowances[group - 1] + (commandSeed < 0x80000000 ? 1 : 0);
    }
    // A roster with an MS backbone has roughly half as many units as points.
    // Do not assign ship slots as though every point were a separate tank.
    const expectedCount = Math.min(
      count,
      Math.floor(unitLimit / (coreChoices.some(frontlineMS) ? 2 : minimumWeight)),
    );
    const desiredShips = aiShipQuota(expectedCount, seed);
    let remaining = maxCost;
    let remainingPoints = unitLimit;
    for (let i = 0; i < count; i++) {
      // Budget by formation points: an MS takes two and a ship takes four.
      // Reserving by headcount underspends whenever heavier units fill the roster.
      const fillablePoints = Math.floor(remainingPoints / minimumWeight) * minimumWeight;
      if (!fillablePoints) break;
      let reserveMinimum =
        remaining >= preferredMinimum * fillablePoints ? preferredMinimum : minimumRate;
      if (restrictions.mapId && getMap(restrictions.mapId).navalDeployment) {
        // 混合海陆出生带需保留能跨水的一格单位预算，避免末尾只剩水格却买不起空军。
        const flexibleMinimum = Math.min(
          ...choices
            .filter(
              (m) =>
                !m.footprint &&
                ["air", "hover", "amphibious"].includes(m.movementType) &&
                adaptation(m) >= preferredAdaptation,
            )
            .map(costPerPoint),
        );
        if (remaining >= flexibleMinimum * fillablePoints)
          reserveMinimum = Math.max(reserveMinimum, flexibleMinimum);
      }
      const placementCache = new Map();
      const commanderCount = entries.filter((entry) =>
        commander(models[entry.unitId + "__" + entry.kitId]),
      ).length;
      const nonShipCount = entries.filter(
        (entry) => !models[entry.unitId + "__" + entry.kitId].ship,
      ).length;
      const commandAllowance = commandAllowances[Math.floor((nonShipCount + 1) / 3)] || 0;
      const infantryCount = entries.filter((entry) =>
        infantry(models[entry.unitId + "__" + entry.kitId]),
      ).length;
      const supportCount = entries.filter((entry) =>
        support(models[entry.unitId + "__" + entry.kitId]),
      ).length;
      const combatCount = entries.length - supportCount;
      const legal = choices.filter((model) => {
        // Keep at least three combat platforms per supply unit; never spend the army on logistics.
        if (
          support(model) &&
          (supportCount >= Math.floor(count / 4) ||
            combatCount < (supportCount + 1) * 3 ||
            model.cost > maxCost * 0.25)
        )
          return false;
        if (commander(model) && commanderCount >= commandAllowance) return false;
        if (infantry(model) && infantryCount >= Math.max(1, Math.ceil(unitLimit / 6))) return false;
        if (formationWeight(model) > remainingPoints) return false;
        if (
          model.cost >
          remaining - reserveMinimum * Math.max(0, fillablePoints - formationWeight(model))
        )
          return false;
        if (!restrictions.mapId) return true;
        const shape = JSON.stringify([
          model.footprint || null,
          model.movementType || "ground",
          !!model.ship,
          formationWeight(model),
        ]);
        if (!placementCache.has(shape)) {
          const map = getMap(restrictions.mapId);
          const seat = restrictions.deploymentSeat ?? 0;
          const areas = (map.deploymentAreas || []).filter(
            (area, index) => seatTeam(index) === seatTeam(seat),
          );
          const sharedAreaSize = areas.reduce((sum, area) => sum + area.width * area.height, 0);
          const size = (entry) => {
            const f = models[entry.unitId + "__" + entry.kitId].footprint;
            return f ? f.width * f.height : 1;
          };
          const candidate = { unitId: model.prefabId, kitId: model.kitId };
          if (
            sharedAreaSize &&
            entries.reduce((total, entry) => total + size(entry), 0) +
              size(candidate) +
              Math.max(0, fillablePoints - formationWeight(model)) >
              sharedAreaSize
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
      let preferred = legal.filter(
        (model) => adaptation(model) >= Math.min(100, bestLegalAdaptation),
      );
      const ships = entries.filter(
        (entry) => models[entry.unitId + "__" + entry.kitId].ship,
      ).length;
      const kind = preferred.filter((model) => !!model.ship === ships < desiredShips);
      if (kind.length) preferred = kind;
      if (ships < desiredShips) {
        const carriers = preferred.filter((model) => model.ship && model.hangars?.length);
        if (carriers.length) preferred = carriers;
      }
      const leaders = preferred.filter(commander);
      if (leaders.length && commanderCount < commandAllowance) preferred = leaders;
      // Build a combat-MS backbone when the legal pool supports it. Otherwise
      // one-point aircraft/tanks at the target price can crowd out every MS.
      const frontlinePoints = entries.reduce((sum, entry) => {
        const model = models[entry.unitId + "__" + entry.kitId];
        return sum + (frontlineMS(model) ? formationWeight(model) : 0);
      }, 0);
      const frontline = preferred.filter(frontlineMS);
      if (frontline.length && frontlinePoints < Math.floor(unitLimit / 4) * 2)
        preferred = frontline;
      // Select a competitive price per point first, then diversify within that
      // tier. A new cheap platform must not crowd out an affordable combat MS.
      const budgetPerPoint = remaining / fillablePoints;
      const highestCost = Math.max(...preferred.map(costPerPoint));
      let affordableTier;
      if (budgetPerPoint >= highestCost) {
        // 预算充足时选择最高价格档附近的机体，保留同档多样性。
        affordableTier = preferred.filter((model) => costPerPoint(model) >= highestCost * 0.85);
      } else {
        affordableTier = preferred.filter(
          (model) =>
            costPerPoint(model) >= budgetPerPoint * 0.9 &&
            costPerPoint(model) <= budgetPerPoint * 1.15,
        );
        if (!affordableTier.length) {
          const closestCost = preferred.reduce((best, model) => {
            const price = costPerPoint(model);
            const distance = Math.abs(price - budgetPerPoint);
            const bestDistance = Math.abs(best - budgetPerPoint);
            return distance < bestDistance || (distance === bestDistance && price > best)
              ? price
              : best;
          }, costPerPoint(preferred[0]));
          affordableTier = preferred.filter(
            (model) =>
              costPerPoint(model) >= closestCost * 0.9 && costPerPoint(model) <= closestCost * 1.15,
          );
        }
      }
      const fewestCopies = Math.min(...affordableTier.map((model) => copies(model.prefabId)));
      affordableTier = affordableTier.filter((model) => copies(model.prefabId) === fewestCopies);
      // 先抽机体再抽套件，避免套件更多的廉价机体获得额外抽取权重。
      const prefabIds = [...new Set(affordableTier.map((model) => model.prefabId))];
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const prefabId = prefabIds[Math.floor((seed / 4294967296) * prefabIds.length)];
      const kits = affordableTier.filter((model) => model.prefabId === prefabId);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const model = kits[seed % kits.length];
      entries.push({
        unitId: model.prefabId,
        kitId: model.kitId,
        customName: generateUnitName(model.name, entries, () => seed / 4294967296),
      });
      remaining -= model.cost;
      remainingPoints -= formationWeight(model);
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
          slot.remaining >= (slot.hangar.kind === "sfs" ? 1 : model.transport.slotCost) &&
          slot.hangar.allowedTags.some((tag) => model.transport.loadTags.includes(tag)),
      );
      if (!compatible.length) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed / 4294967296 >= 0.5) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const slot = compatible[seed % compatible.length];
      entry.preload = { carrierIndex: slot.carrierIndex, hangarId: slot.hangar.id };
      slot.remaining -= slot.hangar.kind === "sfs" ? 1 : model.transport.slotCost;
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
  const pilotModels = new WeakMap();
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
        ...(base.iField
          ? { iField: { ...base.iField, capacity: base.iField.capacity * factor } }
          : {}),
        hp: Math.round(base.hp * factor),
        en: Math.round(base.en * factor),
      });
    }
    return variants.get(factor);
  }
  function pilotModelOf(unit, base) {
    const pilot = pilots.of(unit, base);
    let variants = pilotModels.get(base);
    if (!variants) pilotModels.set(base, (variants = new WeakMap()));
    if (!variants.has(pilot)) {
      const modifiers = pilots.modifiers(unit, base);
      variants.set(pilot, {
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
        move: Math.max(1, base.move * modifiers.move),
        mobility: base.mobility * modifiers.reaction,
        accuracy: base.accuracy * modifiers.accuracy,
        pilotModifiers: modifiers,
      });
    }
    return variants.get(pilot);
  }
  // Derive damage penalties from current parts; never modify a shared catalog or AI variant.
  function environmentOf(g, unit, x = unit.x, y = unit.y) {
    if ((g?.environment ?? unit.environment) === "space") return "space";
    const movement = unit.flying ? "air" : models[unit.model].movementType;
    if (movement === "air") return "air";
    if (movement === "hover") return "ground";
    return g?.tiles
      ? g.tiles[y]?.[x] === "water"
        ? "water"
        : "ground"
      : unit.environment === "water"
        ? "water"
        : "ground";
  }
  function adaptationOf(g, unit, x = unit.x, y = unit.y) {
    return (models[unit.model].adaptability?.[environmentOf(g, unit, x, y)] ?? 100) / 100;
  }
  function modelOf(unit, g = null) {
    const original = pilotModelOf(unit, performanceModelOf(unit)),
      base = unit.flying ? { ...original, movementType: "air" } : original,
      penalty = parts.penalties(base.partsBreakable === false ? {} : unit),
      environment = environmentOf(g, unit),
      adaptability = (base.adaptability?.[environment] ?? 100) / 100,
      boostMove = (unit.overBoost?.moveBonus ?? 0) + (unit.fullBoost?.moveBonus ?? 0),
      boostMobility =
        (unit.overBoost?.mobilityMultiplier ?? 1) * (unit.fullBoost?.mobilityMultiplier ?? 1);
    if (
      penalty.attackMultiplier === 1 &&
      penalty.moveMultiplier === 1 &&
      !penalty.resistancePenalty &&
      adaptability === 1 &&
      !unit.overBoost &&
      !unit.fullBoost
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
            ? Math.max(
                1,
                Math.floor((base.move + boostMove) * adaptability * penalty.moveMultiplier),
              )
            : Math.max(1, (base.move + boostMove) * adaptability),
      mobility: base.mobility * adaptability * boostMobility,
      accuracy: base.accuracy * adaptability,
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
      available = new Map();
    if (!spawn) return [];
    // Each teammate keeps control of their units, while all friendly spawn zones are legal.
    for (let other = 0; other < map.spawns.length; other++) {
      if (seatTeam(other) !== seatTeam(seat)) continue;
      const origin = map.spawns[other],
        area = map.deploymentAreas?.[other],
        radius = map.deploymentRadius;
      const minX = area ? area.x : Math.max(0, origin.x - radius);
      const minY = area ? area.y : Math.max(0, origin.y - radius);
      const maxX = area ? area.x + area.width - 1 : origin.x + radius;
      const maxY = area ? area.y + area.height - 1 : origin.y + radius;
      for (let y = minY; y <= Math.min(mapHeight(g) - 1, maxY); y++)
        for (let x = minX; x <= Math.min(mapWidth(g) - 1, maxX); x++)
          if (
            (area || dist({ x, y }, origin) <= radius) &&
            Number.isFinite(unit ? terrainCost(g, unit, x, y) : terrain[g.tiles[y][x]].cost)
          )
            available.set(key(x, y), { x, y });
    }
    // Preserve the initial placement near the owner's spawn; manual deployment shares the union.
    return [...available.values()].sort(
      (a, b) => dist(a, spawn) - dist(b, spawn) || a.y - b.y || a.x - b.x,
    );
  }

  function deploy(g, team, id, x, y) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再调整");
    const u = g.units.find((u) => u.id === id && ownerOf(u) === team);
    if (
      !onMap(u) ||
      !!u.embarked ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !deploymentCells(g, team, u).some((c) => c.x === x && c.y === y)
    )
      throw Error("请在己方出生区的有效格子部署");
    if (!fits(g, u, x, y, u.angle, false, team)) throw Error("该部署位置已有单位");
    delete u.rotationPivot;
    u.x = x;
    u.y = y;
    hangars.sync(g);
  }
  function confirmDeployment(g, team) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再次确认");
    for (const u of g.units.filter((u) => ownerOf(u) === team && onMap(u) && !u.embarked)) {
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
  function activeMinovskyFields(g) {
    return (g.minovskyFields || []).filter((field) => field.expiresRound > g.round);
  }
  function minovskyAt(g, unit) {
    if (!g || !unit || unit.embarked || unit.hp <= 0) return false;
    return activeMinovskyFields(g).some((field) =>
      cells(unit).some((cell) => Math.hypot(cell.x - field.x, cell.y - field.y) <= field.radius),
    );
  }
  function minovskyCells(g) {
    const result = new Set();
    for (const field of activeMinovskyFields(g))
      for (
        let y = Math.max(0, Math.ceil(field.y - field.radius));
        y < Math.min(mapHeight(g), field.y + field.radius + 1);
        y++
      )
        for (
          let x = Math.max(0, Math.ceil(field.x - field.radius));
          x < Math.min(mapWidth(g), field.x + field.radius + 1);
          x++
        )
          if (Math.hypot(x - field.x, y - field.y) <= field.radius) result.add(key(x, y));
    return result;
  }
  const skills = skillModule.create({
    cells,
    sensors,
    models,
    modelOf,
    fits,
    dist,
    mapWidth,
    mapHeight,
    dimensions,
    center,
    parts,
    minovskyAt,
    irradiate,
    hasSfsMS,
  });
  // Grid anchors remain integers; a ship's explicit heading determines its whole rectangle.
  function commandAura(provider) {
    const model = modelOf(provider);
    const leadership = pilots.of(provider, model).stats.leadership;
    const steps = Math.trunc((leadership - 100) / 25);
    return {
      radius: Math.max(1, 3 + steps),
      effect: Math.max(0, 0.1 + steps * 0.02),
      kinds: model.commandAuras || [],
    };
  }
  function commandEffects(g, target) {
    const effects = { attack: 0, defense: 0, communication: 0 };
    if (!onMap(target)) return effects;
    for (const provider of g.units) {
      if (
        !onMap(provider) ||
        provider.team !== target.team ||
        !modelOf(provider).commandAuras?.length
      )
        continue;
      const aura = commandAura(provider);
      if (dist(provider, target) > aura.radius) continue;
      for (const kind of aura.kinds) {
        const key = { cmdAtk: "attack", cmdDef: "defense", cmdCom: "communication" }[kind.type];
        if (key) effects[key] = Math.max(effects[key], aura.effect);
      }
    }
    return effects;
  }
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
            !other.embarked &&
            (occupies(other, c.x, c.y) ||
              (other.pendingMove && occupies({ ...other, ...other.pendingMove }, c.x, c.y))) &&
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
    hangars.sync(g);
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
      const movement =
        (models[model].movementType || "ground") +
        ":" +
        ((models[model].adaptability?.water ?? 0) > 0);
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
      unitLimit = validateUnitLimit(settings.unitLimit ?? catalog.formation.maxUnits),
      fogMode = validateFogMode(settings.fogMode);
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
    const sourceIndices = [];
    for (let seat = 0; seat < formations.length; seat++) {
      // null 明确表示空出生点，不生成单位，也无需确认部署。
      if (formations[seat] === null) continue;
      formations[seat] = validateFormation(
        formations[seat],
        settings.seatCostLimits?.[seat] ?? costLimit,
        settings.seatUnitLimits?.[seat] ?? unitLimit,
      );
      const inventory = rulesForSeat(seat).inventory;
      const stockPlan =
        inventory === undefined
          ? null
          : planFormation(formations[seat], Infinity, { inventory }, catalog.formation.maxUnits);
      sourceIndices[seat] = (stockPlan?.indices || formations[seat].map((_, i) => i)).map(
        (i) => settings.formationIndices?.[seat]?.[i] ?? i,
      );
      if (stockPlan) formations[seat] = stockPlan.deployable;
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
        const pilot = entry.customPilot
          ? pilots.custom(entry.customPilot)
          : pilots.roll(entry.pilotId || null, seed, seat, i, models[model]);
        let m = modelOf({ model, performance, environment: map.environment, pilot });
        units.push({
          id: seat + "-" + (sourceIndices[seat]?.[i] ?? i),
          ownerSeat: seat,
          ...(entry.preload
            ? {
                embarked: {
                  carrierId:
                    seat +
                    "-" +
                    (sourceIndices[seat]?.[entry.preload.carrierIndex] ??
                      entry.preload.carrierIndex),
                  hangarId: entry.preload.hangarId,
                  boardRound: null,
                },
              }
            : {}),
          environment: map.environment || "ground",
          model,
          pilot,
          ...(entry.customName ? { customName: entry.customName } : {}),
          performance,
          team,
          x: position.x,
          y: position.y,
          hp: m.hp,
          brokenParts: {},
          ...(m.modules?.length
            ? {
                moduleHp: Object.fromEntries(m.modules.map((module) => [module.id, module.hp])),
              }
            : {}),
          shield: m.shield.hp,
          ...(m.iField ? { iFieldHp: m.iField.capacity } : {}),
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
    hangars.sync({ units });
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
      fogMode,
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
    return g.units.find((u) => onMap(u) && !u.embarked && occupies(u, x, y));
  }
  // 敌军上下左右相邻的格子消耗至少3点；地形更昂贵时仍按地形计算。
  function terrainCost(g, u, x, y) {
    const movement = modelOf(u).movementType;
    const tile = g.tiles[y][x];
    if (g.environment !== "space") {
      if (movement === "air") return 1;
      if (movement === "naval") return tile === "water" ? 1 : Infinity;
      if (tile === "water") {
        if (movement === "hover") return 1;
        return (models[u.model].adaptability?.water ?? 0) > 0 ? 1 : Infinity;
      }
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
    if (!onMap(u) || u.embarked) return new Map();
    const startAdaptation = adaptationOf(g, u);
    const moveLimit = startAdaptation > 0 ? modelOf(u, g).move / startAdaptation : modelOf(u).move;
    // A search does not mutate the board. Evaluate each destination's expensive
    // collision/terrain/ZOC checks once, even when reached from several edges.
    const stepCosts = new Map();
    function stepCost(x, y) {
      const id = key(x, y);
      if (!stepCosts.has(id))
        stepCosts.set(
          id,
          fits(g, u, x, y, u.angle, true)
            ? Math.max(
                ...cells(u, x, y).map(
                  (c) => movementCost(g, u, c.x, c.y) / (adaptationOf(g, u, c.x, c.y) || 0),
                ),
              )
            : Infinity,
        );
      return stepCosts.get(id);
    }
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
        let cost = n.cost + stepCost(x, y);
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
    // Boarding endpoints use an ordinary reachable hull-edge cell plus one step.
    // Normal cargo never becomes a collision obstacle or a path starting point.
    if (!starts && !u.moved && !u.acted && !u.plan) {
      for (const carrier of g.units.filter(
        (c) => c !== u && onMap(c) && !c.embarked && c.team === u.team && hangars.of(c).length,
      )) {
        for (const point of cells(carrier)) {
          const route = boardingRoute(g, u, carrier, point.x, point.y, best, moveLimit);
          if (route) best.set(key(point.x, point.y), route);
        }
      }
    }
    return best;
  }
  function boardingRoute(g, u, carrier, x, y, walk, moveLimit) {
    for (const h of hangars.of(carrier)) {
      const candidates = [...walk.values()].filter(
        (p) =>
          !p.boarding &&
          p.cost + 1 <= moveLimit &&
          hangars.canEmbark(g, { ...u, x: p.x, y: p.y, pendingMove: undefined }, carrier, h.id),
      );
      candidates.sort(
        (a, b) =>
          a.cost - b.cost ||
          Math.abs(a.x - x) + Math.abs(a.y - y) - Math.abs(b.x - x) - Math.abs(b.y - y),
      );
      const approach = candidates[0];
      if (approach)
        return {
          x,
          y,
          cost: approach.cost + 1,
          path: [...approach.path, { x, y }],
          boarding: {
            carrierId: carrier.id,
            hangarId: h.id,
            approach: { x: approach.x, y: approach.y },
          },
        };
    }
    return null;
  }
  // 朝向由裁定状态保存，快照、重连和各客户端使用同一个结果。
  function faceTarget(unit, target) {
    const sourceCenter = center(unit),
      targetCenter = target.aimCell ?? center(target),
      dx = targetCenter.x - sourceCenter.x,
      dy = targetCenter.y - sourceCenter.y;
    if (dx || dy) {
      const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (!models[unit.model]?.ship) unit.angle = angle;
    }
  }
  function move(g, u, x, y) {
    if (
      !onMap(u) ||
      u.embarked ||
      u.pendingMove ||
      g.winner !== null ||
      u.team !== g.team ||
      u.acted ||
      u.moved
    )
      throw Error("本单位无法移动");
    let tile = reachable(g, u).get(key(x, y));
    if (!tile || !tile.path.length) throw Error("该位置不可移动");
    if (tile.boarding) {
      const { carrierId, hangarId, approach } = tile.boarding;
      const carrier = g.units.find((c) => c.id === carrierId);
      // The route and capacity were validated before either position changes.
      Object.assign(u, approach);
      hangars.embark(g, u, carrier, hangarId);
      return tile.path;
    }
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
    hangars.sync(g);
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
  // 预览只保留落点与路径，不改变裁定位置，因此不会提前更新视野或索敌。
  function previewMove(g, u, x, y, seat = ownerOf(u)) {
    if (u?.embarked?.exposed) return hangars.previewLaunch(g, u, x, y, seat).path;
    if (
      !onMap(u) ||
      g.winner !== null ||
      u.team !== g.team ||
      u.acted ||
      u.moved ||
      u.pendingMove ||
      g.units.some((unit) => unit.pendingMove?.seat === seat)
    )
      throw Error("请先确认或取消移动");
    const tile = reachable(g, u).get(key(x, y));
    if (!tile?.path.length) throw Error("该位置不可移动");
    const previous = tile.path.at(-2) || u;
    const angle = models[u.model]?.ship
      ? u.angle
      : (Math.atan2(x - previous.x, -(y - previous.y)) * 180) / Math.PI;
    u.pendingMove = {
      x,
      y,
      angle,
      seat,
      from: { x: u.x, y: u.y },
      path: tile.path,
      ...(tile.boarding ? { boarding: tile.boarding } : {}),
    };
    return tile.path;
  }
  function confirmMove(g, u) {
    const pending = u.pendingMove;
    if (!pending) throw Error("没有待确认的移动");
    delete u.pendingMove;
    try {
      if (pending.boarding) {
        const route = reachable(g, u).get(key(pending.x, pending.y));
        if (
          route?.boarding?.carrierId !== pending.boarding.carrierId ||
          route.boarding.hangarId !== pending.boarding.hangarId
        )
          throw Error("搭载目标或容量已变化，请取消后重新选择");
      }
      const path = pending.launch
        ? hangars.launch(g, u, pending.x, pending.y).path
        : move(g, u, pending.x, pending.y);
      u.origin = null;
      return path;
    } catch (error) {
      u.pendingMove = pending;
      throw error;
    }
  }
  function cancelMove(g, u) {
    if (!u.pendingMove) throw Error("没有待取消的移动");
    delete u.pendingMove;
  }
  function undo(g, u) {
    if (!canUndo(g, u)) throw Error("无法撤销：己方编组的后续单位已移动或原位置被占用");
    Object.assign(u, u.origin);
    if (!u.origin.rotationPivot) delete u.rotationPivot;
    u.origin = null;
    u.moved = false;
    hangars.sync(g);
  }
  function moduleCanBear(unit, moduleId, target) {
    if (!moduleId || !target) return true;
    const module = models[unit.model]?.modules?.find((m) => m.id === moduleId);
    if (!module) return false;
    const a = center(unit),
      b = target.aimCell ?? center(target),
      aim = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
    const delta = ((((aim - (unit.angle ?? 0) - module.idleDir + 180) % 360) + 360) % 360) - 180;
    return Math.abs(delta) <= module.arc;
  }
  function availableStrikes(u, w, target = null) {
    if (parts.unavailable(u, w).length) return [];
    return w.attack.strikes.filter(
      (step) =>
        !parts.unavailable(u, step).length && moduleCanBear(u, step.moduleId, w.aimCell ?? target),
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
  function attackOrders(unit) {
    return unit.plan ? unit.plan.attacks || [unit.plan] : [];
  }
  function attackPlanFor(unit, target) {
    return attackOrders(unit).find((order) => order.target === target?.id);
  }
  function attackBudget(unit, target) {
    const others = attackOrders(unit).filter((order) => order.target !== target?.id);
    const weapons = others.flatMap((order) =>
      (order.weapons || [order.weapon])
        .map((id) => modelOf(unit).weapons.find((weapon) => weapon.id === id))
        .filter(Boolean),
    );
    return {
      ap: actionPoints(unit) + (attackPlanFor(unit, target)?.actionCost || 0),
      en: unit.en - weapons.reduce((sum, weapon) => sum + weaponStats(weapon, unit).en, 0),
      weapons,
    };
  }
  function attackQueue(g, u, target, weapons) {
    if (!Array.isArray(weapons) || !weapons.length || weapons.length > 32)
      throw Error("请选择有效的武器序列");
    if (weapons.some((w) => !w || !canAttack(g, u, target, w)))
      throw Error("武器、目标、射程或部位条件不满足");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    const budget = attackBudget(u, target);
    const allWeapons = [...budget.weapons, ...weapons];
    if (allWeapons.length > 32) throw Error("攻击计划最多包含32次武器使用");
    if (allWeapons.filter((weapon) => weapon.special?.type === "snipe").length > 1)
      throw Error("同一单位只能保留一个狙击蓄力计划");
    for (const weapon of new Set(allWeapons))
      if (
        Number.isInteger(weapon.maxUses) &&
        (u.weaponUses?.[weapon.id] || 0) +
          allWeapons.filter((entry) => entry.id === weapon.id).length >
          weapon.maxUses
      )
        throw Error("该武器的使用次数已经耗尽");
    const ap = weapons.reduce((n, w) => n + actionCost(w), 0);
    const en = weapons.reduce((n, w) => n + weaponStats(w, u).en, 0);
    if (ap > budget.ap) throw Error("行动点不足");
    if (en > budget.en) throw Error("武器序列总EN不足");
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
  function counterPlan(g, unit, orders) {
    if (!Array.isArray(orders) || !orders.length || orders.length > 32)
      throw Error("请选择有效的反击武器序列");
    const weapons = [];
    for (const order of orders) {
      const target = g.units.find((target) => target.id === order?.targetId);
      const ids = order?.weaponIds;
      if (!target || !Array.isArray(ids) || !ids.length) throw Error("反击目标或武器无效");
      const queue = ids.map((id) => modelOf(unit).weapons.find((weapon) => weapon.id === id));
      counterQueue(g, unit, target, queue);
      weapons.push(...queue);
    }
    if (
      weapons.length > 32 ||
      weapons.reduce((sum, w) => sum + actionCost(w), 0) > counterActionBudget(unit)
    )
      throw Error("反击行动点不足");
    if (weapons.reduce((sum, w) => sum + weaponStats(w, unit).en, 0) > unit.en)
      throw Error("反击武器序列总EN不足");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    for (const weapon of new Set(weapons))
      if (
        Number.isInteger(weapon.maxUses) &&
        (unit.weaponUses?.[weapon.id] || 0) + weapons.filter((w) => w.id === weapon.id).length >
          weapon.maxUses
      )
        throw Error("该武器的使用次数已经耗尽");
    return weapons;
  }
  function weaponCooldown(u, w) {
    return u.weaponCooldowns?.[w?.id] || 0;
  }
  function startWeaponCooldown(u, w) {
    if (["mortar", "snipe"].includes(w?.special?.type)) (u.weaponCooldowns ||= {})[w.id] = 2;
  }
  // Shared by attacks, counters and AI; always read the assigned pilot.
  function pilotWeaponAllowed(u, w) {
    if (!w?.pilotRequirements?.length) return true;
    const stats = pilots.of(u, models[u.model]).stats;
    return w.pilotRequirements.every(({ stat, operator, value }) => {
      const actual = stats[stat];
      if (!Number.isFinite(actual)) return false;
      switch (operator) {
        case ">":
          return actual > value;
        case ">=":
          return actual >= value;
        case "<":
          return actual < value;
        case "<=":
          return actual <= value;
        case "==":
          return actual === value;
        case "!=":
          return actual !== value;
        default:
          return false;
      }
    });
  }
  function canUse(u, w) {
    return (
      !!w &&
      pilotWeaponAllowed(u, w) &&
      (!w.requiresShield || u.shield > 0) &&
      !weaponCooldown(u, w) &&
      (!Number.isInteger(w.maxUses) || (u.weaponUses?.[w.id] || 0) < w.maxUses) &&
      onMap(u) &&
      u.en >= weaponStats(w, u).en &&
      !parts.unavailable(u, w).length &&
      availableStrikes(u, w).length > 0
    );
  }
  // A large unit is hit once when any occupied cell intersects the circular blast.
  function blastContains(impact, unit, radius) {
    return cells(unit).some(
      (cell) => (cell.x - impact.x) ** 2 + (cell.y - impact.y) ** 2 <= radius ** 2,
    );
  }
  function attackCells(a, b, w) {
    return cells(b).filter((cell) => {
      const d = dist(a, cell);
      return d >= w.min && d <= w.max;
    });
  }
  function inRange(a, b, w) {
    const cell = w.aimCell ?? b.aimCell;
    if (cell)
      return (
        Number.isInteger(cell.x) &&
        Number.isInteger(cell.y) &&
        occupies(b, cell.x, cell.y) &&
        attackCells(a, b, w).some((p) => p.x === cell.x && p.y === cell.y)
      );
    return attackCells(a, b, w).length > 0;
  }
  // The centre grid cell is the ship core. Individual models may opt out.
  function weakPoint(unit, cell) {
    const model = models[unit.model];
    if (!model?.ship || model.weakPoint === false || !cell) return false;
    const c = center(unit);
    return cell.x === Math.round(c.x) && cell.y === Math.round(c.y);
  }
  function unitSize(model) {
    const tags = model?.unitTags || model?.sourceStats?.nativeTags || [];
    if (tags.includes("LargeUnit")) return "large";
    if (tags.includes("SmallUnit")) return "small";
    return "medium";
  }
  function targetModifier(g, target, weapon) {
    const targetModel = modelOf(target);
    if (
      ["bomb", "mortar", "nuke"].includes(weapon.special?.type) &&
      (targetModel.movementType === "air" ||
        targetModel.sourceStats?.nativeTags?.includes("Aircraft"))
    )
      return 0;
    if (!weapon.targetModifiers) return 1;
    const category = environmentOf(g, target);
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
  function hasSfsMS(g, unit) {
    return (
      !!unit &&
      hangars
        .cargo(g, unit)
        .some(
          (passenger) =>
            modelOf(passenger).unitTags?.includes("MS") &&
            hangars
              .of(unit)
              .some((slot) => slot.kind === "sfs" && slot.id === passenger.embarked.hangarId),
        )
    );
  }
  function canAttack(g, a, b, w) {
    if (a?.pendingMove) return false;
    if (
      w?.requiresSfsMS &&
      (!a ||
        !hangars
          .cargo(g, a)
          .some(
            (passenger) =>
              modelOf(passenger).unitTags?.includes("MS") &&
              hangars
                .of(a)
                .some((slot) => slot.kind === "sfs" && slot.id === passenger.embarked.hangarId),
          ))
    )
      return false;

    if (b?.groundTarget)
      return (
        !!groundTarget(g, a, b.x, b.y) &&
        ["mortar", "nuke"].includes(w?.special?.type) &&
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
      (w?.blastCenter || sensors.visible(g, a.team, b)) &&
      canUse(a, w) &&
      targetModifier(g, b, w) > 0 &&
      (w.blastCenter ? blastContains(w.blastCenter, b, w.special.radius) : inRange(a, b, w)) &&
      availableStrikes(a, w, b).length > 0
    );
  }
  // Scatter records carry only shot indices and energy actually paid; clients rebuild the same visual slice.
  function eventWeapon(unit, event) {
    const weapon = baseEventWeapon(unit, event);
    return weapon && event.aimCell ? { ...weapon, aimCell: event.aimCell } : weapon;
  }
  function baseEventWeapon(unit, event) {
    const weapon = modelOf(unit).weapons.find((w) => w.id === event.weapon);
    // Only server-expanded impact events carry a blast centre; launch requests still check range.
    if (weapon?.special?.type === "nuke" && event.impactCell)
      return { ...weapon, blastCenter: event.impactCell };
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
  // A segment intersects a circular screen when its nearest point lies in the radius.
  function iFieldHP(unit) {
    if (!models[unit?.model]?.iField) return 0;
    const field = modelOf(unit).iField;
    return field
      ? Math.max(
          field.minimumRatio * field.capacity,
          Math.min(field.capacity, unit.iFieldHp ?? field.capacity),
        )
      : 0;
  }
  function consumeIField(unit, amount) {
    if (amount <= 0 || !models[unit?.model]?.iField) return 0;
    const field = modelOf(unit).iField;
    const before = iFieldHP(unit);
    unit.iFieldHp = Math.max(field.minimumRatio * field.capacity, before - amount);
    return before - unit.iFieldHp;
  }
  function smokeAt(g, unit) {
    return (g.smokeFields || []).some(
      (field) =>
        field.expiresRound > g.round &&
        sensors.distance(unit, { ...field, groundTarget: true }) <= field.radius,
    );
  }
  function beamDiffusionFactor(g, source, target) {
    const a = center(source),
      b = target.groundTarget ? target : center(target);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy;
    return (g.beamDiffusionFields || []).some((field) => {
      if (field.expiresRound <= g.round) return false;
      const t = length
        ? Math.max(0, Math.min(1, ((field.x - a.x) * dx + (field.y - a.y) * dy) / length))
        : 0;
      return (a.x + t * dx - field.x) ** 2 + (a.y + t * dy - field.y) ** 2 <= field.radius ** 2;
    })
      ? 0.5
      : 1;
  }
  function estimate(g, a, b, w, response = "counter", isCounter = false) {
    w = weaponStats(w, a);
    const attacker = modelOf(a, g),
      bonuses = attacker.attackBonuses,
      attackCommand = commandEffects(g, a),
      defenseCommand = commandEffects(g, b),
      categoryBonus = 1 + bonuses[w.type === "melee" ? "melee" : "shooting"] / 100;
    const defender = modelOf(b, g),
      ground = terrain[g.tiles[b.y][b.x]],
      cover =
        environmentOf(g, b) === "air"
          ? 0
          : w.type === "melee"
            ? (ground.meleeCover ?? 0)
            : ground.cover,
      mobilityPenalty =
        ((defender.mobility / (defender.pilotModifiers?.reaction ?? 1)) *
          (response === "evade" ? 1.25 : 1) -
          100) *
        0.1875,
      sizeModifier = w.antiSize?.[unitSize(defender)] || { damage: 1, accuracy: 1 },
      targetFactor = targetModifier(g, b, w),
      sensorFactor = sensors.detected(g, a.team, b) ? 1 : 0.75,
      baseHit =
        Math.max(
          10,
          Math.min(
            100,
            (w.attack.strikes.length === 1 && w.attack.strikes[0].accuracy !== undefined
              ? (w.attack.strikes[0].accuracy * w.hit) / (w.sourceHit || w.hit || 1)
              : w.hit) *
              (attacker.accuracy / (attacker.pilotModifiers?.accuracy ?? 1) / 100) *
              sizeModifier.accuracy *
              targetFactor -
              cover -
              mobilityPenalty,
          ),
        ) * (isCounter ? 0.75 : 1),
      // 最终回避加成在机动性、地形与反击惩罚计算后生效。
      rawHit = Math.min(
        100,
        Math.max(0, baseHit - (response === "evade" ? 15 : 0)) *
          (w.hitScale || 1) *
          (attacker.pilotModifiers?.accuracy ?? 1) *
          (1 + attackCommand.communication),
      ),
      pilotEvasionHit =
        100 -
        (100 - rawHit) *
          (defender.pilotModifiers?.reaction ?? 1) *
          (1 + defenseCommand.communication),
      particleDefense = minovskyAt(g, b),
      particleEvasionHit = particleDefense ? 100 - (100 - pilotEvasionHit) * 1.25 : pilotEvasionHit,
      hit = Math.max(
        0,
        Math.min(
          100,
          particleEvasionHit *
            (particleDefense && (w.category === "missile" || w.special?.type === "mortar")
              ? 0.75
              : 1) *
            sensorFactor *
            (w.type !== "melee" && smokeAt(g, b) ? 0.75 : 1),
        ),
      ),
      defenseMultiplier = response === "defend" ? 1.25 : 1,
      finalDamageMultiplier =
        (weakPoint(b, w.aimCell ?? b.aimCell) ? 1.5 : 1) *
        (response === "defend" ? 0.75 : 1) *
        (defender.pilotModifiers?.defense ?? 1) *
        (1 - defenseCommand.defense) *
        (attacker.pilotModifiers?.[w.type === "melee" ? "melee" : "shooting"] ?? 1) *
        (1 + attackCommand.attack),
      strikes = availableStrikes(a, w, b);
    // MOD: subtract flat protection per projectile/component, then apply percentage protection.
    const beamScreen = beamDiffusionFactor(
      g,
      a,
      w.aimCell ? { ...w.aimCell, groundTarget: true } : b,
    );
    let components = w.damageComponents;
    const field = defender.iField,
      fieldInitial = iFieldHP(b);
    let fieldLeft = fieldInitial,
      blockedFieldLeft = fieldInitial;
    function protectedDamage(
      defenses,
      damageMultiplier,
      share = 1,
      fieldActive = false,
      tracker = null,
    ) {
      return Object.entries(components).reduce((sum, [channel, value]) => {
        const ap = channel.endsWith("AP");
        if (ap && defenses === defender.shield.defenses) return sum;
        if (ap) channel = channel.slice(0, -2);
        const percentKey =
          channel === "meleeBeam" ? "beam" : channel === "meleeShell" ? "shell" : channel;
        const flatKey = channel.startsWith("melee") ? "melee" : channel;
        const element = percentKey;
        const elementBonus =
          element === "beam" || element === "shell" ? 1 + bonuses[element] / 100 : 1;
        const amount =
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
              100) *
          (element === "shell" ? 1 - (defender.shellFinalResistance || 0) / 100 : 1) *
          (channel === "beam" ? beamScreen : 1) *
          finalDamageMultiplier;
        // Native I-fields intercept ranged beam projectiles; beam sabers bypass them.
        const reduction =
          fieldActive && w.type !== "melee" && channel === "beam"
            ? ap
              ? field.piercingReduction
              : field.reduction
            : 0;
        if (tracker) tracker.absorbed += amount * reduction;
        return sum + amount * (1 - reduction);
      }, 0);
    }
    let damage = 0,
      shieldDamage = 0,
      blockedDamage = 0;
    const shieldAvailable = parts.shieldUsable(b, defender.shield);
    let shieldLeft = shieldAvailable ? Math.max(0, b.shield ?? 0) : 0;
    const floor = field ? field.capacity * field.minimumRatio : 0;
    for (const strike of strikes) {
      components = strike.damageComponents || w.damageComponents;
      const multiplier = strike.damageMultiplier ?? 1,
        normal = { absorbed: 0 },
        blocked = { absorbed: 0 };
      damage += Math.round(
        protectedDamage(defender.defenses, multiplier, 1, fieldLeft > 0, normal),
      );
      fieldLeft = Math.max(floor, fieldLeft - Math.round(normal.absorbed));
      const active = blockedFieldLeft > 0,
        coverage = shieldLeft > 0 ? defender.shield.coverage : 0;
      const required =
        coverage > 0
          ? Math.round(protectedDamage(defender.shield.defenses, multiplier, coverage, active))
          : 0;
      const absorbedShare = coverage * (required > 0 ? Math.min(1, shieldLeft / required) : 1);
      const loss = Math.min(shieldLeft, required);
      shieldDamage += loss;
      shieldLeft -= loss;
      blockedDamage += Math.round(
        protectedDamage(defender.defenses, multiplier, 1 - absorbedShare, active),
      );
      if (active) protectedDamage(defender.defenses, multiplier, 1, active, blocked);
      blockedFieldLeft = Math.max(floor, blockedFieldLeft - Math.round(blocked.absorbed));
    }
    return {
      hit,
      damage,
      shieldDamage,
      blockedDamage,
      iFieldDamage: fieldInitial - fieldLeft,
      iFieldBlockedDamage: fieldInitial - blockedFieldLeft,
      blockChance:
        shieldAvailable && b.shield > 0
          ? Math.min(1, defender.shield.blockChance + (response === "defend" ? 0.25 : 0))
          : 0,
    };
  }
  function spend(u, w) {
    if (w.en) u.en -= w.en;
    if (Number.isInteger(w.maxUses)) (u.weaponUses ||= {})[w.id] = (u.weaponUses[w.id] || 0) + 1;
    if (w.changeHeldWeapon !== false) u.heldWeapon = w.id;
  }
  function random(g) {
    g.seed = (Math.imul(1664525, g.seed) + 1013904223) >>> 0;
    return g.seed / 4294967296;
  }
  // 真正结算入口：校验 → 扣资源 → 随机命中 → 扣血 → 生成演出事件。
  function fight(
    g,
    a,
    b,
    w,
    response,
    counterId,
    allowCounter = true,
    counterOnly = false,
    counterOrders = null,
  ) {
    if (
      g.winner !== null ||
      (!counterOnly && (a.team !== g.team || a.acted || !canAttack(g, a, b, w)))
    )
      throw Error("攻击条件已失效");
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    const counterIds = Array.isArray(counterId) ? counterId : [counterId];
    if (counterOnly && counterOrders) counterPlan(g, b, counterOrders);
    else if (response === "counter" && allowCounter)
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
      dodgeSlots[from.id] ??= 0;
      dodgeSlots[to.id] ??= 0;
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
            moduleCanBear(from, step.moduleId, weapon.aimCell ?? to),
          hit = executed && random(g) < e.hit / 100,
          blocked = hit && to.shield > 0 && random(g) < e.blockChance,
          shieldDamage = blocked ? e.shieldDamage : 0,
          damage = hit ? Math.min(to.hp, blocked ? e.blockedDamage : e.damage) : 0;
        const hpBefore = to.hp,
          shieldBeforeStrike = to.shield;
        const iFieldBefore = iFieldHP(to);
        const iFieldDamage = hit
          ? consumeIField(to, blocked ? e.iFieldBlockedDamage : e.iFieldDamage)
          : 0;
        to.hp -= damage;
        to.shield -= shieldDamage;
        const brokenPart = hit
          ? parts.applyHit(
              g,
              to,
              modelOf(to),
              damage,
              (step.partBreakModifier ?? weapon.partBreakModifier ?? 1) *
                (iFieldDamage > 0 ? damage / (damage + iFieldDamage) : 1),
            )
          : null;
        if (hit && to.hp > 0 && weapon.burn)
          to.burning = {
            expiresRound: g.round + weapon.burn.durationTurns * 2,
            hpPercent: weapon.burn.hpPercent,
            sourceId: from.id,
          };
        if (hit && to.hp > 0 && weapon.onHitAPLoss) to.apPenaltyNextTurn = weapon.onHitAPLoss;
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
          ...(modelOf(to).iField ? { iFieldBefore, iFieldAfter: iFieldHP(to), iFieldDamage } : {}),
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
        aimCell: weapon.aimCell,
        weakPoint: weakPoint(to, weapon.aimCell),
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
        ...(strikes[0]?.iFieldBefore !== undefined
          ? {
              iFieldBefore: strikes[0].iFieldBefore,
              iFieldAfter: iFieldHP(to),
              iFieldDamage: strikes.reduce(
                (total, strike) => total + (strike.iFieldDamage || 0),
                0,
              ),
            }
          : {}),
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
    if (!counterOnly) fire(a, b, w, response);
    if (response === "counter" && allowCounter && b.hp > 0 && a.hp > 0) {
      let remaining = counterActionBudget(b),
        started = false;
      const entries = counterOrders
        ? counterOrders.flatMap((order) =>
            order.weaponIds.map((id) => ({
              id,
              target: g.units.find((unit) => unit.id === order.targetId),
            })),
          )
        : counterIds.map((id) => ({ id, target: a }));
      for (const { id, target: enemy } of entries) {
        const weapon = modelOf(b).weapons.find((w) => w.id === id);
        if (b.hp <= 0) break;
        if (!enemy || enemy.hp <= 0) continue;
        if (
          !weapon ||
          weapon.noCounter ||
          actionCost(weapon) > remaining ||
          !canAttack(g, b, enemy, weapon)
        )
          continue;
        if (!started) {
          b.counterCount = (b.counterCount ?? 0) + 1;
          if (!counterOrders || new Set(counterOrders.map((order) => order.targetId)).size === 1)
            b.counterTargetId = enemy.id;
          started = true;
        }
        remaining -= actionCost(weapon);
        fire(b, enemy, weapon, "counter", true);
      }
    }
    if (!counterOnly) {
      a.acted = true;
      a.origin = null;
    }
    const evacuations = hangars.evacuate(g);
    for (const event of events)
      event.evacuations = evacuations.filter(
        (e) => e.carrierId === event.to && event.after <= 0 && event.before > 0,
      );
    let alive = [0, 1].map((t) => g.units.some((u) => u.team === t && u.hp > 0));
    if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
    return events;
  }
  // Run a validated counter sequence after the offensive phase has fully resolved.
  function counter(g, defender, attacker, weaponIds, orders = null) {
    return fight(g, attacker, defender, null, "counter", weaponIds, true, true, orders);
  }
  function wait(g, u) {
    if (!onMap(u) || g.winner !== null || u.team !== g.team || u.acted) throw Error("无法待机");
    u.acted = true;
    u.actionPoints = 0;
    u.origin = null;
  }
  function irradiationLine(unit, target, range) {
    const from = center(unit),
      dx = target.x - from.x,
      dy = target.y - from.y,
      length = Math.hypot(dx, dy);
    if (!length) throw Error("请选择照射方向");
    return { from, to: { x: from.x + (dx / length) * range, y: from.y + (dy / length) * range } };
  }
  function lineIntersectsUnit(from, to, unit) {
    const size = dimensions(unit);
    let low = 0,
      high = 1;
    for (const [start, end, min, max] of [
      [from.x, to.x, unit.x - 0.5, unit.x + size.width - 0.5],
      [from.y, to.y, unit.y - 0.5, unit.y + size.height - 0.5],
    ]) {
      const delta = end - start;
      if (!delta) {
        if (start < min || start > max) return false;
        continue;
      }
      let a = (min - start) / delta,
        b = (max - start) / delta;
      if (a > b) [a, b] = [b, a];
      low = Math.max(low, a);
      high = Math.min(high, b);
      if (low > high) return false;
    }
    return true;
  }
  function irradiate(g, unit, skill, x, y) {
    const line = irradiationLine(unit, { x, y }, skill.range),
      hits = [];
    const victims = g.units
      .filter(
        (other) =>
          other !== unit &&
          onMap(other) &&
          other.embarked?.carrierId !== unit.id &&
          lineIntersectsUnit(line.from, line.to, other),
      )
      .sort((a, b) => dist(unit, a) - dist(unit, b) || a.id.localeCompare(b.id));
    const weapon = {
      id: skill.sourceWeapon,
      type: "beam",
      min: 0,
      max: skill.range,
      hit: skill.baseHit,
      en: 0,
      damageComponents: skill.damageComponents,
      damagePerShot: Object.values(skill.damageComponents).reduce((a, b) => a + b, 0),
      attack: { strikes: [{ at: 0, shotIndex: 0, muzzleIndex: 0, damageMultiplier: 1 }] },
    };
    faceTarget(unit, { ...line.to, visualOnly: true });
    for (const target of victims) {
      const estimateHit = estimate(g, unit, target, weapon, "counter"),
        before = target.hp,
        shieldBefore = target.shield;
      const hit = random(g) < estimateHit.hit / 100,
        blocked = hit && random(g) < estimateHit.blockChance;
      const damage = hit
        ? Math.min(target.hp, blocked ? estimateHit.blockedDamage : estimateHit.damage)
        : 0;
      const iFieldBefore = iFieldHP(target),
        iFieldDamage = hit
          ? consumeIField(
              target,
              blocked ? estimateHit.iFieldBlockedDamage : estimateHit.iFieldDamage,
            )
          : 0;
      target.hp -= damage;
      if (blocked) target.shield = Math.max(0, target.shield - estimateHit.shieldDamage);
      if (hit) {
        parts.applyHit(
          g,
          target,
          modelOf(target),
          damage,
          iFieldDamage > 0 ? damage / (damage + iFieldDamage) : 1,
        );
        skills.revertDamaged(target);
      }
      hits.push({
        unitId: target.id,
        ...(modelOf(target).iField
          ? { iFieldBefore, iFieldAfter: iFieldHP(target), iFieldDamage }
          : {}),
        before,
        after: target.hp,
        shieldBefore,
        shieldAfter: target.shield,
        damage,
        hit,
        hitChance: estimateHit.hit,
      });
    }
    const evacuations = hangars.evacuate(g);
    const alive = [0, 1].map((team) => g.units.some((u) => u.hp > 0 && u.team === team));
    if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
    return {
      type: "skill",
      skillId: skill.id,
      unitId: unit.id,
      resultId: unit.id,
      irradiation: true,
      ...line,
      hits,
      evacuations,
      effect: skill.effect,
      sound: skill.sound,
      model: unit.model,
      color: skill.visualColor,
      chargeSeconds: skill.chargeSeconds,
      fireSeconds: skill.fireSeconds,
      weaponDisplayIndex: skill.weaponDisplayIndex,
      clip: skill.clip,
      muzzle: skill.muzzle,
    };
  }
  function aiAreaSkill(g, unit) {
    const enemies = g.units.filter(
      (other) => other.team !== unit.team && onMap(other) && sensors.visible(g, unit.team, other),
    );
    for (const skill of skills.of(unit).filter((s) => s.type === "irradiation")) {
      if (!skills.canUse(g, unit, skill.id)) continue;
      const legal = new Set(skills.targets(g, unit, skill.id).map((cell) => key(cell.x, cell.y)));
      let best = null;
      for (const target of enemies)
        for (const cell of cells(target)) {
          if (!legal.has(key(cell.x, cell.y))) continue;
          const line = irradiationLine(unit, cell, skill.range);
          const crossed = g.units.filter(
            (other) =>
              other !== unit &&
              onMap(other) &&
              other.embarked?.carrierId !== unit.id &&
              (other.team === unit.team || enemies.includes(other)) &&
              lineIntersectsUnit(line.from, line.to, other),
          );
          // Never deliberately fire a friendly-fire beam through an allied hull.
          if (crossed.some((other) => other.team === unit.team)) continue;
          const score = crossed.reduce((sum, other) => sum + modelOf(other).cost, 0);
          if (score > 0 && (!best || score > best.score)) best = { score, x: cell.x, y: cell.y };
        }
      if (best) return { skillId: skill.id, x: best.x, y: best.y };
    }
    for (const skill of skills.of(unit).filter((s) => s.type === "emp"))
      if (
        skills.canUse(g, unit, skill.id) &&
        enemies.some(
          (other) => sensors.distance(unit, other) <= skill.radius && !other.apPenaltyNextTurn,
        )
      )
        return { skillId: skill.id, x: unit.x, y: unit.y };
    return null;
  }
  function tickBurning(g, seconds = 1) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw Error("Invalid burn tick");
    if (g.winner !== null) return [];
    const events = [];
    for (const u of g.units) {
      const burn = u.burning;
      if (!burn) continue;
      if (u.hp <= 0 || burn.expiresRound <= g.round) {
        delete u.burning;
        continue;
      }
      const m = modelOf(u),
        resistance = Math.max(0, Math.min(100, m.defenses.sp?.percent || 0));
      const damage = Math.min(
        u.hp,
        Math.round(((m.hp * burn.hpPercent) / 100) * (1 - resistance / 100)) * seconds,
      );
      const before = u.hp;
      u.hp -= damage;
      events.push({
        type: "burn",
        unitId: u.id,
        sourceId: burn.sourceId,
        before,
        after: u.hp,
        damage,
      });
      if (u.hp <= 0) delete u.burning;
    }
    if (events.some((e) => e.after <= 0)) {
      events.push(...hangars.evacuate(g).map((e) => ({ type: "evacuation", ...e })));
      const alive = [0, 1].map((team) => g.units.some((u) => u.team === team && u.hp > 0));
      if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
    }
    return events;
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
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0 && u.overBoost)) {
      const active = u.overBoost;
      if (g.round > active.startedRound) {
        const maximum = performanceModelOf(u).hp;
        u.hp = Math.max(0, u.hp - Math.round((maximum * active.hpDrainPercent) / 100));
        g.turnEffects.push({
          type: "overboost",
          unitId: u.id,
          skillId: active.skillId,
          hp: u.hp,
          en: u.en,
        });
      }
    }
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0 && u.fullBoost)) {
      const active = u.fullBoost;
      active.remaining--;
      const expired = active.remaining <= 0;
      if (expired) {
        delete u.fullBoost;
        u.skillReadyRound = {
          ...u.skillReadyRound,
          [active.skillId]: g.round + (active.cooldownTurns + 1) * 2,
        };
      }
      g.turnEffects.push({
        type: "fullboost",
        unitId: u.id,
        skillId: active.skillId,
        remaining: Math.max(0, active.remaining),
        expired,
      });
    }
    const teamsAlive = [0, 1].map((team) =>
      g.units.some((unit) => unit.team === team && unit.hp > 0),
    );
    if (!teamsAlive[0] || !teamsAlive[1]) g.winner = teamsAlive[0] ? 0 : 1;
    g.team = 1 - g.team;
    g.round++;
    for (const u of g.units) if (u.burning?.expiresRound <= g.round) delete u.burning;
    g.visionAreas = (g.visionAreas || []).filter((area) => area.expiresRound > g.round);
    g.minovskyFields = activeMinovskyFields(g);
    g.smokeFields = (g.smokeFields || []).filter((field) => field.expiresRound > g.round);
    g.beamDiffusionFields = (g.beamDiffusionFields || []).filter(
      (field) => field.expiresRound > g.round,
    );
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
        !u.embarked.exposed &&
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
      const field = modelOf(u).iField;
      if (field)
        u.iFieldHp = Math.min(
          field.capacity,
          iFieldHP(u) + (field.capacity * field.recoveryPercent) / 100,
        );
      u.acted = false;
      u.actionPoints = Math.max(0, actionBudget(u) - (u.apPenaltyNextTurn || 0));
      delete u.apPenaltyNextTurn;
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
        u.readySnipe = { target: target.id, weapon: weapon.id, aimCell: order.aimCell };
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
        (u.acted && !u.plan) ||
        (ownerSeat !== null && ownerOf(u) !== ownerSeat)
      )
        return false;
      if (u.embarked) return true;
      if (u.plan) {
        if (actionPoints(u) <= 0) return false;
        return enemies.some((target) => {
          const order = attackPlanFor(u, target);
          const committed = order
            ? (order.weapons || [order.weapon])
                .map((id) => modelOf(u).weapons.find((weapon) => weapon.id === id))
                .filter(Boolean)
            : [];
          return modelOf(u).weapons.some((weapon) => {
            try {
              attackQueue(g, u, target, [...committed, weapon]);
              return true;
            } catch {
              return false;
            }
          });
        });
      }
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
  // Count both committed damage and attackers so AI spreads fire across viable targets.
  function aiTargetPressure(g, team) {
    const pressure = new Map();
    for (const attacker of g.units) {
      if (attacker.team !== team || !onMap(attacker)) continue;
      for (const plan of attackOrders(attacker)) {
        const target = g.units.find((unit) => unit.id === plan.target);
        if (!target || !onMap(target) || target.team === team) continue;
        const commitment = pressure.get(target.id) || { damage: 0, attackers: 0 };
        let assigned = false;
        for (const id of plan.weapons || [plan.weapon]) {
          const weapon = modelOf(attacker).weapons.find((entry) => entry.id === id);
          if (!weapon || (weapon.special?.type === "snipe" && !plan.charged)) continue;
          const result = estimate(g, attacker, target, weapon);
          const expected = (result.damage * result.hit) / 100;
          if (expected <= 0) continue;
          commitment.damage += expected;
          assigned = true;
        }
        if (assigned) {
          commitment.attackers++;
          pressure.set(target.id, commitment);
        }
      }
    }
    return pressure;
  }
  function aiChoice(g, u, destinations = null) {
    let cells =
        destinations ??
        (u.moved ? [{ x: u.x, y: u.y, cost: 0, path: [] }] : [...reachable(g, u).values()]),
      enemies = g.units.filter(
        (e) => e.team !== u.team && onMap(e) && sensors.visible(g, u.team, e),
      ),
      best = null;
    const weapons = modelOf(u).weapons,
      pressure = aiTargetPressure(g, u.team);
    // Visibility is fixed during this decision; do not rescan every allied
    // sensor for each cell × enemy × weapon combination.
    const decisionGame = {
      ...g,
      intel: { ...g.intel, team: u.team, visibleIds: enemies.map((e) => e.id) },
    };
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
        near = enemies.length
          ? Math.min(...enemies.map((e) => dist(virtual, e)))
          : Math.hypot(c.x - (u.team === 0 ? mapWidth(g) - 3 : 2), c.y - mapHeight(g) / 2);
      let score = -near * 0.12 - c.cost * 0.025 + terrain[g.tiles[c.y][c.x]].cover * 0.006,
        target = null,
        weapon = null,
        assignedAttackers = Infinity;
      for (const e of enemies)
        for (const w of weapons)
          if (
            inRange(virtual, e, w) &&
            (!destinations || w.slot !== "skill") &&
            actionCost(w) <= actionPoints(u) + (u.plan?.actionCost ?? 0) &&
            canAttack(decisionGame, virtual, e, w)
          ) {
            let ex = estimate(g, virtual, e, w),
              commitment = pressure.get(e.id),
              remaining = Math.max(0, e.hp - (commitment?.damage || 0)),
              expected = (ex.damage * ex.hit) / 100,
              s =
                2 +
                Math.min(expected, remaining) / 1000 +
                (remaining > 0 ? Math.min(1, expected / remaining) * 0.6 : 0) -
                c.cost * 0.025 -
                (destinations ? near * 0.12 : 0);
            if (
              expected > 0 &&
              ((commitment?.attackers || 0) < assignedAttackers ||
                ((commitment?.attackers || 0) === assignedAttackers && s > score))
            ) {
              score = s;
              target = e.id;
              weapon = w.id;
              assignedAttackers = commitment?.attackers || 0;
            }
          }
      if (
        !best ||
        assignedAttackers < best.assignedAttackers ||
        (assignedAttackers === best.assignedAttackers && score > best.score)
      )
        best = { ...c, score, target, weapon, assignedAttackers };
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
    sensors,
  });
  return {
    sensors,
    activeMinovskyFields,
    minovskyAt,
    minovskyCells,
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
        SmallUnit: "小型",
        MediumUnit: "中型",
        LargeUnit: "大型",
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
    validateTeamFactions,
    validateFogMode,
    validateBattleMode,
    defaultRoomSettings,
    formationRestrictions,
    restrictionReason,
    normalizeInventory,
    inventoryPlan,
    factions,
    eras,
    unitTags,
    maxCostLimit,
    movementCost,
    H,
    models,
    catalog,
    validateFormation,
    formationWeight,
    formationPoints,
    pilots,
    pilotUnitName: (unit) =>
      (unit.pilot?.custom ? unit.pilot.name + "驾驶的" : "") + unitName(unit),
    normalizeUnitName,
    generateUnitName,
    unitName,
    randomFormation,
    unitSkills: skills.of,
    canUseSkill: skills.canUse,
    skillTargets: skills.targets,
    useSkill: skills.use,
    environmentOf,
    adaptationOf,
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
    aiShipQuota,
    aiPerformance,
    validateAISettings,
    aiBudget,
    modelOf,
    weaponStats,
    inSupplyRange,
    commandAura,
    commandEffects,
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
    unitSize,
    key,
    dist,
    create,
    at,
    reachable,
    faceTarget,
    move,
    previewMove,
    confirmMove,
    cancelMove,
    undo,
    canUndo,
    countersRemaining,
    canCounter,
    eventWeapon,
    random,
    weaponCooldown,
    startWeaponCooldown,
    canUse,
    pilotWeaponAllowed,
    actionBudget,
    counterActionBudget,
    actionPoints,
    actionCost,
    attackQueue,
    attackOrders,
    attackPlanFor,
    attackBudget,
    counterQueue,
    counterPlan,
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
    attackCells,
    weakPoint,
    blastContains,
    groundTarget,
    canAttack,
    irradiationLine,
    lineIntersectsUnit,
    aiAreaSkill,
    hasSfsMS,
    tickBurning,
    estimate,
    beamDiffusionFactor,
    smokeAt,
    iFieldHP,
    fight,
    counter,
    wait,
    end,
    hasActions,
    turnTransitionMs,
    bestResponse,
    aiChoice,
    aiTargetPressure,
    aiLaunchChoice,
  };
})();
if (typeof module !== "undefined") module.exports = Tactics;
