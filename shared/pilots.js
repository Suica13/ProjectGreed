/* Pilot profiles are attachments, never battlefield units. Rolls are deterministic
 * from the private match seed and are stored in the authoritative unit state. */
"use strict";
const PilotSystem = (() => {
  const catalog = typeof PILOT_DATA !== "undefined" ? PILOT_DATA : require("./pilots.json");
  const byId = new Map(catalog.named.map((pilot) => [pilot.id, pilot]));
  const portraitsById = new Map(catalog.portraits.map((portrait) => [portrait.id, portrait]));
  function defaultPortrait(faction = "PMC") {
    return catalog.portraits.find((portrait) => portrait.faction === faction) || catalog.portraits[0];
  }
  const labels = {
    shooting: "射击", melee: "格斗", defense: "防御", speed: "机动",
    accuracy: "命中", reaction: "反应", leadership: "指挥", awakening: "觉醒",
  };
  function profile(id) {
    return id ? byId.get(id) || null : null;
  }
  const maxPortraitLength = 16384;
  function portraitData(value) {
    if (!value) return null;
    if (typeof value !== "string" || value.length > maxPortraitLength ||
        !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value))
      throw Error("驾驶员头像无效或过大");
    return value;
  }
  const growthRules = Object.freeze({ version: 4, initialPoints: 60, pointsPerLevel: 15, maxLevel: 10, initialStatCap: 125, statCapPerLevel: 10, statCap: 180 });
  const experienceRequired = (level) => 1000 * 2 ** (level - 1);
  const trainingVersion = growthRules.version;
  const trainingBudget = (level) => growthRules.initialPoints + (level - 1) * growthRules.pointsPerLevel;
  const statCap = level => Math.min(growthRules.statCap, growthRules.initialStatCap + (level - 1) * growthRules.statCapPerLevel);
  function baseStats() {
    return { shooting: 90, melee: 90, defense: 90, speed: 90,
      accuracy: 90, reaction: 90, leadership: 70, awakening: 50 };
  }
  function previousBase(key, value) {
    // Retain each released baseline when adding a new growth version.
    if (value.trainingVersion === 3 || value.trainingVersion === 4) return key === "awakening" ? 50 : key === "leadership" ? 70 : 90;
    if (value.trainingVersion === 2) return key === "awakening" ? 60 : key === "leadership" ? 80 : 100;
    if (value.role === undefined) return key === "awakening" ? 50 : 100;
    if (key === "awakening") return 60;
    if (key === "leadership") return value.role === "commander" ? 120 : 80;
    return value.role === "commander" ? 80 : 110;
  }
  function custom(value) {
    if (!value || typeof value !== "object" || !/^custom-[a-zA-Z0-9-]{1,80}$/.test(value.id || ""))
      throw Error("自建驾驶员无效");
    if (!Number.isInteger(value.level) || value.level < 1 || value.level > 1000) throw Error("驾驶员等级无效");
    const level = Math.min(value.level, growthRules.maxLevel);
    const name = typeof value.name === "string" ? value.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) : "";
    if (!name) throw Error("请输入驾驶员名称");
    const bases = baseStats();
    const oldVersion = value.trainingVersion ?? 1;
    if (!Number.isInteger(oldVersion) || oldVersion < 1 || oldVersion > trainingVersion) throw Error("驾驶员数据版本无效");
    if (oldVersion === trainingVersion && value.level > growthRules.maxLevel) throw Error("驾驶员等级无效");
    const reset = oldVersion < trainingVersion;
    const previousCap = oldVersion >= 4 ? Math.min(180, 125 + (value.level - 1) * 10) : 160;
    const maximum = reset ? previousCap : statCap(level);
    const stats = {};
    let spent = 0;
    for (const key of Object.keys(labels)) {
      const minimum = reset ? previousBase(key, value) : bases[key];
      const amount = value.stats?.[key];
      if (!Number.isInteger(amount) || amount < minimum || amount > maximum) throw Error("驾驶员属性无效");
      stats[key] = reset ? bases[key] : amount;
      spent += amount - minimum;
    }
    const previousBudget = oldVersion === 4 ? 60 + (value.level - 1) * 15
      : oldVersion === 3 ? 50 + (value.level - 1) * 20
      : (oldVersion === 2 ? 30 : 0) + (value.level - 1) * 10;
    if (spent > (reset ? previousBudget : trainingBudget(level))) throw Error("驾驶员强化点不足");
    const rawExperience = value.experience ?? 0;
    if (!Number.isSafeInteger(rawExperience) || rawExperience < 0 || rawExperience >= experienceRequired(value.level))
      throw Error("驾驶员经验无效");
    const experience = level === growthRules.maxLevel ? 0 : rawExperience;
    if (reset) spent = 0; // A growth-rule revision refunds every allocated point under the current budget.
    const record = {};
    for (const key of ["kills", "losses", "destroyedCost", "lostCost"]) {
      const n = value.record?.[key] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw Error("驾驶员战绩无效");
      record[key] = n;
    }
    const faction = value.faction ?? "PMC";
    if (!["PMC", "EFSF", "ZEON"].includes(faction)) throw Error("驾驶员阵营无效");
    const uploadedPortrait = portraitData(value.uploadedPortrait);
    const portraitId = portraitsById.has(value.portraitId) ? value.portraitId : defaultPortrait(faction)?.id;
    return { id: value.id, name, trainingVersion, faction, portraitId, ...(uploadedPortrait ? { uploadedPortrait } : {}), level, experience, stats, record, points: trainingBudget(level) - spent, custom: true };
  }
  function createCustom(id, name, portraitId, faction = "PMC") {
    return custom({ id, name, trainingVersion, portraitId, faction, level: 1, experience: 0, stats: baseStats() });
  }
  function gainExperience(value, amount) {
    const p = custom(value);
    if (!Number.isSafeInteger(amount) || amount < 0) throw Error("驾驶员经验奖励无效");
    if (p.level >= growthRules.maxLevel) return p;
    p.experience += amount;
    if (p.experience >= experienceRequired(p.level) && p.level < growthRules.maxLevel) {
      p.level++;
      p.experience = 0;
    }
    return custom(p);
  }
  function refundTraining(value) {
    const pilot = custom(value);
    return custom({ ...pilot, stats: baseStats() });
  }
  function battleResult(value, kind, unitCost, experiencePoints = unitCost) {
    if (!["kill", "loss", "assist"].includes(kind) || !Number.isSafeInteger(unitCost) || unitCost < 0)
      throw Error("驾驶员战绩结算无效");
    if (!Number.isSafeInteger(experiencePoints) || experiencePoints < 0) throw Error("驾驶员经验奖励无效");
    let p = custom(value);
    if (kind === "kill") {
      p.record.kills++;
      p.record.destroyedCost += unitCost;
      p = gainExperience(p, experiencePoints);
    } else if (kind === "assist") {
      p = gainExperience(p, experiencePoints);
    } else {
      p.record.losses++;
      p.record.lostCost += unitCost;
    }
    return custom(p);
  }
  function creditAwards(store, awards) {
    const received = new Set(store.awards);
    let changed = false;
    for (const award of awards) {
      if (received.has(award.id)) continue;
      const i = store.pilots.findIndex(p => p.id === award.pilotId && (!award.faction || p.faction === award.faction));
      if (i < 0) continue;
      store.pilots[i] = battleResult(store.pilots[i], award.kind, award.points, award.experiencePoints ?? award.points);
      received.add(award.id);
      changed = true;
    }
    if (changed) store.awards = [...received];
    return changed;
  }
  const portrait = (value) => value?.uploadedPortrait || portraitsById.get(value?.portraitId)?.icon || defaultPortrait(value?.faction)?.icon;
  const cost = (value) => value ? custom(value).level * 25 : 0;
  function commandUnit(model) {
    return !!(model?.unitTags?.includes("CmdUnit") ||
      model?.sourceStats?.nativeTags?.includes("CmdUnit"));
  }
  function defaultName(model) {
    return (model?.faction === "EFSF" ? "联邦" : model?.faction === "ZEON" ? "吉翁" : "") + (commandUnit(model) ? "默认指挥官" : "默认驾驶员");
  }
  function validate(id, model) {
    if (id === undefined || id === null || id === "") return null;
    if (typeof id !== "string" || !byId.has(id)) throw Error("驾驶员无效");
    if (model?.faction !== byId.get(id).faction) throw Error("驾驶员与单位阵营不匹配");
    if (commandUnit(model) && !byId.get(id).commander)
      throw Error("指挥单位只能配属指挥官驾驶员");
    return id;
  }
  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }
  function roll(id, seed, seat = 0, index = 0, model = null) {
    const named = profile(id);
    const command = commandUnit(model);
    let state = (seed ^ Math.imul(seat + 1, 0x9e3779b9) ^
      Math.imul(index + 1, 0x85ebca6b) ^ hash(id || (command ? "commander" : "default"))) >>> 0;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    const stats = {};
    for (const key of Object.keys(labels)) {
      const [low, high] = named
        ? [Math.max(0, named.baseStats[key] - catalog.namedVariation),
          Math.min(200, named.baseStats[key] + catalog.namedVariation)]
        : (command ? catalog.commanderRanges : catalog.defaultRanges)[key];
      stats[key] = low + Math.floor(random() * (high - low + 1));
    }
    return { id: named?.id || null, name: named?.name || defaultName(model), stats };
  }
  const legacyPilots = new WeakMap();
  const neutralPilot = {
    id: null,
    name: "默认驾驶员",
    stats: Object.fromEntries(Object.keys(labels).map((key) => [key, 100])),
  };
  function of(unit, model = null) {
    if (unit.visualOnly || unit.groundTarget) return neutralPilot;
    if (unit.pilot?.stats) return unit.pilot;
    if (!legacyPilots.has(unit))
      legacyPilots.set(unit, roll(unit.pilotId || null,
        hash(unit.id || unit.model || "default"), 0, 0, model));
    return legacyPilots.get(unit);
  }
  function factor(value, weight) {
    return Math.max(0.5, 1 + (value - 100) * weight / 100);
  }
  function modifiers(unit, model) {
    const stats = of(unit, model).stats;
    const awakening = stats.awakening >= 100 ? 1.15 : 1;
    return {
      shooting: factor(stats.shooting, 0.5) * awakening,
      melee: factor(stats.melee, 0.5) * awakening,
      defense: Math.max(0.05, 1 - (stats.defense - 100) * 0.005),
      move: factor(stats.speed, 0.5),
      accuracy: factor(stats.accuracy, 0.5),
      reaction: factor(stats.reaction, 0.5) * factor(stats.speed, 0.1),
    };
  }
  return { catalog, labels, profile, commandUnit, defaultName,
    validate, hash, roll, of, modifiers, baseStats, custom, createCustom, gainExperience, experienceRequired, cost, portrait, battleResult, creditAwards, maxPortraitLength, portraitData, defaultPortrait, growthRules, trainingBudget, statCap, refundTraining };
})();
if (typeof module !== "undefined") module.exports = PilotSystem;
