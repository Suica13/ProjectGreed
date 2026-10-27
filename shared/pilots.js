/* Pilot profiles are attachments, never battlefield units. Rolls are deterministic
 * from the private match seed and are stored in the authoritative unit state. */
"use strict";
const PilotSystem = (() => {
  const catalog = typeof PILOT_DATA !== "undefined" ? PILOT_DATA : require("./pilots.json");
  const byId = new Map(catalog.named.map((pilot) => [pilot.id, pilot]));
  const labels = {
    shooting: "射击", melee: "格斗", defense: "防御", speed: "机动",
    accuracy: "命中", reaction: "反应", leadership: "领导", awakening: "觉醒",
  };
  function profile(id) {
    return id ? byId.get(id) || null : null;
  }
  const experienceRequired = (level) => 1000 * 2 ** (level - 1);
  function custom(value) {
    if (!value || typeof value !== "object" || !/^custom-[a-zA-Z0-9-]{1,80}$/.test(value.id || ""))
      throw Error("自建驾驶员无效");
    const level = value.level;
    if (!Number.isInteger(level) || level < 1 || level > 1000) throw Error("驾驶员等级无效");
    const name = typeof value.name === "string" ? value.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) : "";
    if (!name) throw Error("请输入驾驶员名称");
    const stats = {};
    let spent = 0;
    for (const key of Object.keys(labels)) {
      const base = key === "awakening" ? 50 : 100;
      const n = value.stats?.[key];
      if (!Number.isInteger(n) || n < base || n > 160) throw Error("驾驶员属性无效");
      stats[key] = n;
      spent += n - base;
    }
    if (spent > (level - 1) * 10) throw Error("驾驶员强化点不足");
    const experience = value.experience ?? 0;
    if (!Number.isSafeInteger(experience) || experience < 0 || experience >= experienceRequired(level))
      throw Error("驾驶员经验无效");
    const record = {};
    for (const key of ["kills", "losses", "destroyedCost", "lostCost"]) {
      const n = value.record?.[key] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw Error("驾驶员战绩无效");
      record[key] = n;
    }
    const portraitId = byId.has(value.portraitId) ? value.portraitId : catalog.named[0]?.id;
    return { id: value.id, name, portraitId, level, experience, stats, record, points: (level - 1) * 10 - spent, custom: true };
  }
  function createCustom(id, name, portraitId) {
    return custom({ id, name, portraitId, level: 1, experience: 0,
      stats: Object.fromEntries(Object.keys(labels).map(key => [key, key === "awakening" ? 50 : 100])) });
  }
  function gainExperience(value, amount) {
    const p = custom(value);
    if (!Number.isSafeInteger(amount) || amount < 0) throw Error("驾驶员经验奖励无效");
    p.experience += amount;
    if (p.experience >= experienceRequired(p.level) && p.level < 1000) {
      p.level++;
      p.experience = 0;
    }
    return custom(p);
  }
  function battleResult(value, kind, unitCost) {
    if (!["kill", "loss"].includes(kind) || !Number.isSafeInteger(unitCost) || unitCost < 0)
      throw Error("驾驶员战绩结算无效");
    let p = custom(value);
    if (kind === "kill") {
      p.record.kills++;
      p.record.destroyedCost += unitCost;
      p = gainExperience(p, unitCost);
    } else {
      p.record.losses++;
      p.record.lostCost += unitCost;
      p.experience = Math.max(0, p.experience - experienceRequired(p.level) * 0.25);
    }
    return custom(p);
  }
  function creditAwards(store, awards) {
    const received = new Set(store.awards);
    let changed = false;
    for (const award of awards) {
      if (received.has(award.id)) continue;
      const i = store.pilots.findIndex(p => p.id === award.pilotId);
      if (i < 0) continue;
      store.pilots[i] = battleResult(store.pilots[i], award.kind, award.points);
      received.add(award.id);
      changed = true;
    }
    if (changed) store.awards = [...received];
    return changed;
  }
  const portrait = (value) => profile(value?.portraitId)?.icon || catalog.named[0]?.icon;
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
    const command = commandUnit(model);
    const offense = command ? stats.leadership : stats.shooting;
    const melee = command ? stats.leadership : stats.melee;
    const defense = command ? stats.leadership : stats.defense;
    const accuracy = command ? stats.leadership : stats.accuracy;
    const reaction = command ? stats.leadership : stats.reaction;
    const graduated = (value) =>
      (Math.min(value, 175) - 100) * 0.25 + Math.max(0, value - 175) * 0.125;
    const awakening = stats.awakening >= 100 ? 1.15 : 1;
    return {
      shooting: factor(offense, 0.5) * awakening,
      melee: factor(melee, 0.5) * awakening,
      defense: Math.min(1.5, Math.max(0.5, 1 - (defense - 100) * 0.002)),
      speed: factor(command ? stats.leadership : stats.speed, 0.105),
      accuracy: factor(100 + graduated(accuracy), 1),
      reaction: factor(100 + graduated(reaction), 1),
    };
  }
  return { catalog, labels, profile, commandUnit, defaultName,
    validate, hash, roll, of, modifiers, custom, createCustom, gainExperience, experienceRequired, cost, portrait, battleResult, creditAwards };
})();
if (typeof module !== "undefined") module.exports = PilotSystem;
