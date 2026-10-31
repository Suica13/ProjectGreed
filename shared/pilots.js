/* Pilot profiles are attachments, never battlefield units. Rolls are deterministic
 * from the private match seed and are stored in the authoritative unit state. */
"use strict";
const PilotSystem = (() => {
  const catalog = typeof PILOT_DATA !== "undefined" ? PILOT_DATA : require("./pilots.json");
  const aceById = new Map((catalog.aces || []).map((p) => [p.id, p]));
  const aceProfile = (value) =>
    aceById.get(typeof value === "string" ? value : value?.aceId) || null;
  const canAssign = (value, faction) =>
    !aceProfile(value) ||
    faction === "PMC" ||
    (aceProfile(value).availableFactions || [aceProfile(value).faction]).includes(faction);
  const maxLevel = (value) => aceProfile(value)?.maxLevel ?? growthRules.maxLevel;
  const aceStatCap = (value, key) => aceProfile(value)?.maxStats[key];
  const byId = new Map(catalog.named.map((pilot) => [pilot.id, pilot]));
  const portraitsById = new Map(catalog.portraits.map((portrait) => [portrait.id, portrait]));
  function defaultPortrait(faction = "PMC") {
    return (
      catalog.portraits.find((portrait) => portrait.faction === faction) || catalog.portraits[0]
    );
  }
  const labels = {
    shooting: "射击",
    melee: "格斗",
    defense: "防御",
    speed: "机动",
    accuracy: "命中",
    reaction: "反应",
    leadership: "指挥",
    awakening: "觉醒",
  };
  function profile(id) {
    return id ? byId.get(id) || null : null;
  }
  const maxPortraitLength = 16384;
  function portraitData(value) {
    if (!value) return null;
    if (
      typeof value !== "string" ||
      value.length > maxPortraitLength ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value)
    )
      throw Error("驾驶员头像无效或过大");
    return value;
  }
  const growthRules = Object.freeze({
    version: 6,
    initialLevel: 0,
    initialPoints: 80,
    pointsPerLevel: 40,
    maxLevel: 10,
    initialStatCap: 125,
    statCapPerLevel: 10,
    statCap: 200,
  });
  const experienceRequired = (level, value = null) => {
    const ace = aceProfile(value);
    // Lifetime XP thresholds: custom stages cost 1000, 2000, ... 10000.
    // ACE keeps its existing stage curve, expressed as cumulative thresholds.
    return ace ? 2000 * (2 ** (level + 1) - 1) : 500 * (level + 1) * (level + 2);
  };
  function cumulativeExperience(value, level, experience) {
    if (value.experienceVersion === 2) return experience;
    if (value.experienceVersion != null && value.experienceVersion !== 1)
      throw Error("驾驶员经验版本无效");
    const total = experience + (aceProfile(value) ? 2000 : 1000) * (2 ** level - 1);
    if (!Number.isSafeInteger(total)) throw Error("驾驶员经验无效");
    return total;
  }
  const trainingVersion = growthRules.version;
  const trainingBudget = (level) => growthRules.initialPoints + level * growthRules.pointsPerLevel;
  const statCap = (level) =>
    Math.min(growthRules.statCap, growthRules.initialStatCap + level * growthRules.statCapPerLevel);
  function baseStats() {
    return {
      shooting: 100,
      melee: 100,
      defense: 100,
      speed: 100,
      accuracy: 100,
      reaction: 100,
      leadership: 80,
      awakening: 60,
    };
  }
  function previousBase(key, value) {
    // Retain each released baseline when adding a new growth version.
    if (value.trainingVersion === 5) return baseStats()[key];
    if (value.trainingVersion === 3 || value.trainingVersion === 4)
      return key === "awakening" ? 50 : key === "leadership" ? 70 : 90;
    if (value.trainingVersion === 2)
      return key === "awakening" ? 60 : key === "leadership" ? 80 : 100;
    if (value.role === undefined) return key === "awakening" ? 50 : 100;
    if (key === "awakening") return 60;
    if (key === "leadership") return value.role === "commander" ? 120 : 80;
    return value.role === "commander" ? 80 : 110;
  }
  function ace(value) {
    const source = aceProfile(value);
    if (
      !source ||
      value.id !== "ace-" + source.id ||
      !Number.isInteger(value.level) ||
      value.level < source.initialLevel ||
      value.level > source.maxLevel
    )
      throw Error("ACE驾驶员数据无效");
    let level = value.level,
      experience = value.experience ?? 0;
    const version = source.growthVersion ?? 2;
    if ((value.aceGrowthVersion ?? 1) === 1) {
      const native = source.nativeGrowth;
      if (!native || level > native.maxLevel) throw Error("ACE驾驶员数据无效");
      const required = native.experienceBase * native.experienceMultiplier ** level;
      if (
        !Number.isSafeInteger(experience) ||
        experience < 0 ||
        (level < native.maxLevel && experience >= required)
      )
        throw Error("驾驶员经验无效");
      const oldStats = Object.fromEntries(
        Object.entries(source.baseStats).map(([key, base]) => [
          key,
          base * (source.comprehension / 100) ** level,
        ]),
      );
      if (value.stats && Object.keys(labels).some((key) => value.stats[key] !== oldStats[key]))
        throw Error("ACE属性由悟性成长，不能手动修改");
      // Carry normalized progress into the five-step curve, preserving completed
      // growth and in-level XP progress. Old max-level pilots keep their exact cap.
      const progress =
        level >= native.maxLevel
          ? source.maxLevel
          : ((level + experience / required) / native.maxLevel) * source.maxLevel;
      level = Math.min(source.maxLevel, Math.floor(progress));
      experience =
        level === source.maxLevel ? 0 : Math.floor((progress - level) * 2000 * 2 ** level);
      value = { ...value, stats: undefined };
    } else if (value.aceGrowthVersion !== version) throw Error("ACE驾驶员数据版本无效");
    if (!Number.isSafeInteger(experience) || experience < 0) throw Error("驾驶员经验无效");
    const stats = Object.fromEntries(
      Object.entries(source.baseStats).map(([key, base]) => [
        key,
        level === source.maxLevel
          ? source.maxStats[key]
          : base > 0
            ? base * (source.maxStats[key] / base) ** (level / source.maxLevel)
            : 0,
      ]),
    );
    if (value.stats && Object.keys(labels).some((key) => value.stats[key] !== stats[key]))
      throw Error("ACE属性由悟性成长，不能手动修改");
    const record = {};
    for (const key of ["kills", "shipKills", "battles", "losses", "destroyedCost", "lostCost"]) {
      const n = value.record?.[key] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw Error("驾驶员战绩无效");
      record[key] = n;
    }
    return {
      id: value.id,
      aceId: source.id,
      ace: true,
      aceGrowthVersion: version,
      custom: true,
      name: source.name,
      faction: source.faction,
      level,
      experience: cumulativeExperience(value, level, experience),
      experienceVersion: 2,
      stats,
      record,
      points: 0,
      needsRecruitment: value.needsRecruitment === true,
    };
  }
  function createAce(id) {
    const source = aceProfile(id);
    if (!source?.price) throw Error("该ACE暂不可招募");
    return ace({
      id: "ace-" + id,
      aceId: id,
      aceGrowthVersion: source.growthVersion,
      level: source.initialLevel,
      experience: 0,
    });
  }
  function recruitmentPrice(id, previous = null) {
    const price = aceProfile(id)?.price;
    if (!price) return null;
    const returning = previous?.aceId === id && previous.needsRecruitment;
    return Object.fromEntries(
      ["money", "supplies"].map((key) => [key, Math.ceil(price[key] * (returning ? 0.5 : 1))]),
    );
  }
  function recruitAce(id, previous = null) {
    if (!previous) return createAce(id);
    const pilot = custom(previous);
    if (pilot.aceId !== id || !pilot.needsRecruitment || !aceProfile(id)?.price)
      throw Error("该ACE暂不可招募");
    return custom({ ...pilot, needsRecruitment: false });
  }
  const skillUnlockLevel = 6;
  const skillChoices = catalog.customSkills || [];
  function canLearnSkill(pilot) {
    return (
      !!pilot?.custom &&
      !pilot.ace &&
      !pilot.aceId &&
      pilot.level >= skillUnlockLevel &&
      !pilot.selectedSkillId
    );
  }
  function learnSkill(value, id) {
    const pilot = custom(value);
    if (!canLearnSkill(pilot) || !skillChoices.some((skill) => skill.id === id))
      throw Error("驾驶员技能不可选择");
    return custom({ ...pilot, selectedSkillId: id });
  }
  function custom(value) {
    if (value?.aceId || value?.ace) return ace(value);
    if (!value || typeof value !== "object" || !/^custom-[a-zA-Z0-9-]{1,80}$/.test(value.id || ""))
      throw Error("自建驾驶员无效");
    if (!Number.isInteger(value.level) || value.level < 0 || value.level > 1000)
      throw Error("驾驶员等级无效");
    const level = Math.min(value.level, growthRules.maxLevel);
    const name =
      typeof value.name === "string"
        ? value.name
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 24)
        : "";
    if (!name) throw Error("请输入驾驶员名称");
    const bases = baseStats();
    const oldVersion = value.trainingVersion ?? 1;
    if (!Number.isInteger(oldVersion) || oldVersion < 1 || oldVersion > trainingVersion)
      throw Error("驾驶员数据版本无效");
    if (oldVersion < 6 && value.level < 1) throw Error("驾驶员等级无效");
    if (oldVersion === trainingVersion && value.level > growthRules.maxLevel)
      throw Error("驾驶员等级无效");
    const reset = oldVersion < trainingVersion;
    const previousCap = oldVersion >= 4 ? Math.min(200, 125 + (value.level - 1) * 10) : 160;
    const maximum = reset ? previousCap : statCap(level);
    const stats = {};
    let spent = 0;
    for (const key of Object.keys(labels)) {
      const minimum = reset ? previousBase(key, value) : bases[key];
      const amount = value.stats?.[key];
      if (!Number.isInteger(amount) || amount < minimum || amount > maximum)
        throw Error("驾驶员属性无效");
      stats[key] = reset ? bases[key] : amount;
      spent += amount - minimum;
    }
    const previousBudget =
      oldVersion === 5
        ? 60 + (value.level - 1) * 20
        : oldVersion === 4
          ? 60 + (value.level - 1) * 15
          : oldVersion === 3
            ? 50 + (value.level - 1) * 20
            : (oldVersion === 2 ? 30 : 0) + (value.level - 1) * 10;
    if (spent > (reset ? previousBudget : trainingBudget(level))) throw Error("驾驶员强化点不足");
    const rawExperience = value.experience ?? 0;
    if (
      !Number.isSafeInteger(rawExperience) ||
      rawExperience < 0 ||
      (reset && rawExperience >= 1000 * 2 ** (value.level - 1))
    )
      throw Error("驾驶员经验无效");
    const experience = cumulativeExperience(
      value,
      reset ? Math.max(0, value.level - 1) : level,
      rawExperience,
    );
    const selectedSkillId = value.selectedSkillId;
    if (
      selectedSkillId != null &&
      (typeof selectedSkillId !== "string" ||
        level < skillUnlockLevel ||
        !skillChoices.some((skill) => skill.id === selectedSkillId))
    )
      throw Error("驾驶员技能无效");

    if (reset) spent = 0; // A growth-rule revision refunds every allocated point under the current budget.
    const record = {};
    for (const key of ["kills", "shipKills", "battles", "losses", "destroyedCost", "lostCost"]) {
      const n = value.record?.[key] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw Error("驾驶员战绩无效");
      record[key] = n;
    }
    const faction = value.faction ?? "PMC";
    if (!["PMC", "EFSF", "ZEON"].includes(faction)) throw Error("驾驶员阵营无效");
    const uploadedPortrait = portraitData(value.uploadedPortrait);
    const portraitId = portraitsById.has(value.portraitId)
      ? value.portraitId
      : defaultPortrait(faction)?.id;
    return {
      id: value.id,
      name,
      trainingVersion,
      faction,
      portraitId,
      ...(uploadedPortrait ? { uploadedPortrait } : {}),
      level,
      experience,
      experienceVersion: 2,
      stats,
      record,
      points: trainingBudget(level) - spent,
      ...(selectedSkillId ? { selectedSkillId } : {}),
      custom: true,
    };
  }
  function createCustom(id, name, portraitId, faction = "PMC") {
    return custom({
      id,
      name,
      trainingVersion,
      portraitId,
      faction,
      level: growthRules.initialLevel,
      experience: 0,
      stats: baseStats(),
    });
  }
  function gainExperience(value, amount) {
    const p = custom(value);
    if (!Number.isSafeInteger(amount) || amount < 0) throw Error("驾驶员经验奖励无效");
    p.experience += amount;
    return custom(p);
  }
  const upgradePrices = Object.freeze([
    1000, 2000, 4000, 6000, 10000, 15000, 22000, 30000, 40000, 50000,
  ]);
  const customRecruitmentCost = 1000;
  const upgradeCost = (value) =>
    value.level < maxLevel(value)
      ? aceProfile(value)
        ? (aceProfile(value).price?.money ?? null)
        : upgradePrices[value.level]
      : 0;
  const demotionCost = (value) =>
    value.level > 0
      ? aceProfile(value)
        ? (aceProfile(value).price?.money ?? null)
        : upgradePrices[value.level - 1] / 2
      : 0;
  const canUpgrade = (value) =>
    !value.needsRecruitment &&
    value.level < maxLevel(value) &&
    upgradeCost(value) !== null &&
    value.experience >= experienceRequired(value.level, value);
  function upgrade(value) {
    const p = custom(value);
    if (!canUpgrade(p)) throw Error("驾驶员尚未满足升职条件");
    p.level++;
    if (p.ace) delete p.stats;
    return custom(p);
  }
  function demote(value) {
    const p = custom(value);
    if (p.level <= 0 || p.needsRecruitment || demotionCost(p) === null)
      throw Error("驾驶员尚未满足降职条件");
    p.level--;
    if (p.ace) delete p.stats;
    else {
      p.stats = baseStats();
      delete p.selectedSkillId;
    }
    return custom(p);
  }
  function refundTraining(value) {
    const pilot = custom(value);
    if (pilot.ace) throw Error("ACE不能重置属性点");
    return custom({ ...pilot, stats: baseStats(), selectedSkillId: null });
  }
  function battleResult(value, kind, unitCost, experiencePoints = unitCost, details = {}) {
    if (
      !["kill", "loss", "assist", "battle"].includes(kind) ||
      !Number.isSafeInteger(unitCost) ||
      unitCost < 0
    )
      throw Error("驾驶员战绩结算无效");
    if (!Number.isSafeInteger(experiencePoints) || experiencePoints < 0)
      throw Error("驾驶员经验奖励无效");
    let p = custom(value);
    if (kind === "kill") {
      p.record.kills++;
      if (details.shipKill === true) p.record.shipKills++;
      p.record.destroyedCost += unitCost;
      p = gainExperience(p, experiencePoints);
    } else if (kind === "battle") {
      p.record.battles++;
    } else if (kind === "assist") {
      p = gainExperience(p, experiencePoints);
    } else {
      p.record.losses++;
      p.record.lostCost += unitCost;
      if (p.ace && details.requiresRecruitment !== false) p.needsRecruitment = true;
    }
    return custom(p);
  }
  function creditAwards(store, awards) {
    const received = new Set(store.awards);
    let changed = false;
    for (const award of awards) {
      if (received.has(award.id)) continue;
      const i = store.pilots.findIndex(
        (p) => p.id === award.pilotId && (!award.faction || p.faction === award.faction),
      );
      if (i < 0) continue;
      store.pilots[i] = battleResult(
        store.pilots[i],
        award.kind,
        award.points,
        award.experiencePoints ?? award.points,
        {
          shipKill: award.shipKill === true,
          requiresRecruitment: award.requiresRecruitment === true,
        },
      );
      received.add(award.id);
      changed = true;
    }
    if (changed) store.awards = [...received];
    return changed;
  }
  const portrait = (value) =>
    aceProfile(value)?.icon ||
    value?.uploadedPortrait ||
    portraitsById.get(value?.portraitId)?.icon ||
    defaultPortrait(value?.faction)?.icon;
  const cost = (value) => {
    if (!value) return 0;
    const pilot = custom(value);
    return pilot.ace && pilot.needsRecruitment
      ? 0
      : pilot.ace
        ? (aceProfile(pilot).costBase ?? 250) + pilot.level * (aceProfile(pilot).costPerLevel ?? 25)
        : pilot.level * 25;
  };
  function commandUnit(model) {
    return !!(
      model?.unitTags?.includes("CmdUnit") || model?.sourceStats?.nativeTags?.includes("CmdUnit")
    );
  }
  function defaultName(model) {
    return (
      (model?.faction === "EFSF" ? "联邦" : model?.faction === "ZEON" ? "吉翁" : "") +
      (commandUnit(model) ? "默认指挥官" : "默认驾驶员")
    );
  }
  function validate(id, model) {
    if (id === undefined || id === null || id === "") return null;
    if (typeof id !== "string" || !byId.has(id)) throw Error("驾驶员无效");
    if (model?.faction !== byId.get(id).faction) throw Error("驾驶员与单位阵营不匹配");
    if (commandUnit(model) && !byId.get(id).commander) throw Error("指挥单位只能配属指挥官驾驶员");
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
    let state =
      (seed ^
        Math.imul(seat + 1, 0x9e3779b9) ^
        Math.imul(index + 1, 0x85ebca6b) ^
        hash(id || (command ? "commander" : "default"))) >>>
      0;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    const stats = {};
    for (const key of Object.keys(labels)) {
      const [low, high] = named
        ? [
            Math.max(0, named.baseStats[key] - catalog.namedVariation),
            Math.min(200, named.baseStats[key] + catalog.namedVariation),
          ]
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
  const buffPilotCache = new WeakMap();
  function skillsOf(unit) {
    const pilot = unit?.pilot;
    const aceSkills = aceProfile(pilot)?.skills;
    if (aceSkills) return aceSkills;
    if (!pilot?.custom || pilot.level < skillUnlockLevel) return [];
    const skill = skillChoices.find((item) => item.id === pilot.selectedSkillId);
    return skill ? [skill] : [];
  }
  function hasPassive(unit, id) {
    return skillsOf(unit).some((s) => s.id === id && s.passive);
  }
  function experienceMultiplier(unit) {
    return skillsOf(unit).reduce(
      (rate, s) => (unit.pilotBuffs?.[s.id] ? rate * (s.experienceMultiplier ?? 1) : rate),
      1,
    );
  }
  function of(unit, model = null) {
    const base = rawPilot(unit, model);
    if (!Object.keys(unit.pilotBuffs || {}).length) return base;
    let cached = buffPilotCache.get(unit);
    if (!cached || cached.base !== base || cached.buffs !== unit.pilotBuffs) {
      const stats = { ...base.stats };
      for (const skill of skillsOf(unit))
        if (unit.pilotBuffs[skill.id])
          for (const [key, multiplier] of Object.entries(skill.statMultipliers || {}))
            stats[key] *= multiplier;
      cached = { base, buffs: unit.pilotBuffs, value: { ...base, stats } };
      buffPilotCache.set(unit, cached);
    }
    return cached.value;
  }
  function rawPilot(unit, model = null) {
    if (unit.visualOnly || unit.groundTarget) return neutralPilot;
    if (unit.pilot?.stats) return unit.pilot;
    if (!legacyPilots.has(unit))
      legacyPilots.set(
        unit,
        roll(unit.pilotId || null, hash(unit.id || unit.model || "default"), 0, 0, model),
      );
    return legacyPilots.get(unit);
  }
  function factor(value, weight) {
    return Math.max(0.5, 1 + ((value - 100) * weight) / 100);
  }
  function modifiers(unit, model) {
    const stats = of(unit, model).stats;
    const awakening = stats.awakening >= 100 ? 1.075 : 1;
    return {
      shooting: factor(stats.shooting, 0.25) * awakening,
      melee: factor(stats.melee, 0.25) * awakening,
      defense: Math.max(0.05, 1 - (stats.defense - 100) * 0.0025),
      move: factor(stats.speed, 0.5),
      actionPointsMultiplier: factor(stats.speed, 0.4),
      accuracy: factor(stats.accuracy, 0.25),
      reaction: factor(stats.reaction, 0.25),
    };
  }
  return {
    catalog,
    skillsOf,
    skillChoices,
    skillUnlockLevel,
    canLearnSkill,
    learnSkill,
    hasPassive,
    experienceMultiplier,
    labels,
    profile,
    aceProfile,
    canAssign,
    aceStatCap,
    maxLevel,
    createAce,
    recruitAce,
    recruitmentPrice,
    commandUnit,
    defaultName,
    validate,
    hash,
    roll,
    of,
    modifiers,
    baseStats,
    custom,
    createCustom,
    gainExperience,
    upgradeCost,
    canUpgrade,
    upgrade,
    demote,
    demotionCost,
    customRecruitmentCost,
    experienceRequired,
    cost,
    portrait,
    battleResult,
    creditAwards,
    maxPortraitLength,
    portraitData,
    defaultPortrait,
    growthRules,
    trainingBudget,
    statCap,
    refundTraining,
  };
})();
if (typeof module !== "undefined") module.exports = PilotSystem;
