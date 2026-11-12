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
  const maxLevel = (value) => aceProfile(value)?.maxLevel ?? growthRules.maxLevel + (value?.reincarnations || 0);
  const aceStatCap = (value, key) =>
    aceProfile(value) ? Math.round(aceProfile(value).maxStats[key]) : undefined;
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
    version: 7,
    initialLevel: 0,
    initialPoints: 80,
    pointsPerLevel: 40,
    maxLevel: 8,
    initialStatCap: 125,
    statCapPerLevel: 10,
    statCap: 200,
  });
  const customExperience = Object.freeze([500, 1500, 3000, 5000, 10000, 15000, 20000, 30000, 200000, 3000000, 4000000, 5000000]);
  const aceExperience = Object.freeze([1500, 3000, 5000, 10000, 20000]);
  const experienceRequired = (level, value = null) =>
    (aceProfile(value) ? aceExperience : customExperience)[level] ?? Infinity;
  const pilotFactions = (value) => {
    const source = aceProfile(value);
    return source ? [...new Set([source.faction, ...(source.availableFactions || [])])] : [];
  };
  function matchesFilter(value, filter = "all") {
    return (
      filter === "all" ||
      (filter === "custom" ? !aceProfile(value) : pilotFactions(value).includes(filter))
    );
  }
  function allowed(value, restrictions = {}) {
    if (!value?.custom && !value?.aceId) return true;
    const ace = !!aceProfile(value),
      policy = restrictions.pilotPolicy || "allow";
    if (policy === "none" || (ace ? policy === "no_ace" : policy === "no_custom")) return false;
    const tags = ace ? pilotFactions(value).map((f) => "pilot:" + f) : ["pilot:custom"];
    return !tags.some((tag) => restrictions.bannedFactions?.includes(tag));
  }
  // COST excludes the attached pilot's own COST on both sides of the ratio.
  function combatExperience(ownCost, defeatedCost, multiplier = 1) {
    return Math.max(
      0,
      Math.floor(((100 * Math.max(0, defeatedCost)) / Math.max(1, ownCost)) * multiplier),
    );
  }
  const aceTotals = (catalog.aces || []).map((source) =>
    Object.values(source.maxStats).reduce((sum, n) => sum + Math.round(n), 0),
  );
  const minimumAceTotal = Math.min(...aceTotals),
    maximumAceTotal = Math.max(...aceTotals);
  function aceBaseCost(value) {
    const source = aceProfile(value) || value;
    const total = Object.values(source.maxStats).reduce((sum, n) => sum + Math.round(n), 0);
    return maximumAceTotal === minimumAceTotal
      ? 250
      : Math.max(
          200,
          Math.min(
            300,
            200 +
              25 * Math.round((4 * (total - minimumAceTotal)) / (maximumAceTotal - minimumAceTotal)),
          ),
        );
  }
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
    const growthStats = Object.fromEntries(
      Object.entries(source.baseStats).map(([key, base]) => [
        key,
        level === source.maxLevel
          ? source.maxStats[key]
          : base > 0
            ? base * (source.maxStats[key] / base) ** (level / source.maxLevel)
            : 0,
      ]),
    );
    const stats = Object.fromEntries(
      Object.entries(growthStats).map(([key, n]) => [key, Math.round(n)]),
    );
    // Accept exact legacy growth values, then normalize them without losing XP or rank.
    if (
      value.stats &&
      Object.keys(labels).some(
        (key) => value.stats[key] !== stats[key] && value.stats[key] !== growthStats[key],
      )
    )
      throw Error("ACE属性由悟性成长，不能手动修改");
    const record = {};
    for (const key of ["kills", "shipKills", "battles", "losses"]) {
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
      originFaction: source.originFaction || source.faction,
      personality: source.personality || "calm",
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
      (!pilot.selectedSkillId || (pilot.level >= 12 && !pilot.selectedSecondSkillId))
    );
  }
  function learnSkill(value, id) {
    const pilot = custom(value);
    if (!canLearnSkill(pilot) || !skillChoices.some((skill) => skill.id === id) ||
      [pilot.selectedSkillId, pilot.selectedSecondSkillId].includes(id))
      throw Error("驾驶员技能不可选择");
    return custom({ ...pilot, [pilot.selectedSkillId ? "selectedSecondSkillId" : "selectedSkillId"]: id });
  }
  const dialogueEvents = [
    ["attack", "发动攻击"], ["hit", "受到攻击"], ["miss", "攻击落空"],
    ["kill", "击破敌军"], ["defeat", "自身被击破"], ["allyKill", "友军击破敌军"],
    ["allyLoss", "友军被击破"], ["taunt", "挑衅敌军"], ["reply", "回应挑衅"],
    ["board", "接收搭乘单位"], ["launch", "送出出击单位"], ["preload", "预先搭载确认"],
    ["passengerBoard", "搭乘时回应"], ["passengerLaunch", "出击时回应"],
  ];
  const dialogueLimits = { lines: 10, length: 120, total: 6000 };
  function normalizeDialogue(value, legacy = false) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !dialogueEvents.some(([id]) => id === key)))
      throw Error("互动文本事件无效");
    const clean = {};
    let total = 0;
    for (const [event] of dialogueEvents) {
      if (!Object.hasOwn(value, event)) continue;
      const lines = value[event];
      if (!Array.isArray(lines) || lines.length > (legacy ? 12 : dialogueLimits.lines))
        throw Error("每个事件最多10句台词");
      const phrases = [];
      for (const line of lines) {
        if (typeof line !== "string" || /[\u0000-\u001f\u007f]/.test(line))
          throw Error("互动台词必须是单行文本");
        const text = line.trim();
        if (text.length > dialogueLimits.length) throw Error("每句台词最多120字");
        if (!text) continue;
        total += text.length;
        if (total > dialogueLimits.total) throw Error("互动台词总长度最多6000字");
        phrases.push(text);
      }
      if (phrases.length) clean[event] = phrases.slice(0, dialogueLimits.lines);
    }
    return clean;
  }
  function exportDialogue(value) {
    return { format: "projectgreed.pilot-dialogue", version: 1, dialogue: normalizeDialogue(value) };
  }
  function importDialogue(value) {
    if (!value || value.format !== "projectgreed.pilot-dialogue" || value.version !== 1 || !value.dialogue)
      throw Error("互动文本JSON格式或版本无效");
    return normalizeDialogue(value.dialogue);
  }
  function custom(value) {
    if (value?.aceId || value?.ace) return ace(value);
    if (!value || typeof value !== "object" || !/^custom-[a-zA-Z0-9-]{1,80}$/.test(value.id || ""))
      throw Error("PMC驾驶员无效");
    if (!Number.isInteger(value.level) || value.level < 0 || value.level > 1000)
      throw Error("驾驶员等级无效");
    const reincarnations = value.reincarnations ?? 0;
    if (!Number.isInteger(reincarnations) || reincarnations < 0 || reincarnations > 4)
      throw Error("驾驶员转生次数无效");
    const level = Math.min(value.level, maxLevel({ reincarnations }));
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
    if (oldVersion === trainingVersion && value.level > maxLevel({ reincarnations }))
      throw Error("驾驶员等级无效");
    const reset = oldVersion < 6;
    const legacySix = oldVersion === 6;
    const previousCap = oldVersion >= 4 ? Math.min(200, 125 + (value.level - 1) * 10) : 160;
    const maximum = legacySix
      ? Math.min(200, 125 + value.level * 10)
      : reset
        ? previousCap
        : statCap(level);
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
    if (
      spent > (legacySix ? 80 + value.level * 40 : reset ? previousBudget : trainingBudget(level))
    )
      throw Error("驾驶员强化点不足");
    const rawExperience = value.experience ?? 0;
    if (
      !Number.isSafeInteger(rawExperience) ||
      rawExperience < 0 ||
      (reset && rawExperience >= 1000 * 2 ** (value.level - 1))
    )
      throw Error("驾驶员经验无效");
    const experience = cumulativeExperience(
      value,
      legacySix ? value.level : reset ? Math.max(0, value.level - 1) : level,
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
    const selectedSecondSkillId = value.selectedSecondSkillId;
    if (selectedSecondSkillId != null && (level < 12 || !selectedSkillId ||
      selectedSecondSkillId === selectedSkillId || !skillChoices.some(skill => skill.id === selectedSecondSkillId)))
      throw Error("驾驶员技能无效");

    if (reset) spent = 0;
    // Former level 9/10 saves retain lifetime XP and records. Refund training
    // only when their allocated points exceed the new level-eight budget.
    if (legacySix && spent > trainingBudget(level)) {
      Object.assign(stats, bases);
      spent = 0;
    }
    const record = {};
    for (const key of ["kills", "shipKills", "battles", "losses"]) {
      const n = value.record?.[key] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw Error("驾驶员战绩无效");
      record[key] = n;
    }
    const faction = value.faction ?? "PMC";
    if (!["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(faction))
      throw Error("驾驶员阵营无效");
    const allowedPersonalities = ["calm", "aggressive", "cautious", "idealist", "strategic", "sarcastic", "strict", "zealous", "proud", "obsessive", "empathetic", "custom"];
    const personality = value.personality == null ? null : value.personality;
    if (personality !== null && !allowedPersonalities.includes(personality))
      throw Error("驾驶员性格无效");
    const background = typeof value.background === "string"
      ? value.background.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160)
      : "";
    const originFaction = value.originFaction ?? faction;
    if (!["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(originFaction))
      throw Error("驾驶员出身阵营无效");
    const uploadedPortrait = portraitData(value.uploadedPortrait);
    const dialogue = normalizeDialogue(value.dialogue, true);
    const portraitId = portraitsById.has(value.portraitId)
      ? value.portraitId
      : defaultPortrait(faction)?.id;
    return {
      id: value.id,
      name,
      trainingVersion,
      faction,
      originFaction,
      ...(personality ? { personality } : {}),
      ...(background ? { background } : {}),
      ...(Object.keys(dialogue).length ? { dialogue } : {}),
      portraitId,
      ...(uploadedPortrait ? { uploadedPortrait } : {}),
      level,
      ...(reincarnations ? { reincarnations } : {}),
      experience,
      experienceVersion: 2,
      stats,
      record,
      points: trainingBudget(level) - spent,
      ...(selectedSkillId ? { selectedSkillId } : {}),
      ...(selectedSecondSkillId ? { selectedSecondSkillId } : {}),
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
    1000, 2000, 4000, 6000, 10000, 15000, 22000, 30000, 40000, 50000, 60000, 70000,
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
  const canReincarnate = (value) => !!value?.custom && !aceProfile(value) &&
    !value.needsRecruitment && (value.reincarnations || 0) < 4 && value.level === maxLevel(value);
  const reincarnationCost = (value) => canReincarnate(value) ? upgradePrices[value.level] * 2 : 0;
  function reincarnate(value) {
    const pilot = custom(value);
    if (!canReincarnate(pilot)) throw Error("驾驶员尚未满足转生条件");
    return custom({ ...pilot, reincarnations: (pilot.reincarnations || 0) + 1,
      level: 0, experience: 0, stats: baseStats(), selectedSkillId: null, selectedSecondSkillId: null });
  }
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
      delete p.selectedSecondSkillId;
    }
    return custom(p);
  }
  function refundTraining(value) {
    const pilot = custom(value);
    if (pilot.ace) throw Error("ACE不能重置属性点");
    return custom({ ...pilot, stats: baseStats(), selectedSkillId: null, selectedSecondSkillId: null });
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
      p = gainExperience(p, experiencePoints);
    } else if (kind === "battle") {
      p.record.battles++;
    } else if (kind === "assist") {
      p = gainExperience(p, experiencePoints);
    } else {
      p.record.losses++;
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
        ? aceBaseCost(pilot) + pilot.level * (aceProfile(pilot).costPerLevel ?? 25)
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
    return [pilot.selectedSkillId, ...(pilot.level >= 12 ? [pilot.selectedSecondSkillId] : [])]
      .map(id => skillChoices.find(item => item.id === id)).filter(Boolean);
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
      for (const key of Object.keys(stats)) stats[key] = Math.round(stats[key]);
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
    const awakening = stats.awakening >= 100 ? 10 : 0;
    return {
      shooting: factor(stats.shooting, 0.25),
      melee: factor(stats.melee, 0.25),
      defense: Math.max(0.05, 1 - (stats.defense - 100) * 0.0025),
      move: factor(stats.speed, 0.5),
      attackRounds: factor(stats.speed, 0.5),
      awakeningHit: awakening,
      awakeningEvasion: awakening,
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
    pilotFactions,
    matchesFilter,
    allowed,
    combatExperience,
    aceBaseCost,
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
    dialogueEvents,
    dialogueLimits,
    normalizeDialogue,
    exportDialogue,
    importDialogue,
    createCustom,
    gainExperience,
    upgradeCost,
    canUpgrade,
    canReincarnate,
    reincarnationCost,
    reincarnate,
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
