/* 服务端与离线试玩共用的规则，不在这里调整 UI 尺寸或特效。
 * g = 对局，u = 单位，a/b = 攻防双方，w = 武器。
 */
"use strict";
const Tactics = (() => {
  // 机体数值配置。视觉大小另存于 client/ui-layout.json，不影响战斗属性。
  const catalog =
    typeof ART !== "undefined" ? ART : require("../tools/load-catalog.cjs").loadCatalog();
  const models = catalog.models;
  const automaticFire =
    typeof AutomaticFire !== "undefined" ? AutomaticFire : require("./automatic-fire.js");
  const aiTactics = typeof AITactics !== "undefined" ? AITactics : require("./ai-tactics.js");
  const aiUnitBans = typeof AI_UNIT_BANS !== "undefined" ? AI_UNIT_BANS : require("./ai-unit-bans.json");
  const campaignBattlefield =
    typeof CampaignBattlefield !== "undefined"
      ? CampaignBattlefield
      : require("./campaign-battlefield.js");
  const damagePolicy =
    typeof WeaponSequence !== "undefined" ? WeaponSequence : require("./weapon-sequence.js");
  const roundDamage = damagePolicy.roundDamage;

  const development =
    typeof Development !== "undefined" ? Development : require("./development.js");
  const economy = typeof Economy !== "undefined" ? Economy : require("./economy.js");
  const parts = typeof UnitParts !== "undefined" ? UnitParts : require("./unit-parts.js");
  const skillModule = typeof UnitSkills !== "undefined" ? UnitSkills : require("./unit-skills.js");
  const hangarModule = typeof UnitHangars !== "undefined" ? UnitHangars : require("./hangars.js");
  const sensorModule =
    typeof UnitSensors !== "undefined" ? UnitSensors : require("./unit-sensors.js");
  const pilots = typeof PilotSystem !== "undefined" ? PilotSystem : require("./pilots.js");
  // SFS passengers remain independent combat actors; enclosed cargo stays hidden.
  const onMap = (u) => !!u && u.hp > 0 && (!u.embarked || u.embarked.exposed === true);
  const sensors = sensorModule.create({
    modelOf,
    cells,
    onMap,
    minovskyAt,
    spaceAt: (g, x, y) => cellEnvironment(g, x, y) === "space",
  });
  const turnTransitionMs = 1200;
  const W = catalog.map.width,
    H = catalog.map.height;
  const maxCostLimit = 99999;
  const seatTeam = (seat) => (seat === null ? null : seat % 2);
  const ownerOf = (unit) => unit.ownerSeat ?? unit.team;
  const controllerOf = (game, unit) => game.campaignControllers?.[ownerOf(unit)] ?? ownerOf(unit);
  function canControlUnit(settings, members, seat, unit) {
    if (!unit || !Number.isInteger(seat) || seat < 0 || !members?.some((m) => m.seat === seat))
      return false;
    if (ownerOf(unit) === seat) return true;
    return (
      unit.team === seatTeam(seat) &&
      (settings?.campaignCommanders?.[unit.team] === seat ||
        settings?.shareAlliedUnits === true ||
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
  const unitName = (unit) => modelOf(unit).name;
  function unitLogName(unit) {
    // Campaign army identity survives new regional deployments, owners and equipment.
    const campaignNumber = Number(String(unit.campaignId).match(/^army-([1-9]\d*)$/)?.[1]);
    if (Number.isSafeInteger(campaignNumber) && campaignNumber > 0)
      return unitName(unit) + `[No.${campaignNumber}]`;
    // Original formation position survives license filtering, embarking and form changes.
    const savedIndex =
      Number.isInteger(unit.formationIndex) && unit.formationIndex >= 0
        ? unit.formationIndex
        : Number(String(unit.id).match(/^\d+-(\d+)(?:-|$)/)?.[1]);
    return (
      unitName(unit) +
      (Number.isInteger(savedIndex) && savedIndex >= 0 ? `[No.${savedIndex + 1}]` : "")
    );
  }
  const formationWeight = (model) => (model.ship ? 4 : model.unitTags?.includes("MS") ? 2 : 1);
  const formationPoints = (entries) =>
    entries.reduce((total, entry) => {
      const model = formationModel(entry);
      return total + (model ? formationWeight(model) : 0);
    }, 0);
  // 编组与房间的单位限制均按占用点数计算。
  // Canonical formation entries always retain the purchased hull and kit. The
  // assigned ACE selects a presentation/combat form without creating inventory.
  function formationModelId(entry) {
    const baseId = entry.unitId + "__" + entry.kitId;
    const form = models[baseId]?.pilotForms?.find((f) => f.pilotId === entry.customPilot?.aceId);
    const target = form && form.unitId + "__" + form.kitMap[entry.kitId];
    return target && models[target] ? target : baseId;
  }
  function formationModel(entry) {
    return models[formationModelId(entry)];
  }
  function validateFormation(
    entries,
    maxCost = catalog.formation.maxCost,
    unitLimit = catalog.formation.maxUnits,
  ) {
    if (
      !Array.isArray(entries) ||
      !entries.length ||
      entries.length > unitLimit ||
      (unitLimit !== Infinity && !Number.isInteger(unitLimit)) ||
      unitLimit < 1 ||
      (unitLimit !== Infinity && unitLimit > catalog.formation.maxUnits)
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
      if (customPilot?.needsRecruitment) throw Error("该ACE需要重新招募后才能配属");
      if (!customPilot && pilots.aceProfile(entry.pilotId)) throw Error("请先招募并配属ACE驾驶员");
      cost += formationModel({ ...entry, customPilot }).cost + pilots.cost(customPilot);
      normalizeUnitName(entry.customName); // Validate and discard obsolete saved display names.
      const pilotId = customPilot?.id || pilots.validate(entry.pilotId, model);
      if (pilotId && assignedPilots.has(pilotId)) throw Error("同一驾驶员不能配属多台单位");
      if (pilotId) assignedPilots.add(pilotId);
      return {
        unitId: model.prefabId,
        kitId: model.kitId,
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
      if (!hangar || !hangar.allowedTags.some((tag) => passenger.transport?.loadTags.includes(tag)))
        throw Error("该单位不能预先搭载至此格纳库");
      const key = preload.carrierIndex + "/" + preload.hangarId,
        used =
          (capacity.get(key) || 0) +
          (hangar.kind === "sfs" ? 1 : passenger.transport?.slotCost || 1);
      if (used > hangar.capacity) throw Error("预先搭载超出格纳库容量");
      capacity.set(key, used);
      clean[index].preload = { carrierIndex: preload.carrierIndex, hangarId: preload.hangarId };
    });
    for (let i = 0; i < clean.length; i++) {
      const seen = new Set([i]);
      let current = clean[i];
      while (current.preload) {
        const parent = current.preload.carrierIndex;
        if (seen.has(parent)) throw Error("不能循环搭载");
        seen.add(parent);
        current = clean[parent];
      }
    }
    if (cost > maxCost) throw Error("编组 COST 超出上限");
    return clean;
  }
  const factions = ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"];
  const eras = [
    ...new Set(
      catalog.prefabs.flatMap((prefab) =>
        prefab.tags.filter((tag) => /^\d{4}(?:T[12])?$/.test(tag)),
      ),
    ),
  ].sort();
  function expandEraTag(tag) {
    if (tag === "0079E") return ["0079T1"];
    if (tag === "0079L") return ["0079T2"];
    if (tag === "0079" || tag === "0087")
      return eras.filter((era) => era.startsWith(tag));
    return [tag];
  }
  const unitTags = [...new Set(catalog.prefabs.flatMap((p) => p.unitTags || []))].sort();
  function validateUnitCostLimit(value) {
    if (!Number.isInteger(value) || value < 1 || value > maxCostLimit)
      throw Error("单位 COST 上限无效");
    return value;
  }
  const pilotTags = ["pilot:custom", ...factions.map(faction => "pilot:" + faction)];
  const factionTags = [...factions, ...pilotTags];
  function validatePilotPolicy(value = "allow") {
    if (!["allow", "no_custom", "no_ace", "none"].includes(value)) throw Error("驾驶员使用限制无效");
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
      ["bannedFactions", factionTags],
      ["bannedEras", eras],
      ["bannedTypes", unitTags],
    ]) {
      let tags = value[key] ?? [];
      // Saved pre-split room rules used 0079 for both early and late units.
      if (key === "bannedEras" && Array.isArray(tags))
        tags = tags.flatMap(expandEraTag);
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
      value.some(
        (faction) =>
          faction !== null &&
          !["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(faction),
      )
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
    if (!["regular", "quick", "campaign"].includes(value)) throw Error("对战模式无效");
    return value;
  }
  function defaultRoomSettings() {
    return {
      mode: "regular",
      fogMode: "full",
      mapId: catalog.defaultMap,
      costLimit: 2000,
      unitLimit: 36,
      unitCostLimit: 250,
      shareAlliedUnits: false,
      pilotPolicy: "allow",
      ...validateTagRestrictions(),
      teamRestrictions: [validateTagRestrictions(), validateTagRestrictions()],
      teamFactions: [null, null],
    };
  }
  // Strategic rooms use scenario armies; ordinary formation and tag settings do not apply.
  function campaignRoomSettings(settings = {}) {
    return {
      ...defaultRoomSettings(),
      mapId: settings.mapId || "military_base_5v5",
      mode: "campaign",
      scenarioId: "earth_0079_mid",
      fogMode: settings.fogMode ?? "disabled",
      costLimit: maxCostLimit,
      campaignOptions: aiTactics.settings(settings.campaignOptions),
      unitCostLimit: maxCostLimit,
      unitLimit: catalog.formation.maxUnits,
    };
  }
  function formationRestrictions(settings = {}, seat = null) {
    if (settings.mode === "campaign")
      return {
        environment: getMap(settings.mapId).environment,
        mapId: settings.mapId,
        deploymentSeat: seat ?? 0,
        unitCostLimit: Infinity,
        ...validateTagRestrictions(),
      };
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
      pilotPolicy: validatePilotPolicy(settings.pilotPolicy),
      bannedFactions: [
        ...new Set([...(settings.bannedFactions || []), ...(teamRules?.bannedFactions || [])]),
      ],
      bannedEras: [...new Set([...(settings.bannedEras || []), ...(teamRules?.bannedEras || [])])],
      bannedTypes: [
        ...new Set([...(settings.bannedTypes || []), ...(teamRules?.bannedTypes || [])]),
      ],
    };
  }
  function normalizeLicenses(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("部署许可无效");
    const result = {};
    for (const [id, count] of Object.entries(value)) {
      if (!catalog.prefabs.some((p) => p.id === id) || typeof count !== "boolean")
        throw Error("部署许可无效：" + id);
      if (count) result[id] = true;
    }
    return result;
  }
  function licensePlan(entries, licenses) {
    return {
      missing: entries.flatMap((entry, index) => (licenses[entry.unitId] === true ? [] : [index])),
    };
  }
  function stockAccess(model, restrictions) {
    const stock = restrictions.ownedStock || restrictions;
    return (stock.inventory?.[model.prefabId] || 0) > 0 &&
      (stock.kits?.[model.prefabId + "__" + model.kitId] || 0) > 0;
  }
  function restrictionReason(model, restrictions = {}) {
    if (model.wip) return "wip";
    if (restrictions.aiBannedUnits?.includes(model.prefabId)) return "not_allowed";
    if (restrictions.aiAllowedEras && !model.tags.some(tag => restrictions.aiAllowedEras.includes(tag)))
      return "not_allowed";
    if (
      ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(restrictions.characterFaction) &&
      !(model.availableFactions || [model.faction]).includes(restrictions.characterFaction)
    )
      return "faction_mismatch";
    if (
      ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(
        restrictions.characterFaction,
      ) &&
      !development.allows(restrictions.characterFaction, model.prefabId, restrictions.researched) &&
      (restrictions.licenses ?? restrictions.ownedLicenses)?.[model.prefabId] !== true &&
      !stockAccess(model, restrictions)
    )
      return "not_developed";
    if (restrictions.environment && (model.adaptability?.[restrictions.environment] ?? 100) <= 0)
      return "not_allowed";
    if (
      model.movementType === "naval" &&
      restrictions.mapId &&
      !getMap(restrictions.mapId).navalDeployment &&
      getMap(restrictions.mapId).scope !== "strategic"
    )
      return "not_allowed";
    if (
      restrictions.bannedFactions?.includes(model.faction) ||
      model.tags.some(
        (tag) =>
          restrictions.bannedEras?.some((era) => expandEraTag(era).includes(tag)),
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
    // Pilot cost consumes the formation budget only. Per-unit restrictions
    // below always inspect the chassis model, never this combined budget cost.
    const unitCosts = clean.map((entry) => formationModel(entry).cost);
    const pilotCosts = clean.map((entry) => pilots.cost(entry.customPilot));
    const costs = unitCosts.map((value, index) => value + pilotCosts[index]);
    const totalCost = costs.reduce((sum, value) => sum + value, 0);
    const reasons = {};
    clean.forEach((entry, index) => {
      const reason =
        restrictionReason(models[entry.unitId + "__" + entry.kitId], restrictions) ||
        restrictionReason(formationModel(entry), { ...restrictions, characterFaction: null });
      if (reason) reasons[index] = reason;
      if (
        formationModel(entry).requiredPilotId &&
        formationModel(entry).requiredPilotId !== entry.customPilot?.aceId
      )
        reasons[index] = "pilot_required";
      if (
        restrictions.characterFaction &&
        !pilots.canAssign(entry.customPilot, restrictions.characterFaction)
      )
        reasons[index] = "pilot_faction";
      if (!pilots.allowed(entry.customPilot, restrictions)) reasons[index] = "pilot_banned";
    });
    if (restrictions.licenses !== undefined) {
      const licenses = normalizeLicenses(restrictions.licenses);
      // Only otherwise legal entries need a deployment license.
      const candidates = clean.flatMap((entry, index) =>
        reasons[index] ? [] : [{ entry, index }],
      );
      for (const i of licensePlan(
        candidates.map((c) => c.entry),
        licenses,
      ).missing)
        if (!stockAccess(models[candidates[i].entry.unitId + "__" + candidates[i].entry.kitId], restrictions))
          reasons[candidates[i].index] = "license";
      // In quick battles stock is an alternative to a license, not an unlimited permit.
      if (restrictions.inventory === undefined && restrictions.ownedStock) {
        const unlicensed = candidates.filter(item => licenses[item.entry.unitId] !== true && !reasons[item.index]);
        const plan = economy.stockPlan(unlicensed.map(item => item.entry), restrictions.ownedStock);
        for (const i of plan.missing) reasons[unlicensed[i].index] = plan.reasons[i];
      }
    }
    if (restrictions.inventory !== undefined || restrictions.kits !== undefined) {
      const candidates = clean.flatMap((entry, index) => reasons[index] ? [] : [{ entry, index }]);
      const stock = economy.stockPlan(candidates.map(item => item.entry), restrictions);
      for (const index of stock.missing) reasons[candidates[index].index] = stock.reasons[index];
    }
    let occupied = 0;
    clean.forEach((entry, index) => {
      if (reasons[index]) return;
      const weight = formationWeight(formationModel(entry));
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
  const strengthPercentages = Object.freeze(armyPercentages.filter((percent) => percent <= 200));
  const aiCountPercentages = armyPercentages;
  const aiDefaults = Object.freeze({ difficulty: "medium", fill: 100, countPercent: 100 });
  const aiPerformance = Object.freeze({
    easy: 0.75,
    medium: 1,
    hard: 1.25,
    ...Object.fromEntries(strengthPercentages.map((percent) => [percent, percent / 100])),
  });
  function validateAISettings(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("AI 设置无效");
    const clean = { ...aiDefaults, ...value };
    if (
      !(
        strengthPercentages.includes(clean.difficulty) ||
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
  function aiFormationVariation(seed, seat = 0) {
    let state = (seed ^ Math.imul(seat + 1, 0x9e3779b9)) >>> 0;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (75 + Math.floor((state / 4294967296) * 26)) / 100;
    };
    return { budget: next(), points: next(), unitCost: next() };
  }
  function armyBudget(settings, player) {
    if (player?.formationPreset)
      return Math.max(
        maxCostLimit,
        player.formationPreset.units.reduce(
          (sum, e) => sum + formationModel(e).cost + pilots.cost(e.customPilot),
          0,
        ),
      );
    return Math.floor(
      ((settings.costLimit * armySettings(player).fill) / 100) *
        (player?.bot ? (player.formationVariation?.budget ?? 1) : 1),
    );
  }
  function armyUnitLimit(settings, player) {
    if (player?.formationPreset) return formationPoints(player.formationPreset.units);
    const base = Math.min(
      catalog.formation.maxUnits,
      Math.max(1, Math.floor((settings.unitLimit * armySettings(player).countPercent) / 100)),
    );
    return player?.bot && player.formationVariation
      ? Math.max(Math.ceil(base * 0.75), Math.floor(base * player.formationVariation.points))
      : base;
  }
  function armyRestrictions(settings, player) {
    const rules = formationRestrictions(settings, player?.seat ?? null);
    rules.characterFaction = ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(
      player?.characterFaction,
    )
      ? player.characterFaction
      : null;
    // AI exclusions affect generation, previews and final deployment together.
    // Human rosters and strategic armies keep their own existing rules.
    if (player?.bot && aiUnitBans[settings.mode || "regular"])
      rules.aiBannedUnits = [...aiUnitBans[settings.mode || "regular"]];
    // Room authority supplies the merged, cross-faction AI progression.
    rules.researched = player?.researched;
    if (player && !player.bot) {
      rules.licenses = normalizeLicenses(player.licenses);
      // Readiness may skip quantity checks while retaining ownership-based deployment access.
      rules.ownedLicenses = rules.licenses;
      rules.ownedStock = economy.normalizeStock(player);
      if (!player.formationPreset && settings.mode === "regular") Object.assign(rules, economy.normalizeStock(player));
    }
    const config = armySettings(player);
    rules.unitCostLimit =
      config.unitCostLimit ??
      Math.max(1, Math.floor((rules.unitCostLimit * config.unitCostPercent) / 100));
    if (player?.formationPreset) {
      rules.unitCostLimit = maxCostLimit;
    } else if (player?.bot && player.formationVariation) {
      rules.unitCostLimit = Math.max(
        1,
        Math.floor(rules.unitCostLimit * player.formationVariation.unitCost),
      );
    }
    return rules;
  }
  // Reserve a modest fleet component independently of technology and aircraft prices.
  // Small armies still spend their limited budget on frontline units.
  function aiShipQuota(count, seed) {
    if (count < 8) return 0;
    return Math.max(1, Math.floor(count / (7 + ((seed >>> 0) % 2))));
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
    const transport = (model) => !model.ship && support(model) && model.hangars?.length > 0;
    const lightAircraft = (model) =>
      !model.ship && !support(model) && !model.unitTags?.includes("MS") &&
      model.unitTags?.includes("Aircraft");
    const frontlineMS = (model) =>
      model.unitTags?.includes("MS") && !model.unitTags.includes("Recon") && !support(model);
    const commander = (model) =>
      !model.ship &&
      model.commandAuras?.some((aura) => ["cmdAtk", "cmdCom", "cmdDef"].includes(aura.type));
    const copies = (id) => entries.filter((entry) => entry.unitId === id).length;
    const choices = Object.values(models).filter(
        (model) =>
          !model.formOnly &&
          !model.requiredPilotId &&
          !restrictionReason(model, { ...restrictions, environment }) &&
          adaptation(model) > 0 &&
          !(environment === "space" && infantry(model) && adaptation(model) < 100) &&
          (model.weapons.length > 0 ||
            model.supplyAura ||
            model.skills?.some((s) => ["repair", "recon"].includes(s.type))),
      ),
      entries = [];
    if (!choices.length) return entries;
    const mainlineUnits = new Set(
      ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].flatMap((faction) =>
        development
          .nodes(faction)
          .filter((node) => node.row === "mid")
          .flatMap((node) => node.unlocks),
      ),
    );
    // Use the earliest unlocking node, not COST or a weapon's level, as the
    // platform's technology tier. Later duplicate unlocks do not upgrade it.
    const technologyRanks = new Map();
    for (const faction of ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"])
      for (const node of development.nodes(faction)) {
        const era = Number(String(node.era || "0079").slice(0, 4));
        const rank = era * 10000 + (node.page || 0) * 100 + (node.column || 0);
        for (const id of node.unlocks)
          technologyRanks.set(id, Math.min(technologyRanks.get(id) ?? Infinity, rank));
      }
    const knownRanks = choices.map((model) => technologyRanks.get(model.prefabId)).filter(Number.isFinite);
    const initialTechnology = knownRanks.length ? Math.min(...knownRanks) : 0;
    const technologyRank = (model) => technologyRanks.get(model.prefabId) ?? initialTechnology;
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
    // Choose a backbone quality floor before spending anything. Unspent slots
    // are preferable to padding a late-tech army with obsolete cheap vehicles.
    const backbone = coreChoices.filter(model => frontlineMS(model) && model.cost <= maxCost);
    const primaryBackbone = backbone.filter(model => mainlineUnits.has(model.prefabId) && !commander(model));
    const backbonePool = primaryBackbone.length ? primaryBackbone : backbone;
    const backboneTier = Math.max(...backbonePool.map(technologyRank));
    const backboneQuality = Math.max(0, ...backbonePool.filter(model => technologyRank(model) === backboneTier).map(costPerPoint));
    const minimumCombatQuality = backboneQuality * 0.55;
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
    const desiredTransports = expectedCount >= 8 ? Math.max(1, Math.floor(expectedCount / 12)) : 0;
    const frontlineTarget = Math.max(2, Math.ceil(
      (unitLimit - desiredShips * 4 - desiredTransports) * 0.8 / 2,
    ) * 2);
    const aircraftPointLimit = Math.max(1, Math.floor(unitLimit * 0.15));
    let remaining = maxCost;
    let remainingPoints = unitLimit;
    for (let i = 0; i < count; i++) {
      // Capacity remains a ceiling, not a target to fill with cheap units.
      // Stop when no useful legal platform fits the remaining budget or points.
      const fillablePoints = Math.floor(remainingPoints / minimumWeight) * minimumWeight;
      if (!fillablePoints) break;
      const placementCache = new Map();
      const commanderCount = entries.filter((entry) => commander(formationModel(entry))).length;
      const nonShipCount = entries.filter((entry) => !formationModel(entry).ship).length;
      const commandAllowance = commandAllowances[Math.floor((nonShipCount + 1) / 3)] || 0;
      const infantryCount = entries.filter((entry) => infantry(formationModel(entry))).length;
      const supportCount = entries.filter((entry) => support(formationModel(entry))).length;
      const combatCount = entries.length - supportCount;
      const ships = entries.filter((entry) => formationModel(entry).ship).length;
      const transports = entries.filter((entry) => transport(formationModel(entry))).length;
      const aircraftPoints = entries.reduce((sum, entry) => {
        const model = formationModel(entry);
        return sum + (lightAircraft(model) ? formationWeight(model) : 0);
      }, 0);
      const hasFrontline = choices.some(frontlineMS);
      const legal = choices.filter((model) => {
        if (hasFrontline && lightAircraft(model) && aircraftPoints >= aircraftPointLimit) return false;
        if (model.ship && ships >= desiredShips && coreChoices.some((m) => !m.ship)) return false;
        if (transport(model) && transports >= desiredTransports) return false;
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
        if (model.cost > remaining) return false;
        if (!model.ship && !support(model) && backbone.length &&
            (!frontlineMS(model) && !model.unitTags?.includes("MA") || costPerPoint(model) < minimumCombatQuality)) return false;
        if (model.ship && entries.reduce((sum,entry)=>sum+(formationModel(entry).ship?formationModel(entry).cost:0),0)+model.cost > maxCost*0.35) return false;
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
            const f = formationModel(entry).footprint;
            return f ? f.width * f.height : 1;
          };
          const candidate = { unitId: model.prefabId, kitId: model.kitId };
          if (
            sharedAreaSize &&
            entries.reduce((total, entry) => total + size(entry), 0) +
              size(candidate) >
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
      // Choose a role before its technology tier: a newly unlocked fighter must
      // not displace the MS backbone or every older logistics aircraft.
      const fleet = ships < desiredShips ? preferred.filter((model) => model.ship) : [];
      const logistics = transports < desiredTransports && combatCount >= 4
        ? preferred.filter((model) => transport(model) &&
            entries.some((entry) => {
              const passenger = formationModel(entry);
              return !entry.preload && model.hangars.some((hangar) =>
                hangar.capacity >= (passenger.transport?.slotCost || 1) &&
                hangar.allowedTags.some((tag) => passenger.transport?.loadTags.includes(tag)));
            }))
        : [];
      const combat = preferred.filter((model) => !model.ship && !support(model));
      if (fleet.length) preferred = fleet;
      else if (logistics.length) preferred = logistics;
      else if (combat.length) preferred = combat;
      // Keep most non-logistics points in combat MS when they are available.
      const frontlinePoints = entries.reduce((sum, entry) => {
        const model = formationModel(entry);
        return sum + (frontlineMS(model) ? formationWeight(model) : 0);
      }, 0);
      const frontline = preferred.filter(frontlineMS);
      if (frontline.length && frontlinePoints < frontlineTarget) preferred = frontline;
      // Three backbone selections for each elite selection. BASE-tech aircraft
      // and branch prototypes cannot replace the main-line MS core.
      const primary = preferred.filter(model => frontlineMS(model) && mainlineUnits.has(model.prefabId) && !commander(model));
      if (primary.length && combatCount % 4 !== 3) preferred = primary;
      const leaders = preferred.filter(commander);
      if (leaders.length && commanderCount < commandAllowance) preferred = leaders;
      // Try the latest affordable technology first. Once every platform there
      // is represented, also admit the preceding column to retain variety.
      const highestTechnology = Math.max(...preferred.map(technologyRank));
      const latest = preferred.filter((model) => technologyRank(model) === highestTechnology);
      const diversify = latest.every((model) => copies(model.prefabId) > 0);
      preferred = preferred.filter((model) =>
        technologyRank(model) === highestTechnology ||
        (diversify && technologyRank(model) === highestTechnology - 1 && copies(model.prefabId) === 0),
      );
      // Select a competitive price per point first, then diversify within that
      // tier. A new cheap platform must not crowd out an affordable combat MS.
      const highestCost = Math.max(...preferred.map(costPerPoint));
      // Spend on useful platforms, not a target average dictated by empty slots.
      // Role quotas and the quality floor stop luxury units or leftovers taking over.
      let affordableTier = preferred.filter(model => costPerPoint(model) >= highestCost * 0.65);
      // Narrow price bands must not force another copy while comparable unused platforms exist.
      if (affordableTier.every((model) => copies(model.prefabId) > 0)) {
        const tierPrice = Math.max(...affordableTier.map(costPerPoint));
        const unused = preferred.filter(
          (model) =>
            copies(model.prefabId) === 0 &&
            costPerPoint(model) >= tierPrice * 0.6 &&
            costPerPoint(model) <= tierPrice * 1.25,
        );
        affordableTier.push(...unused);
      }
      const fewestCopies = Math.min(...affordableTier.map((model) => copies(model.prefabId)));
      affordableTier = affordableTier.filter((model) => copies(model.prefabId) === fewestCopies);
      // 先抽机体再抽套件，避免套件更多的廉价机体获得额外抽取权重。
      const prefabIds = [...new Set(affordableTier.map((model) => model.prefabId))];
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      // Main-line units have triple weight; kits never multiply a platform's probability.
      const weights = prefabIds.map((id) => (mainlineUnits.has(id) ? 3 : 1));
      let pick = (seed / 4294967296) * weights.reduce((sum, weight) => sum + weight, 0);
      let chosen = 0;
      for (; chosen < prefabIds.length - 1 && pick >= weights[chosen]; chosen++)
        pick -= weights[chosen];
      const prefabId = prefabIds[chosen];
      const kits = affordableTier.filter((model) => model.prefabId === prefabId);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const model = kits[seed % kits.length];
      entries.push({
        unitId: model.prefabId,
        kitId: model.kitId,
      });
      remaining -= model.cost;
      remainingPoints -= formationWeight(model);
    }
    // Assign existing squad entries to compatible hangars; never create free passengers.
    const hangars = entries.flatMap((entry, carrierIndex) =>
      (formationModel(entry).hangars || []).map((h) => ({
        carrierIndex,
        hangar: h,
        remaining: h.capacity,
      })),
    );
    for (const [index, entry] of entries.entries()) {
      const model = formationModel(entry);
      if (!model.transport || entry.preload) continue;
      const compatible = hangars
        .filter(
          (slot) =>
            slot.carrierIndex !== index &&
            slot.remaining >= (slot.hangar.kind === "sfs" ? 1 : model.transport.slotCost) &&
            slot.hangar.allowedTags.some((tag) => model.transport.loadTags.includes(tag)),
        )
        .filter((slot) => {
          const seen = new Set([index]);
          let parent = slot.carrierIndex;
          while (entries[parent]) {
            if (seen.has(parent)) return false;
            seen.add(parent);
            if (!entries[parent].preload) break;
            parent = entries[parent].preload.carrierIndex;
          }
          return true;
        });
      if (!compatible.length) continue;
      // Pack same chassis together so their launches can form a squad. Prefer
      // efficient capacity use instead of randomly leaving half the cargo outside.
      const packedPeers = (slot) => entries.filter((other) =>
        other.preload?.carrierIndex === slot.carrierIndex &&
        formationModel(other).prefabId === model.prefabId).length;
      compatible.sort((a, b) => packedPeers(b) - packedPeers(a) || a.remaining - b.remaining);
      const slot = compatible[0];
      entry.preload = { carrierIndex: slot.carrierIndex, hangarId: slot.hangar.id };
      slot.remaining -= slot.hangar.kind === "sfs" ? 1 : model.transport.slotCost;
    }
    return entries;
  }
  // 武器应用部位损坏与浮游炮觉醒成长；玩家强度仅影响本体耐久和 EN。
  function weaponStats(weapon, unit) {
    const attackMultiplier = parts.penalties(unit).attackMultiplier,
      previousAttack = weapon.partDamageMultiplier ?? 1;
    const awakening =
      weapon.remote && weapon.remote.kind !== "incom"
        ? pilots.of(unit, models[unit.model]).stats.awakening
        : 100;
    const remoteMultiplier =
      weapon.remote && weapon.remote.kind !== "incom"
        ? awakening < 100
          ? Math.max(0, awakening / 100)
          : 1 + (awakening - 100) * weapon.remote.awakeningScale
        : 1;
    const previousRemote = weapon.remoteDamageMultiplier ?? 1;
    if (previousRemote === 0 && remoteMultiplier > 0) {
      const original = models[unit.model]?.weapons.find((candidate) => candidate.id === weapon.id);
      if (original) return weaponStats(original, unit);
    }
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
    if (
      attackMultiplier === previousAttack &&
      en === weapon.en &&
      remoteMultiplier === previousRemote
    )
      return weapon;
    const damageRatio =
      (attackMultiplier / previousAttack) *
      (previousRemote === 0 ? 1 : remoteMultiplier / previousRemote);
    // Keep intermediate modifiers exact; round the public base numbers and the
    // final protected hit, rather than rounding every buff independently.
    const scaledDamage = (components) =>
      Object.fromEntries(
        Object.entries(components).map(([key, value]) => [key, value * damageRatio]),
      );
    return {
      ...weapon,
      en: Math.round(en),
      partDamageMultiplier: attackMultiplier,
      remoteDamageMultiplier: remoteMultiplier,
      get name() {
        return weapon.name;
      },
      get description() {
        return weapon.description;
      },
      damagePerShot: roundDamage(weapon.damagePerShot * damageRatio),
      damage: weapon.attack.strikes.reduce(
        (sum, step) =>
          sum +
          roundDamage(
            Object.values(step.damageComponents || weapon.damageComponents).reduce(
              (n, value) => n + value,
              0,
            ) *
              damageRatio *
              (step.damageMultiplier ?? 1),
          ),
        0,
      ),
      hit: weapon.hit,
      attack: {
        ...weapon.attack,
        steps: (weapon.attack.steps || []).map((step) =>
          step.shots
            ? {
                ...step,
                damageComponents: scaledDamage(step.damageComponents || weapon.damageComponents),
              }
            : step,
        ),
        strikes: weapon.attack.strikes.map((step) => ({
          ...step,
          ...(step.damageComponents
            ? {
                damageComponents: scaledDamage(step.damageComponents),
              }
            : {}),
        })),
      },
      damageComponents: scaledDamage(weapon.damageComponents),
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
        move: base.deployed ? 0 : Math.max(1, Math.round(base.move * modifiers.move)),
        // Legacy mobility stores native baseReactionLevel, not movement/speed.
        mobility: Math.round(base.mobility * modifiers.reaction),
        accuracy: Math.round(base.accuracy * modifiers.accuracy),
        pilotModifiers: modifiers,
        pilotExperienceMultiplier:
          (base.pilotExperienceMultiplier ?? 1) * pilots.experienceMultiplier(unit),
      });
    }
    return variants.get(pilot);
  }
  // Derive damage penalties from current parts; never modify a shared catalog or AI variant.
  function cellEnvironment(g, x, y) {
    return (
      g?.cellEnvironments?.[y]?.[x] ??
      (g?.mapId ? getMap(g.mapId).cellEnvironments?.[y]?.[x] : null) ??
      g?.environment ??
      "ground"
    );
  }
  function environmentOf(g, unit, x = unit.x, y = unit.y) {
    if ((g ? cellEnvironment(g, x, y) : unit.environment) === "space") return "space";
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
  function flightAdaptability(unit) {
    return (
      models[unit.model].skills?.find((skill) => skill.type === "flight")?.airAdaptability ?? 100
    );
  }
  function adaptationOf(g, unit, x = unit.x, y = unit.y) {
    const environment = environmentOf(g, unit, x, y);
    return (
      (unit.flying && environment === "air"
        ? flightAdaptability(unit)
        : (models[unit.model].adaptability?.[environment] ?? 100)) / 100
    );
  }
  const durabilityModels = new WeakMap();
  function campaignModelOf(unit) {
    const base = performanceModelOf(unit),
      factor = unit.campaignDurability ?? 1;
    if (factor === 1) return base;
    let variants = durabilityModels.get(base);
    if (!variants) durabilityModels.set(base, (variants = new Map()));
    if (!variants.has(factor)) variants.set(factor, { ...base, hp: Math.ceil(base.hp * factor) });
    return variants.get(factor);
  }
  function modelOf(unit, g = null) {
    const original = pilotModelOf(unit, campaignModelOf(unit)),
      base = unit.flying
        ? {
            ...original,
            movementType: "air",
            adaptability: { ...original.adaptability, air: flightAdaptability(unit) },
          }
        : original,
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
        base.deployed || adaptability === 0
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
    if (g.campaignBattlefield) {
      const actor =
        unit ||
        g.units.find(
          (actor) =>
            actor.campaignDeploying &&
            !actor.embarked &&
            campaignBattlefield.deploymentSeat(g, actor) === seat,
        );
      return actor
        ? campaignBattlefield
            .deploymentCells(Tactics, g, actor)
            .filter((cell) => Number.isFinite(terrainCost(g, actor, cell.x, cell.y)))
        : [];
    }
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
    const u = g.units.find(
      (u) =>
        u.id === id &&
        (g.campaignBattlefield
          ? u.campaignDeploying && campaignBattlefield.deploymentSeat(g, u) === team
          : ownerOf(u) === team),
    );
    if (
      !onMap(u) ||
      !!u.embarked ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !deploymentCells(g, team, u).some((c) => c.x === x && c.y === y)
    )
      throw Error("请在己方出生区的有效格子部署");
    const target = squadJoinTarget(g, u, x, y, [u]);
    if (!target && !fits(g, u, x, y, u.angle, false, team)) throw Error("该部署位置已有单位");
    delete u.rotationPivot;
    delete u.squadId; delete u.squadSlot;
    u.x = x;
    u.y = y;
    if (target) joinSquad(g, u, target);
    hangars.sync(g);
  }
  function aiDeployment(g, seat) {
    if (!g.deployment || g.deployment[seat]) return;
    const controlled = g.units.filter(u => ownerOf(u) === seat && onMap(u) &&
      (!g.campaignBattlefield || u.campaignDeploying));
    // Load compatible troops using real deployment, adjacency and native capacity checks.
    for (const carrier of controlled.filter(u => !u.embarked && hangars.of(u).length)) {
      for (const passenger of controlled.filter(u => u !== carrier && !u.embarked && !hangars.of(u).length)) {
        const allowed = new Set(deploymentCells(g, seat, passenger).map(c => key(c.x, c.y)));
        const destination = cells(carrier).flatMap(c => [[1,0],[-1,0],[0,1],[0,-1]]
          .map(([dx,dy]) => ({x:c.x+dx,y:c.y+dy})))
          .find(c => allowed.has(key(c.x,c.y)) && fits(g,passenger,c.x,c.y,passenger.angle,false,seat) &&
            hangars.of(carrier).some(h => hangars.canEmbark(g,{...passenger,...c},carrier,h.id)));
        if (!destination) continue;
        deploy(g,seat,passenger.id,destination.x,destination.y);
        const h = hangars.of(carrier).find(h => hangars.canEmbark(g,passenger,carrier,h.id));
        hangars.embark(g,passenger,carrier,h.id);
      }
    }
    for (const unit of controlled.filter(u => squadEligible(u) && !u.embarked)) {
      if (squadMembers(g,unit).length > 1) continue;
      const target = controlled.filter(other => other !== unit && !other.embarked && squadEligible(other) &&
          squadJoinTarget(g,unit,other.x,other.y,[unit]) === other)
        .sort((a,b) => Number(b.model === unit.model)-Number(a.model === unit.model) || dist(unit,a)-dist(unit,b))[0];
      if (target && deploymentCells(g,seat,unit).some(c => c.x === target.x && c.y === target.y))
        deploy(g,seat,unit.id,target.x,target.y);
    }
  }
  function confirmDeployment(g, team) {
    if (g.units.some((u) => u.pendingMove?.seat === team)) throw Error("请先确认或取消移动");
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再次确认");
    const controlled = g.units.filter((u) =>
      g.campaignBattlefield
        ? campaignBattlefield.deploymentSeat(g, u) === team
        : ownerOf(u) === team,
    );
    for (const u of controlled.filter(
      (u) => onMap(u) && !u.embarked && (!g.campaignBattlefield || u.campaignDeploying),
    )) {
      if (!deploymentCells(g, team, u).some((c) => c.x === u.x && c.y === u.y))
        throw Error("单位不在有效部署区域");
      if (!fits(g, u, u.x, u.y, u.angle, false, team)) throw Error("部署位置重叠");
    }
    for (const unit of controlled) delete unit.campaignDeploying;
    g.deployment[team] = true;
    return g.deployment.every(Boolean);
  }
  const terrain = {
    plain: { name: "平地", cost: 1, cover: 0, color: "#243b3d" },
    snow: { name: "雪地", cost: 1, cover: 0, color: "#d7e5ee" },
    desert: { name: "沙漠", cost: 1, cover: 0, color: "#c5a86d" },
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
    cellEnvironment,
    environmentOf,
    pilots,
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
      effect: Math.max(0, 0.1 + steps * 0.025),
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
  // A squad shares one simulation cell; presentation offsets never change range or sight.
  function squadMembers(g, unit) {
    if (!unit?.squadId) return unit ? [unit] : [];
    return g.units
      .filter(
        (other) =>
          onMap(other) &&
          !other.embarked &&
          other.squadId === unit.squadId &&
          other.team === unit.team &&
          controllerOf(g, other) === controllerOf(g, unit) &&
          other.x === unit.x &&
          other.y === unit.y,
      )
      .sort((a, b) => (a.squadSlot ?? 0) - (b.squadSlot ?? 0) || a.id.localeCompare(b.id));
  }
  function squadCapacity(unit, g = null) {
    const model = modelOf(unit);
    const sfsHangars = new Set((model.hangars || []).filter(h => h.kind === "sfs").map(h => h.id));
    if (!sfsHangars.size) return Math.max(1, model.transport?.slotCost || 1);
    // Squad points are independent of the SFS hull's ship-hangar footprint.
    return 1 + (g?.units || []).filter(passenger => passenger.hp > 0 &&
      passenger.embarked?.carrierId === unit.id && sfsHangars.has(passenger.embarked.hangarId))
      .reduce((sum, passenger) => sum + Math.max(1, modelOf(passenger).transport?.slotCost || 1), 0);
  }
  function squadAttackMembers(g, unit) {
    const root = unit?.embarked?.exposed
      ? g.units.find(other => other.id === unit.embarked.carrierId) || unit : unit;
    const members = squadMembers(g, root);
    const carriers = new Set(members.map(other => other.id));
    return [...members, ...g.units.filter(other =>
      other.hp > 0 && other.embarked?.exposed && carriers.has(other.embarked.carrierId) &&
      other.team === root.team && controllerOf(g, other) === controllerOf(g, root))];
  }
  function squadFits(members, g = null) {
    if (members.length > 6) return false;
    const costs = members.map(u => squadCapacity(u, g));
    // A two-MS SFS is a five-point formation that must operate alone.
    if (members.length > 1 && members.some((u, i) => costs[i] >= 5 &&
      (modelOf(u).hangars || []).some(h => h.kind === "sfs"))) return false;
    return costs.reduce((sum, cost) => sum + cost, 0) <= 6;
  }
  const squadEvasion = (g, unit) => squadEligible(unit) ? Math.round(12 * (6-Math.min(6,squadMembers(g,unit).length))/5) : 0;
  function squadTarget(g, candidates) {
    return candidates.length ? candidates[Math.floor(random(g)*candidates.length)] : null;
  }
  function squadEligible(unit) {
    const size = dimensions(unit),
      model = modelOf(unit);
    return (
      onMap(unit) &&
      !unit.embarked &&
      !unit.visualOnly &&
      !model.ship &&
      unitSize(model) !== "large" &&
      size.width === 1 &&
      size.height === 1 &&
      hangars.of(unit).every(hangar => hangar.kind === "sfs")
    );
  }
  function squadJoinTarget(g, unit, x, y, members = squadMembers(g, unit)) {
    const target = g.units.find(
      (other) =>
        onMap(other) && !other.embarked && !members.includes(other) && occupies(other, x, y),
    );
    if (
      !target ||
      !members.every(squadEligible) ||
      !squadEligible(target) ||
      target.team !== unit.team ||
      controllerOf(g, target) !== controllerOf(g, unit) ||
      environmentOf(g, target) !== environmentOf(g, unit) ||
      !!target.flying !== !!unit.flying
    )
      return null;
    const occupants = g.units.filter(
      (other) =>
        onMap(other) && !other.embarked && !members.includes(other) && occupies(other, x, y),
    );
    const destination = squadMembers(g, target);
    return squadFits([...members, ...destination], g) &&
      occupants.every((other) => destination.includes(other)) &&
      destination.every((other) => !other.pendingMove && other.attackSkillRound !== g.round)
      ? target
      : null;
  }
  function squadOffset(g, unit, facing = null, frameMembers = null) {
    if (!unit.squadId && !(frameMembers?.length > 1)) return { x: 0, y: 0, scale: 1 };
    const members = frameMembers || squadMembers(g, unit);
    const index = Math.max(
      0,
      members.findIndex((member) => member.id === unit.id),
    );
    if (members.length < 2) return { x: 0, y: 0, scale: 1 };
    // Compact triangles are presentation only; every member is equally targetable.
    const points = members.length === 2 ? [[-.22,0],[.22,0]]
      : members.length === 3 ? [[-.3,.12],[0,-.12],[.3,.12]]
      : [[0,-.28],[-.18,0],[.18,0],[-.36,.28],[0,.28],[.36,.28]];
    const [x,y] = points[index] || [0,0];
    const angle = ((facing ?? members[0].angle ?? 0) * Math.PI) / 180;
    return {
      x: x * Math.cos(angle) - y * Math.sin(angle),
      y: x * Math.sin(angle) + y * Math.cos(angle),
      scale: 1,
    };
  }
  function joinSquad(g, unit, target, members = [unit]) {
    if (squadJoinTarget(g, unit, target.x, target.y, members)?.id !== target.id)
      throw Error("该小队无法加入：成员、控制权或容量已变化");
    const destination = squadMembers(g, target).filter((other) => !members.includes(other));
    const id = target.squadId || "squad-" + target.id;
    [...destination,...members].forEach((other,index)=>{
      other.squadId=id;other.squadSlot=index;other.origin=null;
    });
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
            !(
              unit.squadId &&
              other.squadId === unit.squadId &&
              other.team === unit.team &&
              controllerOf(g, other) === controllerOf(g, unit) &&
              squadEligible(unit) &&
              squadEligible(other)
            ) &&
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
      !(models[unit.model]?.ship || models[unit.model]?.fixedWeaponFacing) ||
      ![-1, 1].includes(direction) ||
      !onMap(unit) ||
      unit.acted ||
      unit.plan ||
      unit.pendingMove
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
  function previewRotate(g, unit, direction, seat = ownerOf(unit)) {
    if (g.units.some((other) => other.pendingMove?.seat === seat))
      throw Error("请先确认或取消移动");
    if (!canRotate(g, unit, direction)) throw Error("旋转区域被占用或行动已使用");
    const pivot = unit.rotationPivot || center(unit);
    const angle = (((unit.angle + direction * 90) % 360) + 360) % 360;
    unit.pendingMove = {
      ...anchorAt(unit, pivot.x, pivot.y, angle),
      angle,
      seat,
      rotation: direction,
      from: { x: unit.x, y: unit.y },
      path: [],
    };
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
  function deploymentPlacements(world, formation, seat, staging = false) {
    // Campaign actors are constructed off-stage, then placed by campaign-room at
    // their actual arrival gate. Never alter ocean terrain just for construction.
    if (staging) world = { ...world, tiles: world.tiles.map(row => row.map(() => "plain")) };
    const placed = { ...world, units: [...(world.units || [])] },
      result = [],
      terrainCells = new Map();
    const entries = formation
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => !entry.preload)
      .sort((a, b) => {
        const size = (entry) => {
          const f = formationModel(entry).footprint;
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
        const cells = staging
          ? placed.tiles.flatMap((row, y) => row.map((_, x) => ({x, y})))
          : deploymentCells(placed, seat, probe);
        terrainCells.set(movement, { cells, area: new Set(cells.map((c) => key(c.x, c.y))) });
      }
      const available = terrainCells.get(movement);
      const stagingWorld = staging && models[model].movementType === "naval"
        ? {...placed, tiles:placed.tiles.map(row=>row.map(()=>"water"))} : placed;
      const position = available.cells.find((cell) =>
        fits(stagingWorld, probe, cell.x, cell.y, heading, false, seat, available.area),
      );
      if (!position) return null;
      placed.units.push({ ...probe, ...position });
      result.push({ entry, i, position, heading });
    }
    const placedIndices = new Map(result.map((item) => [item.i, item]));
    function placeCargo(i, visiting = new Set()) {
      if (placedIndices.has(i)) return placedIndices.get(i);
      const entry = formation[i];
      if (!entry?.preload || visiting.has(i)) return null;
      visiting.add(i);
      const carrier = placeCargo(entry.preload.carrierIndex, visiting);
      if (!carrier) return null;
      const item = { entry, i, position: { ...carrier.position }, heading: carrier.heading };
      placedIndices.set(i, item);
      result.push(item);
      return item;
    }
    for (let i = 0; i < formation.length; i++) if (!placeCargo(i)) return null;
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
    if (
      map.supportedModes &&
      !map.supportedModes.includes(
        settings.mode === "campaign" ? "regular" : settings.mode || "regular",
      )
    )
      throw Error("此地图不支持所选对战模式");
    if (formations.length !== map.spawns.length) throw Error("编组数量必须匹配地图席位");
    const rulesForSeat = (seat) =>
      (settings.mode !== "campaign" && settings.seatFormationRules?.[seat]) ||
      formationRestrictions({ ...settings, mapId: map.id }, seat);
    const tiles = map.tiles.map((row) => row.slice());
    let units = [];
    const sourceIndices = [];
    for (let seat = 0; seat < formations.length; seat++) {
      // null 明确表示空出生点，不生成单位，也无需确认部署。
      if (formations[seat] === null) continue;
      formations[seat] = validateFormation(
        formations[seat],
        settings.mode === "campaign" ? Infinity : (settings.seatCostLimits?.[seat] ?? costLimit),
        settings.mode === "campaign" ? Infinity : (settings.seatUnitLimits?.[seat] ?? unitLimit),
      );
      const seatRules = rulesForSeat(seat);
      const pilotBans = (seatRules.bannedFactions || []).filter(tag => tag.startsWith("pilot:"));
      const restrictedPilots = (seatRules.pilotPolicy && seatRules.pilotPolicy !== "allow") || pilotBans.length;
      const stockPlan = seatRules.licenses === undefined && !restrictedPilots ? null : planFormation(
        formations[seat], Infinity, {
          licenses: seatRules.licenses, inventory: seatRules.inventory, kits: seatRules.kits,
          ownedStock: seatRules.ownedStock,
          pilotPolicy: seatRules.pilotPolicy, bannedFactions: pilotBans,
        }, catalog.formation.maxUnits);
      sourceIndices[seat] = (stockPlan?.indices || formations[seat].map((_, i) => i)).map(
        (i) => settings.formationIndices?.[seat]?.[i] ?? i,
      );
      if (stockPlan) formations[seat] = stockPlan.deployable;
      const placements = deploymentPlacements(
        { tiles, units, mapId: map.id, environment: map.environment },
        formations[seat],
        seat,
        settings.mode === "campaign" && map.scope === "strategic",
      );
      if (!placements) throw Error("出生区没有足够位置容纳编组，请检查目录配置");
      placements.forEach(({ entry, i, position, heading }) => {
        if (restrictionReason(models[entry.unitId + "__" + entry.kitId], rulesForSeat(seat)))
          throw Error("编组包含不被允许的单位");
        if (
          rulesForSeat(seat).characterFaction &&
          !pilots.canAssign(entry.customPilot, rulesForSeat(seat).characterFaction)
        )
          throw Error("ACE驾驶员与编组阵营不匹配");
        if (
          formationModel(entry).requiredPilotId &&
          formationModel(entry).requiredPilotId !== entry.customPilot?.aceId
        )
          throw Error("该机体需要配属对应ACE驾驶员");
        const team = seatTeam(seat);
        const model = formationModelId(entry);
        const performance = settings.performances?.[seat] ?? 1;
        if (!strengthPercentages.some((percent) => percent / 100 === performance))
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
          deploymentUnitId: entry.unitId,
          deploymentModel: entry.unitId + "__" + entry.kitId,
          pilot,
          formationIndex: sourceIndices[seat]?.[i] ?? i,
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
  // Approaching an enemy costs ordinary terrain movement; leaving its control zone costs at least three.
  function terrainCost(g, u, x, y) {
    const movement = modelOf(u).movementType;
    const tile = g.tiles[y][x];
    if (cellEnvironment(g, x, y) !== "space") {
      if (movement === "air") return 1;
      if (movement === "naval") return tile === "water" ? 1 : Infinity;
      if (tile === "water") {
        if (movement === "hover") return 1;
        return (models[u.model].adaptability?.water ?? 0) > 0 ? 1 : Infinity;
      }
    }
    return terrain[g.tiles[y][x]].cost;
  }
  function movementCost(g, u, x, y, leavingEnemyControl = false) {
    const base = terrainCost(g, u, x, y);
    const cost = leavingEnemyControl ? Math.max(base, 3) : base;
    return cost / (campaignBattlefield.onSupply(g, u, x, y) ? 1.25 : 1);
  }
  // 按地形消耗搜索可达格子，同时保存各格子的移动路径。
  function reachableSingle(g, u, starts = null) {
    if (!onMap(u) || u.embarked) return new Map();
    const startAdaptation = adaptationOf(g, u);
    const moveLimit = startAdaptation > 0 ? modelOf(u, g).move / startAdaptation : modelOf(u).move;
    // A search does not mutate the board. Evaluate each destination's expensive
    // collision/terrain/ZOC checks once, even when reached from several edges.
    const stepCosts = new Map();
    const enemyControl = new Set();
    for (const enemy of g.units.filter((enemy) => onMap(enemy) && enemy.team !== u.team))
      for (const cell of cells(enemy))
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]])
          enemyControl.add(key(cell.x + dx, cell.y + dy));
    function stepCost(x, y, leavingEnemyControl) {
      const id = key(x, y) + ":" + Number(leavingEnemyControl);
      if (!stepCosts.has(id))
        stepCosts.set(
          id,
          fits(g, u, x, y, u.angle, true)
            ? Math.max(
                ...cells(u, x, y).map(
                  (c) => movementCost(g, u, c.x, c.y, leavingEnemyControl) / (adaptationOf(g, u, c.x, c.y) || 0),
                ),
              )
            : Infinity,
        );
      return stepCosts.get(id);
    }
    const initial = starts || [{ x: u.x, y: u.y, cost: 0, path: [] }];
    let best = new Map(initial.filter((p) => p.cost <= moveLimit).map((p) => [key(p.x, p.y), p])),
      queue = [];
    let sequence = 0;
    const earlier = (a, b) => a.node.cost < b.node.cost ||
      (a.node.cost === b.node.cost && a.order < b.order);
    function push(node) {
      const entry = { node, order: sequence++ };
      let index = queue.length;
      queue.push(entry);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!earlier(entry, queue[parent])) break;
        queue[index] = queue[parent];
        index = parent;
      }
      queue[index] = entry;
    }
    function pop() {
      const first = queue[0].node;
      const last = queue.pop();
      if (queue.length) {
        let index = 0;
        while (index * 2 + 1 < queue.length) {
          let child = index * 2 + 1;
          if (child + 1 < queue.length && earlier(queue[child + 1], queue[child])) child++;
          if (!earlier(queue[child], last)) break;
          queue[index] = queue[child];
          index = child;
        }
        queue[index] = last;
      }
      return first;
    }
    for (const node of best.values()) push(node);
    while (queue.length) {
      let n = pop();
      if (n.cost !== best.get(key(n.x, n.y)).cost) continue;
      const leavingEnemyControl = cells(u, n.x, n.y).some((cell) => enemyControl.has(key(cell.x, cell.y)));
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let x = n.x + dx,
          y = n.y + dy;
        if (x < 0 || x >= mapWidth(g) || y < 0 || y >= mapHeight(g)) continue;
        let cost = n.cost + stepCost(x, y, leavingEnemyControl);
        if (cost > moveLimit) continue;
        let k = key(x, y);
        if (best.has(k) && best.get(k).cost <= cost) continue;
        let entry = { x, y, cost, path: [...n.path, { x, y }] };
        best.set(k, entry);
        push(entry);
      }
    }
    // 友军可作为路径中间点，但不能作为移动终点。
    for (const [cell, entry] of best) {
      if (!fits(g, u, entry.x, entry.y)) {
        const target = squadJoinTarget(g, u, entry.x, entry.y, [u]);
        if (target) entry.squadTarget = target.id;
        else best.delete(cell);
      }
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
  function reachable(g, unit, starts = null, single = false) {
    const members = single || starts ? [unit] : squadMembers(g, unit);
    const result = reachableSingle(g, unit, starts);
    if (members.length < 2) return result;
    if (members.some((other) => other.moved || other.acted || other.plan || other.pendingMove))
      return new Map();
    const routes = members.map((other) => other === unit ? result : reachableSingle(g, other));
    for (const [cell, route] of result) {
      const occupied = g.units.some(
        (other) =>
          onMap(other) &&
          !other.embarked &&
          !members.includes(other) &&
          occupies(other, route.x, route.y),
      );
      if (route.boarding) {
        const carrier = g.units.find((c) => c.id === route.boarding.carrierId);
        const walks = routes.map((walk) => walk.get(cell));
        const plan = walks.every((walk) => walk?.boarding?.carrierId === carrier?.id)
          ? hangars.boardingPlan(g, members.map((member, i) => ({
              ...member, ...walks[i].boarding.approach, pendingMove: undefined,
            })), carrier)
          : null;
        if (!plan) result.delete(cell);
        else route.squadBoarding = plan;
        continue;
      }
      if (
        routes.some((walk) => !walk.has(cell) || walk.get(cell).boarding) ||
        (occupied && !squadJoinTarget(g, unit, route.x, route.y, members))
      )
        result.delete(cell);
    }
    return result;
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
      if (!models[unit.model]?.ship && !models[unit.model]?.fixedWeaponFacing) unit.angle = angle;
    }
  }
  function moveSingle(g, u, x, y, suppliedTile = null) {
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
    let tile = suppliedTile || reachableSingle(g, u).get(key(x, y));
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
    const direction = { ...from, model: undefined };
    faceTarget(direction, { x, y });
    if (!models[u.model]?.ship) u.angle = direction.angle;
    u.x = x;
    u.y = y;
    delete u.rotationPivot;
    u.moved = true;
    hangars.sync(g);
    return tile.path;
  }
  function move(g, unit, x, y, single = false) {
    const members = single ? [unit] : squadMembers(g, unit);
    const destination = reachable(g, unit, null, single).get(key(x, y));
    if (!destination) throw Error("小队成员无法一同到达该位置");
    const routes = members.map((other) => other === unit ? destination : reachableSingle(g, other).get(key(x, y)));
    for (const [index, route] of routes.entries()) {
      const reservation = destination.squadBoarding?.find((item) => item.unitId === members[index].id);
      if (reservation) route.boarding = { ...route.boarding, hangarId: reservation.hangarId };
    }
    if (
      members.some(
        (other) => !onMap(other) || other.moved || other.acted || other.pendingMove || other.plan,
      )
    )
      throw Error("小队中存在无法移动的单位");
    const target = squadJoinTarget(g, unit, x, y, members);
    members.forEach((other, index) => moveSingle(g, other, x, y, routes[index]));
    if (single) {
      delete unit.squadId;
      delete unit.squadSlot;
    }
    if (target) {
      joinSquad(g, unit, target, members);
    } else if (members.length > 1) members.forEach((other) => (other.origin = null));
    return routes[members.indexOf(unit)].path;
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
  function previewMove(g, u, x, y, seat = ownerOf(u), single = false) {
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
    const tile = reachable(g, u, null, single).get(key(x, y));
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
      single,
      squadIds: (single ? [u] : squadMembers(g, u)).map((other) => other.id),
      squadPaths: Object.fromEntries(
        (single ? [u] : squadMembers(g, u)).map((other) => [
          other.id,
          other === u ? tile.path : reachableSingle(g, other).get(key(x, y))?.path || tile.path,
        ]),
      ),
      ...(tile.boarding ? { boarding: tile.boarding } : {}),
    };
    return tile.path;
  }
  function confirmMove(g, u) {
    const pending = u.pendingMove;
    if (!pending) throw Error("没有待确认的移动");
    if (pending.launchMemberOf) throw Error("请确认整个出击小队");
    const launchMembers = (pending.squadLaunchIds || [u.id]).map(id => g.units.find(actor => actor.id === id));
    for (const actor of launchMembers) delete actor.pendingMove;
    try {
      if (pending.rotation) {
        rotate(g, u, pending.rotation);
        u.origin = null;
        return [];
      }
      if (pending.boarding) {
        const route = reachable(g, u, null, pending.single === true).get(key(pending.x, pending.y));
        if (
          route?.boarding?.carrierId !== pending.boarding.carrierId ||
          route.boarding.hangarId !== pending.boarding.hangarId
        )
          throw Error("搭载目标或容量已变化，请取消后重新选择");
      }
      const path = pending.launch
        ? (pending.squadLaunchIds ? hangars.launchSquad(g, launchMembers, pending.x, pending.y) : hangars.launch(g, u, pending.x, pending.y)).path
        : move(g, u, pending.x, pending.y, pending.single === true);
      u.origin = null;
      return path;
    } catch (error) {
      u.pendingMove = pending;
      for (const actor of launchMembers.slice(1)) actor.pendingMove = {
        x: pending.x, y: pending.y, seat: pending.seat, launch: true, launchMemberOf: u.id,
      };
      throw error;
    }
  }
  function cancelMove(g, u) {
    if (!u.pendingMove) throw Error("没有待取消的移动");
    if (u.pendingMove.launchMemberOf) return cancelMove(g, g.units.find(actor => actor.id === u.pendingMove.launchMemberOf));
    const ids = u.pendingMove.squadLaunchIds || [u.id];
    for (const id of ids) delete g.units.find(actor => actor.id === id).pendingMove;
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
    return firingArcCanBear(unit, module, target);
  }
  function firingArcCanBear(unit, firingArc, target) {
    if (!firingArc || !target) return true;
    const a = center(unit),
      b = target.aimCell ?? center(target),
      aim = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
    const delta = ((((aim - (unit.angle ?? 0) - firingArc.idleDir + 180) % 360) + 360) % 360) - 180;
    return Math.abs(delta) <= firingArc.arc + 1e-9;
  }
  function availableStrikes(u, w, target = null) {
    if (parts.unavailable(u, w).length) return [];
    return w.attack.strikes.filter(
      (step) =>
        !parts.unavailable(u, step).length &&
        moduleCanBear(u, step.moduleId, w.aimCell ?? target) &&
        firingArcCanBear(u, step.firingArc, w.aimCell ?? target),
    );
  }
  function attackOrders(unit) {
    return unit.plan ? unit.plan.attacks || [unit.plan] : [];
  }
  function attackPlanFor(unit, target) {
    return attackOrders(unit).find((order) => order.target === target?.id);
  }
  function attackResources(unit, target) {
    const others = attackOrders(unit).filter((order) => order.target !== target?.id);
    const weapons = others.flatMap((order) =>
      (order.weapons || [order.weapon])
        .map((id) => modelOf(unit).weapons.find((weapon) => weapon.id === id))
        .filter(Boolean),
    );
    return {
      en: unit.en - weapons.reduce((sum, weapon) => sum + weaponStats(weapon, unit).en, 0),
      weapons,
    };
  }
  // A volley against a large unit must share one legal impact cell, including turret arcs.
  function attackAimCell(g, u, target, weapons) {
    if (!target || target.groundTarget || !weapons?.length || weapons.some((w) => !w)) return null;
    const fixed = target.aimCell ?? weapons[0].aimCell;
    return (
      (fixed ? [fixed] : cells(target)).find((cell) =>
        weapons.every((w) =>
          canAttack(g, u, { ...target, aimCell: cell }, { ...w, aimCell: cell }),
        ),
      ) ?? null
    );
  }
  function attackQueue(g, u, target, weapons) {
    if (!Array.isArray(weapons) || !weapons.length || weapons.length > 32)
      throw Error("请选择有效的武器序列");
    if (weapons.some((w) => !w || !canAttack(g, u, target, w)))
      throw Error("武器、目标、射程或部位条件不满足");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    if (!target.groundTarget && !attackAimCell(g, u, target, weapons))
      throw Error("没有所有所选武器均可攻击的目标格");
    const budget = attackResources(u, target);
    const allWeapons = [...budget.weapons, ...weapons];
    validatePilotWeaponQueue(u, allWeapons);
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
    const en = weapons.reduce((n, w) => n + weaponStats(w, u).en, 0);
    if (en > budget.en) throw Error("武器序列总EN不足");
    return { en };
  }
  function counterQueue(g, u, target, weapons) {
    if (!Array.isArray(weapons) || !weapons.length || weapons.length > 32)
      throw Error("请选择有效的反击武器序列");
    if (weapons.some((w) => !w || !canCounter(g, u, target, w)))
      throw Error("反击次数已用完，或武器不满足射程与 EN 条件");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    validatePilotWeaponQueue(u, weapons);
    const en = weapons.reduce((n, w) => n + weaponStats(w, u).en, 0);

    if (en > u.en) throw Error("反击武器序列总EN不足");
    return { en };
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
      weapons.length > 32
    )
      throw Error("反击行动点不足");
    if (weapons.reduce((sum, w) => sum + weaponStats(w, unit).en, 0) > unit.en)
      throw Error("反击武器序列总EN不足");
    if (weapons.some((w) => w.slot === "skill") && weapons.length !== 1)
      throw Error("技能武器须独立使用");
    validatePilotWeaponQueue(unit, weapons);
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
  function validatePilotWeaponQueue(unit, weapons) {
    const counts = new Map();
    for (const weapon of weapons) {
      if (weapon.turnUseContinuation) continue;
      const count = (counts.get(weapon.id) || 0) + 1;
      counts.set(weapon.id, count);
      if (Number.isInteger(weapon.maxUsesPerTurn) &&
          (unit.weaponTurnUses?.[weapon.id] || 0) + count > weapon.maxUsesPerTurn)
        throw Error("武器超过本回合使用次数上限");
      if (weapon.pilotRequirements?.length && (unit.pilotWeaponTurnUses?.[weapon.id] || 0) + count > 1)
        throw Error("驾驶员条件武装每回合只能使用一次");
    }
  }
  function recordPilotWeaponUse(unit, weapon) {
    if (weapon.pilotRequirements?.length && !weapon.turnUseContinuation)
      (unit.pilotWeaponTurnUses ||= {})[weapon.id] = 1;
  }
  function canUse(u, w) {
    return (
      !!w &&
      pilotWeaponAllowed(u, w) &&
      (!w.pilotRequirements?.length || w.turnUseContinuation || !u.pilotWeaponTurnUses?.[w.id]) &&
      (!Number.isInteger(w.maxUsesPerTurn) || w.turnUseContinuation || (u.weaponTurnUses?.[w.id] || 0) < w.maxUsesPerTurn) &&
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
  function blastContains(impact, unit, radius, shape = "circle") {
    return cells(unit).some((cell) =>
      shape === "cross"
        ? Math.abs(cell.x - impact.x) + Math.abs(cell.y - impact.y) <= radius
        : (cell.x - impact.x) ** 2 + (cell.y - impact.y) ** 2 <= radius ** 2,
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
    if (a?.attackSkillRound === g.round && w?.slot !== "skill") return false;
    if (a && w && w.slot !== "skill" && !w.turnUseContinuation && !automaticFire.roundCount(Tactics, g, a, w)) return false;
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
        ["mortar", "nuke", "blast"].includes(w?.special?.type) &&
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
      (w.blastCenter
        ? blastContains(w.blastCenter, b, w.special.radius, w.special.shape)
        : inRange(a, b, w)) &&
      availableStrikes(a, w, b).length > 0
    );
  }
  // Scatter records carry only shot indices and energy actually paid; clients rebuild the same visual slice.
  function eventWeapon(unit, event) {
    let weapon = baseEventWeapon(unit, event);
    if (weapon && (event.turnUseContinuation || event.freeFollowup))
      weapon = { ...weapon, turnUseContinuation: true };
    return weapon && event.aimCell ? { ...weapon, aimCell: event.aimCell } : weapon;
  }
  function baseEventWeapon(unit, event) {
    let weapon = modelOf(
      event.model && models[event.model] ? { ...unit, model: event.model } : unit,
    ).weapons.find((w) => w.id === event.weapon);
    // Only server-expanded impact events carry a blast centre; launch requests still check range.
    if (["nuke", "blast"].includes(weapon?.special?.type) && event.impactCell)
      weapon = {
        ...weapon,
        blastCenter: event.impactCell,
        ...(event.energySpent !== undefined
          ? { en: event.energySpent, energySpent: event.energySpent }
          : {}),
      };
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
    return (modelOf(u).counterLimit ?? 1) > 0
      ? 1 : 0;
  }
  // A squad is the combat target, including members without their own incoming volley.
  // Preserve real incoming records first (notably their no-counter restrictions).
  function counterTargetEntries(g, request) {
    const attacks = request.attacks || request.counterTargets || [request];
    const entries = new Map(attacks.map((attack) => [attack.attacker, attack]));
    for (const attack of attacks) {
      const attacker = g.units.find((unit) => unit.id === attack.attacker);
      if (!attacker) continue;
      for (const member of squadMembers(g, attacker))
        if (!entries.has(member.id)) entries.set(member.id, { ...attack, attacker: member.id });
    }
    return [...entries.values()];
  }
  function canCounter(g, a, b, w) {
    return (
      !!a &&
      !!w &&
      !w.noCounter &&
      countersRemaining(a) > 0 &&
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
      reactionPenalty =
        ((defender.mobility / (defender.pilotModifiers?.reaction ?? 1)) *
          (response === "evade" ? 1.25 : 1) -
          100) *
        0.1875,
      sizeModifier = (w.attack.strikes.length === 1 ? w.attack.strikes[0].antiSize : null)?.[
        unitSize(defender)
      ] ||
        w.antiSize?.[unitSize(defender)] || { damage: 1, accuracy: 1 },
      targetFactor = targetModifier(
        g,
        b,
        w.attack.strikes.length === 1 && w.attack.strikes[0].targetModifiers
          ? { ...w, targetModifiers: w.attack.strikes[0].targetModifiers }
          : w,
      ),
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
              reactionPenalty,
          ),
        ) * (isCounter ? 0.75 : 1),
      // 最终回避加成在机动性、地形与反击惩罚计算后生效。
      // Compare accuracy and evasion on the same probability. Do not cap the
      // attacker's result before the defender's multipliers have been applied.
      rawHit =
        Math.max(0, baseHit - (response === "evade" ? 15 : 0)) *
        (w.hitScale || 1) *
        (attacker.pilotModifiers?.accuracy ?? 1) *
        (1 + attackCommand.communication),
      pilotEvasionHit =
        rawHit / ((defender.pilotModifiers?.reaction ?? 1) * (1 + defenseCommand.communication)),
      particleDefense = minovskyAt(g, b),
      // Preserve Minovsky's extra miss chance, without turning a negative miss
      // chance into an accuracy bonus when the uncapped result exceeds 100%.
      particleEvasionHit = particleDefense
        ? pilotEvasionHit - Math.max(0, 100 - pilotEvasionHit) * 0.25
        : pilotEvasionHit,
      hit = Math.max(
        0,
        Math.min(
          100,
          particleEvasionHit *
            (particleDefense && (w.category === "missile" || w.special?.type === "mortar")
              ? 0.75
              : 1) *
            sensorFactor *
            (w.type !== "melee" && smokeAt(g, b) ? 0.75 : 1) +
            (attacker.pilotModifiers?.awakeningHit ?? 0),
        ) -
          (defender.pilotModifiers?.awakeningEvasion ?? 0) - squadEvasion(g, b),
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
              share -
              defenses[flatKey].flat * defenseMultiplier,
          ) *
          (1 -
            Math.min(100, defenses[percentKey].percent * defenseMultiplier *
              (ap ? 1 - (w.armorPiercingIgnore ?? catalog.conversionRules.weapons.armorPiercingIgnore) : 1)) /
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
      damage += roundDamage(
        protectedDamage(defender.defenses, multiplier, 1, fieldLeft > 0, normal),
      );
      fieldLeft = Math.max(floor, fieldLeft - roundDamage(normal.absorbed));
      const active = blockedFieldLeft > 0,
        coverage = shieldLeft > 0 ? defender.shield.coverage : 0;
      const required =
        coverage > 0
          ? roundDamage(protectedDamage(defender.shield.defenses, multiplier, coverage, active))
          : 0;
      const absorbedShare = coverage * (required > 0 ? Math.min(1, shieldLeft / required) : 1);
      const loss = Math.min(shieldLeft, required);
      shieldDamage += loss;
      shieldLeft -= loss;
      blockedDamage += roundDamage(
        protectedDamage(defender.defenses, multiplier, 1 - absorbedShare, active),
      );
      if (active) protectedDamage(defender.defenses, multiplier, 1, active, blocked);
      blockedFieldLeft = Math.max(floor, blockedFieldLeft - roundDamage(blocked.absorbed));
    }
    return {
      hit: Math.round(hit),
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
    recordPilotWeaponUse(u, w);
    if (Number.isInteger(w.maxUsesPerTurn) && !w.turnUseContinuation)
      (u.weaponTurnUses ||= {})[w.id] = (u.weaponTurnUses[w.id] || 0) + 1;
    if (Number.isInteger(w.maxUses)) (u.weaponUses ||= {})[w.id] = (u.weaponUses[w.id] || 0) + 1;
    if (w.changeHeldWeapon !== false) u.heldWeapon = w.id;
    const finalDisplay = w.attack.displayStates?.at(-1)?.index;
    if (finalDisplay !== undefined || w.changeHeldWeapon !== false)
      u.weaponDisplayIndex = finalDisplay ?? w.displayIndex ?? 0;
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
    counterProgress = null,
    options = {},
  ) {
    if (
      !options.launched &&
      (g.winner !== null ||
        (!counterOnly && (a.team !== g.team || a.acted || !canAttack(g, a, b, w))))
    )
      throw Error("攻击条件已失效");
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    const counterIds = Array.isArray(counterId) ? counterId : [counterId];
    if (counterOnly && counterOrders) {
      const validationUnit = counterProgress?.started
        ? {
            ...b,
            counterCount: counterProgress.initialCount,
            counterTargetId: counterProgress.initialTarget,
          }
        : b;
      counterPlan(g, validationUnit, counterOrders);
    } else if (response === "counter" && allowCounter)
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
      if (!options.launched) spend(from, weapon);
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
            moduleCanBear(from, step.moduleId, weapon.aimCell ?? to) &&
            firingArcCanBear(from, step.firingArc, weapon.aimCell ?? to),
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
            lastTickRound: to.burning?.lastTickRound,
          };
        const wasOverdrive = !!to.overdrive;
        const formReverted = skills.revertDamaged(to);
        const overdriveEnded = wasOverdrive && !to.overdrive;
        let dodgeTo = null;
        if (executed && !hit) {
          dodgeTo = dodgeSlots[to.id] === 0 ? dodgeSide() : -dodgeSlots[to.id];
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
        hitChance: strikes[0]?.hitChance,
        response: stance,
      });
    }
    if (!counterOnly) fire(a, b, w, response, !!options.isCounter);
    if (response === "counter" && allowCounter && b.hp > 0 && a.hp > 0) {
      let started = counterProgress?.started ?? false;
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
          !canAttack(g, b, enemy, weapon)
        )
          continue;
        if (!started) {
          b.counterCount = (b.counterCount ?? 0) + 1;
          if (!counterOrders || new Set(counterOrders.map((order) => order.targetId)).size === 1)
            b.counterTargetId = enemy.id;
          started = true;
        }
        if (weapon.special?.type === "blast") {
          const impact = attackCells(b, enemy, weapon)[0] || { x: enemy.x, y: enemy.y };
          const victims = g.units.filter(
            (unit) =>
              unit.team !== b.team &&
              onMap(unit) &&
              blastContains(impact, unit, weapon.special.radius, weapon.special.shape),
          );
          const blastId = `counter:${g.round}:${b.id}:${counterProgress?.sequence ?? 0}:${events.length}`;
          const launchEnergy = weaponStats(weapon, b).en;
          victims.forEach((victim, index) => {
            const energySpent = index ? 0 : launchEnergy;
            fire(
              b,
              victim,
              {
                ...weapon,
                en: energySpent,
                energySpent,
                turnUseContinuation: index > 0,
                maxUses: index ? undefined : weapon.maxUses,
                blastCenter: impact,
              },
              "counter",
              true,
            );
            Object.assign(events.at(-1), { impactCell: impact, blastId, energySpent });
          });
        } else fire(b, enemy, weapon, "counter", true);
        if (counterProgress) counterProgress.sequence = (counterProgress.sequence ?? 0) + 1;
      }
      if (counterProgress) Object.assign(counterProgress, { started });
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
    if (!options.deferVictory && (!alive[0] || !alive[1])) g.winner = alive[0] ? 0 : 1;
    return events;
  }
  // Counter waves share reaction state across the entire batch; EN is checked per shot.
  function counter(g, defender, attacker, weaponIds, orders = null, progress = null) {
    return fight(g, attacker, defender, null, "counter", weaponIds, true, true, orders, progress);
  }
  function wait(g, u, single = false) {
    if (!onMap(u) || g.winner !== null || u.team !== g.team || u.acted) throw Error("无法待机");
    for (const member of single ? [u] : squadMembers(g, u)) {
      member.acted = true;
      member.origin = null;
    }
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
      fireSound: skill.fireSound,
      beamWidth: skill.beamWidth,
      beamSections: skill.beamSections,
      beamLength: skill.beamLength,
      chargeScale: skill.chargeScale,
      chargeMuzzle: skill.chargeMuzzle,
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
    return null;
  }
  function tickBurning(g) {
    if (g.winner !== null) return [];
    const events = [];
    for (const u of g.units) {
      const burn = u.burning;
      if (!burn) continue;
      if (u.hp <= 0 || burn.expiresRound <= g.round) {
        delete u.burning;
        continue;
      }
      if (u.team !== g.team || burn.lastTickRound === g.round) continue;
      burn.lastTickRound = g.round;
      const m = modelOf(u),
        resistance = Math.max(0, Math.min(100, m.defenses.sp?.percent || 0));
      const damage = Math.min(
        u.hp,
        roundDamage(((m.hp * burn.hpPercent) / 100) * (1 - resistance / 100)),
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
    g.turnEffects = tickBurning(g);
    for (const u of g.units) if (!u.overdrive) skills.revertDamaged(u);
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0 && u.overdrive)) {
      const active = u.overdrive,
        m = modelOf(u);
      const forced = !!u.brokenParts?.head;
      if (!forced) {
        if (!(active.skillId === "EXAM" && pilots.hasPassive(u, "Pilot_ExamPilot_Trigger")))
          u.hp = Math.max(
            active.skillId === "EXAM" ? 1 : 0,
            u.hp - roundDamage((m.hp * active.hpDrainPercent) / 100),
          );
        u.en = Math.max(0, u.en - (m.en * active.enDrainPercent) / 100);
        active.remaining--;
      }
      const expired = forced || active.remaining <= 0 || (active.skillId === "EXAM" && u.hp <= 1);
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
        const maximum = campaignModelOf(u).hp;
        u.hp = Math.max(0, u.hp - roundDamage((maximum * active.hpDrainPercent) / 100));
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
    skills.tickPilotBuffs(g);
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
      delete u.pilotWeaponTurnUses;
      delete u.weaponTurnUses;
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
        u.shield = Math.min(m.shield.hp, (u.shield || 0) + Math.round(m.shield.hp * 0.25));
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
      u.moved = false;
      u.origin = null;
    }
    campaignBattlefield.heal(Tactics, g);
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
      // Lock the target unit, not the tile it occupied when charging began.
      const lockedTarget =
        target && order.aimCell && occupies(target, order.aimCell.x, order.aimCell.y)
          ? { ...target, aimCell: order.aimCell }
          : target;
      const aimCell =
        weapon &&
        lockedTarget &&
        (attackAimCell(g, u, lockedTarget, [weapon]) || attackAimCell(g, u, target, [weapon]));
      if (aimCell) {
        u.readySnipe = { target: target.id, weapon: weapon.id, aimCell };
        u.plan = { ...u.readySnipe, charged: true };
        u.acted = true;
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
        (ownerSeat !== null && controllerOf(g, u) !== ownerSeat)
      )
        return false;
      if (u.embarked) return true;
      if (u.plan) return false;
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
    const pressure = new Map(), unitsById = new Map(g.units.map(unit => [unit.id, unit]));
    for (const attacker of g.units) {
      if (attacker.team !== team || !onMap(attacker)) continue;
      const orders = attackOrders(attacker);
      if (!orders.length) continue;
      const weaponsById = new Map(modelOf(attacker).weapons.map(weapon => [weapon.id, weapon]));
      for (const plan of orders) {
        const target = unitsById.get(plan.target);
        if (!target || !onMap(target) || target.team === team) continue;
        const commitment = pressure.get(target.id) || { damage: 0, attackers: 0 };
        let assigned = false;
        for (const id of plan.weapons || [plan.weapon]) {
          const weapon = weaponsById.get(id);
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
  // Assemble nearby idle units through the same move/join rules as a player.
  // Never retreat across the map or delay an available attack just to fill a squad.
  function aiSquadChoice(g, u, available = () => true) {
    const members = squadMembers(g, u);
    if (
      !members.every(squadEligible) ||
      (members.length >= 6 || members.reduce((sum,m)=>sum+squadCapacity(m,g),0) >= 6) ||
      members.some((m) => m.moved || m.acted || m.plan || m.pendingMove)
    )
      return null;
    const enemies = g.units.filter((e) => e.team !== u.team && onMap(e));
    const nearest = (point) =>
      enemies.length ? Math.min(...enemies.map((e) => dist(point, e))) : 0;
    const moveRange = modelOf(u).move, controller = controllerOf(g, u);
    const allowance = Math.max(1, moveRange * 0.25), currentNearest = nearest(u);
    const candidates = g.units.filter(
      (other) =>
        other !== u &&
        onMap(other) &&
        !other.embarked &&
        other.team === u.team &&
        controllerOf(g, other) === controller &&
        !other.acted && !other.plan && !other.pendingMove && available(other) &&
        dist(u, other) <= moveRange + 1 &&
        squadJoinTarget(g, u, other.x, other.y, members)?.id === other.id &&
        nearest(other) <= currentNearest + allowance,
    );
    if (!candidates.length) return null;
    if (
      members.some((m) => enemies.some((e) => automaticFire.queue(Tactics, g, m, e, false).length))
    )
      return null;
    const routes = reachable(g, u);
    let best = null;
    for (const other of candidates) {
      const route = routes.get(key(other.x, other.y));
      if (!route) continue;
      const destination = squadMembers(g, other);
      if (!destination.every((member) => !member.acted && !member.plan && !member.pendingMove && available(member))) continue;
      const same = destination.reduce((sum, member) => sum + members.filter(
        (source) => modelOf(source).prefabId === modelOf(member).prefabId).length, 0);
      const speeds = [...members, ...destination].map((member) => modelOf(member).move);
      const speedPenalty = Math.max(...speeds) - Math.min(...speeds);
      const score = same * 10 + destination.length * 2 - speedPenalty - route.cost * 0.1;
      if (!best || score > best.score) best = { ...route, score };
    }
    return best;
  }
  function aiChoice(g, u, destinations = null, collectCandidate = null) {
    let cells =
        destinations ??
        (u.moved ? [{ x: u.x, y: u.y, cost: 0, path: [] }] : [...reachable(g, u).values()]),
      enemies = g.units.filter((e) => e.team !== u.team && onMap(e)),
      best = null;
    const weapons = modelOf(u).weapons,
      pressure = aiTargetPressure(g, u.team),
      strategy = aiTactics.forUnit(Tactics, g, u, aiTactics.decide(Tactics, g, u)),
      positionScore = aiTactics.positionScorer(Tactics, g, u, strategy),
      cautious = ["gather", "defend"].includes(strategy.state);
    // AI navigation knows enemy positions even through fog. Keep actual sight
    // separate so this knowledge does not grant attacks against unseen targets.
    const decisionGame = {
      ...g,
      intel: {
        ...g.intel,
        team: u.team,
        visibleIds: enemies.filter((e) => sensors.visible(g, u.team, e)).map((e) => e.id),
      },
    };
    // Keep each AI player's mobile force together during the approach. Once
    // any member makes contact, combat positioning takes priority over waiting.
    if (!destinations && enemies.length && !u.moved) {
      const squad = g.units.filter(
        (ally) =>
          onMap(ally) &&
          ally.team === u.team &&
          controllerOf(g, ally) === controllerOf(g, u) &&
          modelOf(ally).move > 0 &&
          !ally.deployed &&
          !ally.embarked,
      );
      const nearestEnemy = (unit) => Math.min(...enemies.map((enemy) => dist(unit, enemy)));
      const contact = squad.some(
        (ally) =>
          nearestEnemy(ally) <=
          Math.max(
            6,
            ...modelOf(ally)
              .weapons.filter((w) => w.slot !== "skill")
              .map((w) => w.max),
          ),
      );
      if (squad.length > 1 && !contact) {
        const rearDistance = Math.max(...squad.map(nearestEnemy));
        // Cohesion can trim at most a quarter of this unit's reachable advance.
        // Round the retained distance up so short moves do not lose a whole extra cell.
        const currentDistance = nearestEnemy(u);
        const maximumAdvance = Math.max(
          0,
          ...cells.map((cell) => currentDistance - nearestEnemy({ ...u, x: cell.x, y: cell.y })),
        );
        const advanceLimit = Math.min(
          currentDistance - Math.ceil(maximumAdvance * 0.75),
          rearDistance - 4,
        );
        cells = cells.filter(
          (cell) => nearestEnemy({ ...u, x: cell.x, y: cell.y }) >= advanceLimit - 0.001,
        );
      }
    }
    if (!destinations && (models[u.model]?.ship || models[u.model]?.fixedWeaponFacing) && !u.moved)
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
      const tacticalScore = positionScore(c);
      let score = tacticalScore - c.cost * 0.025,
        target = null,
        weapon = null,
        assignedAttackers = Infinity;
      for (const e of enemies)
        for (const w of weapons)
          if (
            inRange(virtual, e, w) &&
            (!destinations || w.slot !== "skill") &&
            canAttack(decisionGame, virtual, e, w)
          ) {
            let ex = estimate(g, virtual, e, w),
              commitment = pressure.get(e.id),
              remaining = Math.max(0, e.hp - (commitment?.damage || 0)),
              expected = (ex.damage * ex.hit) / 100,
              s =
                tacticalScore +
                2 +
                Math.min(expected, remaining) / (cautious ? 4000 : 1000) +
                (remaining > 0 ? Math.min(1, expected / remaining) * 0.6 : 0) -
                c.cost * 0.025 -
                (destinations ? near * 0.12 : 0);
            if (expected > 0 && s > score) {
              score = s;
              target = e.id;
              weapon = w.id;
              assignedAttackers = commitment?.attackers || 0;
            }
          }
      if (collectCandidate) collectCandidate(c, { ...c, score, target, weapon, assignedAttackers });
      if (
        !best ||
        score > best.score ||
        (score === best.score && assignedAttackers < best.assignedAttackers)
      )
        best = { ...c, score, target, weapon, assignedAttackers };
    }
    if (!destinations && !u.moved && best && !best.target && strategy.goal &&
        ["advance", "flank", "overrun"].includes(strategy.state)) {
      const goal = strategy.goal;
      const distance = (point) => Math.hypot(point.x - goal.x, point.y - goal.y);
      if (distance(u) > 2 && distance(best) >= distance(u) - 0.5) {
        // Only run a full-board escape search when local scoring stalls. The
        // reverse field finds a way around walls instead of repeating the same
        // closest-to-enemy cell every turn. Actual moves still use reachable().
        const members = squadMembers(g, u), passable = new Map(), distances = new Map(), queue = [];
        const allowed = (x, y) => {
          const id = key(x, y);
          if (!passable.has(id)) passable.set(id, x >= 0 && y >= 0 && x < mapWidth(g) && y < mapHeight(g) &&
            members.every((member) => fits(g, member, x, y, member.angle, true) &&
              Tactics.cells(member, x, y).every((cell) => adaptationOf(g, member, cell.x, cell.y) > 0 &&
                Number.isFinite(movementCost(g, member, cell.x, cell.y)))));
          return passable.get(id);
        };
        for (let y = Math.round(goal.y) - 1; y <= Math.round(goal.y) + 1; y++)
          for (let x = Math.round(goal.x) - 1; x <= Math.round(goal.x) + 1; x++)
            if (allowed(x, y)) { distances.set(key(x, y), 0); queue.push({ x, y }); }
        for (let index = 0; index < queue.length; index++) {
          const point = queue[index];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = point.x + dx, y = point.y + dy, id = key(x, y);
            if (!distances.has(id) && allowed(x, y)) {
              distances.set(id, distances.get(key(point.x, point.y)) + 1);
              queue.push({ x, y });
            }
          }
        }
        const current = distances.get(key(u.x, u.y)) ?? Infinity;
        const detours = cells.filter((point) => !point.boarding && !point.rotation &&
          (distances.get(key(point.x, point.y)) ?? Infinity) < current);
        detours.sort((a, b) => distances.get(key(a.x, a.y)) - distances.get(key(b.x, b.y)) || a.cost - b.cost);
        if (detours.length) best = { ...best, ...detours[0], target: null, weapon: null };
      }
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
    };
    // Evaluate exits together. Reuse each result when adding squad-joining preference,
    // instead of rerunning enemy scans, pressure estimates and strategy per exit.
    const candidates = new Map();
    const best = aiChoice(g, passenger, destinations, (point, choice) => candidates.set(point, choice));
    // Prefer joining a nearby compatible squad on launch, without sacrificing
    // an available attack or marching back away from the engagement.
    const grouped = destinations.filter((point) => point.squadTarget);
    for (const point of grouped) {
      const target = g.units.find((member) => member.id === point.squadTarget);
      const candidate = candidates.get(point);
      if (!candidate || (best?.target && !candidate.target)) continue;
      const same = squadMembers(g, target).some((member) => modelOf(member).prefabId === modelOf(u).prefabId);
      const score = candidate.score + (same ? 1 : 0.35);
      if (best && score > best.score) Object.assign(best, candidate, { score });
    }
    return best;
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
    captureObjective: (g, unit, origin) => aiTactics.captureGoal(Tactics, g, unit, origin),
    squadMembers,
    squadEligible,
    squadFits,
    environmentOf,
    squadJoinTarget,
    joinSquad,
    deploymentCells,
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
    campaignBattlefield,
    aiTactics,
    W,
    getMap,
    mapWidth,
    mapHeight,
    columnLabel,
    seatTeam,
    ownerOf,
    controllerOf,
    canControlUnit,
    validateCostLimit,
    validateUnitLimit,
    validateUnitCostLimit,
    validateTagRestrictions,
    validatePilotPolicy,
    pilotTags,
    factionTags,
    validateTeamRestrictions,
    validateTeamFactions,
    validateFogMode,
    validateBattleMode,
    campaignRoomSettings,
    defaultRoomSettings,
    formationRestrictions,
    restrictionReason,
    normalizeLicenses,
    normalizeStock: economy.normalizeStock,
    stockPlan: economy.stockPlan,
    licensePlan,
    factions,
    eras,
    unitTags,
    maxCostLimit,
    movementCost,
    H,
    models,
    catalog,
    roundDamage,
    validateFormation,
    formationModel,
    formationModelId,
    formationWeight,
    formationPoints,
    pilots,
    pilotUnitName: (unit) =>
      (unit.pilot?.custom ? unit.pilot.name + "驾驶的" : "") + unitLogName(unit),
    normalizeUnitName,
    unitLogName,
    unitName,
    randomFormation,
    unitSkills: skills.of,
    canUseSkill: skills.canUse,
    skillTargets: skills.targets,
    useSkill: skills.use,
    cellEnvironment,
    environmentOf,
    adaptationOf,
    terrainCost,
    planFormation,
    validateArmySettings,
    armySettings,
    aiFormationVariation,
    armyBudget,
    armyUnitLimit,
    armyRestrictions,
    aiDefaults,
    aiCountPercentages,
    armyPercentages,
    strengthPercentages,
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
    squadMembers,
    squadAttackMembers,
    squadEligible,
    squadJoinTarget,
    squadOffset,
    squadCapacity,
    squadFits,
    squadEvasion,
    squadTarget,
    joinSquad,
    mapCellPixels: 160,
    fits,
    canRotate,
    rotate,
    previewRotate,
    deploymentCells,
    deploy,
    confirmDeployment,
    aiDeployment,
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
    automaticWeapons: (g, u, t, counter = false) =>
      automaticFire.weapons(Tactics, g, u, t, counter),
    automaticQueue: (g, u, t, counter = false) => automaticFire.queue(Tactics, g, u, t, counter),
    automaticSquadQueue: (g, u, t, counter = false) =>
      automaticFire.squadQueue(Tactics, g, u, t, counter),
    firePlan: (g, u, t, options = {}) => automaticFire.plan(Tactics, g, u, t, options),
    attackRounds: (g, u, w, counter = false) => automaticFire.roundCount(Tactics, g, u, w, counter),
    resolveAutomatic: (room, choices, id) => automaticFire.resolve(Tactics, room, choices, id),
    spendWeapon: spend,
    resolveProjectile: (g, source, target, weapon, response, isCounter = false) =>
      fight(g, source, target, weapon, response, [], false, false, null, null, {
        launched: true,
        deferVictory: true,
        isCounter,
      }),
    random,
    weaponCooldown,
    startWeaponCooldown,
    canUse,
    recordPilotWeaponUse,
    pilotWeaponAllowed,
    attackAimCell,
    attackQueue,
    attackOrders,
    attackPlanFor,
    attackResources,
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
    targetModifier,
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
    aiSquadChoice,
    counterTargetEntries,
    aiTargetPressure,
    aiLaunchChoice,
  };
})();
if (typeof module !== "undefined") module.exports = Tactics;
