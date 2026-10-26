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
  function commandUnit(model) {
    return !!(model?.unitTags?.includes("CmdUnit") ||
      model?.sourceStats?.nativeTags?.includes("CmdUnit"));
  }
  function defaultName(model) {
    return commandUnit(model) ? "默认指挥官" : "默认驾驶员";
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
    validate, hash, roll, of, modifiers };
})();
if (typeof module !== "undefined") module.exports = PilotSystem;
