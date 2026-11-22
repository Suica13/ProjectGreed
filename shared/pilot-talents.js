/* Persistent PMC talents. Never draw random results during render or battle queries. */
"use strict";
const PilotTalents = (() => {
  const catalog =
    typeof PILOT_TALENT_DATA !== "undefined" ? PILOT_TALENT_DATA : require("./pilot-talents.json");
  const byId = new Map(catalog.map((t) => [t.id, t]));
  function normalize(value = []) {
    if (
      !Array.isArray(value) ||
      value.length > 3 ||
      value.some((id) => !byId.has(id)) ||
      new Set(value).size !== value.length
    )
      throw Error("驾驶员天赋无效");
    return [...value];
  }
  function fill(profile, count) {
    const talents = normalize(profile.talents),
      limit = Math.min(3, count);
    for (let slot = talents.length; slot < limit; slot++) {
      const available = catalog.filter((t) => !talents.includes(t.id));
      let hash = 2166136261;
      for (const c of profile.id + "/talent/" + slot)
        hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
      talents.push(available[hash % available.length].id);
    }
    return talents;
  }
  const of = (p) =>
    p?.custom && !p.ace && !p.aceId ? normalize(p.talents).map((id) => byId.get(id)) : [];
  function matches(when, c) {
    if (!when) return true;
    const hp = c.unit && c.maxHP > 0 ? c.unit.hp / c.maxHP : null;
    const targetHP = c.target && c.targetMaxHP > 0 ? c.target.hp / c.targetMaxHP : null;
    switch (when) {
      case "low30":
        return hp !== null && hp < 0.3;
      case "low50":
        return hp !== null && hp <= 0.5;
      case "targetLow30":
        return targetHP !== null && targetHP < 0.3;
      case "targetHigh75":
        return targetHP !== null && targetHP >= 0.75;
      case "attack":
        return c.attack === true;
      case "counter":
        return c.isCounter === true;
      case "defend":
        return c.defender === true && c.response === "defend";
      case "evade":
        return c.defender === true && c.response === "evade";
      case "adjacentMelee":
        return c.weapon?.type === "melee" && c.distance === 1;
      case "farRanged":
        return c.weapon?.type !== "melee" && c.distance >= 4;
      case "squad":
        return c.squadCount >= 3;
      case "alone":
        return c.squadCount === 1;
      case "night":
        return c.night === true;
      case "ground":
        return c.environment === "ground";
      case "space":
        return c.environment === "space";
      case "water":
        return c.environment === "water";
      case "explosive":
        return (
          c.weapon?.type !== "melee" &&
          [
            "bazooka",
            "missile",
            "grenade",
            "grenade_launcher",
            "panzerfaust",
            "mortar",
            "blast",
            "bomb",
            "nuke",
          ].includes(c.weapon?.category)
        );
      case "cannon":
        return c.weapon?.type !== "melee" && ["cannon", "beam_cannon"].includes(c.weapon?.category);
      case "missile":
        return c.weapon?.category === "missile";
      case "sniper":
        return c.weapon?.category === "sniper" || c.weapon?.special?.type === "sniper";
      default:
        return false;
    }
  }
  function effects(profile, context = {}) {
    const result = {};
    for (const talent of of(profile)) {
      for (const [key, value] of Object.entries(talent.always || {}))
        result[key] = (result[key] || 0) + value;
      if (matches(talent.when, context))
        for (const [key, value] of Object.entries(talent.effects))
          result[key] = (result[key] || 0) + value;
    }
    return result;
  }
  return { catalog, normalize, fill, of, effects };
})();
if (typeof module !== "undefined") module.exports = PilotTalents;
