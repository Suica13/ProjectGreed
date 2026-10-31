"use strict";
// Prices are per deployed unit, including its selected kit, never tactical COST.
const BattleEconomy = (() => {
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-data.cjs");
  const killTechnologyRate = 0.75;
  function price(modelId, resource = "money") {
    const unitId = modelId.split("__")[0];
    const offer = catalog.offers[modelId] || catalog.offers[catalog.baseModels[unitId]];
    return offer ? (offer[resource] ?? 0) / offer.quantity : 0;
  }
  function rates(faction, mode) {
    const speed = mode === "quick" ? 0.25 : 1;
    return {
      currency: (faction === "PMC" ? 1 : 0.5) * speed,
      technology: (faction === "PMC" ? 0.5 : 1) * speed,
      experience: speed,
    };
  }
  function strengthRatio(roster, team) {
    let own = 0, enemy = 0, ownSeats = 0, enemySeats = 0;
    const counted = new Set();
    for (const [id, unit] of Object.entries(roster || {})) {
      if (unit.team === undefined) continue;
      // Each room participant has one strength setting, independent of army size.
      const member = unit.memberId ?? id;
      if (counted.has(member)) continue;
      counted.add(member);
      const strength = unit.performance ?? 1;
      if (unit.team === team) { own += strength; ownSeats++; }
      else { enemy += strength; enemySeats++; }
    }
    return own > 0 && enemy > 0 ? (enemy / enemySeats) / (own / ownSeats) : 1;
  }
  // The deployment roster is immutable: count each opposing participant once,
  // regardless of their army size, later casualties, or connection status.
  function opponentRatio(roster, team, mode) {
    if (mode !== "regular") return 1;
    const counted = new Set();
    let humans = 0, bots = 0;
    for (const [id, unit] of Object.entries(roster || {})) {
      if (unit.team === undefined || unit.team === team) continue;
      const member = unit.memberId ?? id;
      if (counted.has(member)) continue;
      counted.add(member);
      if (unit.bot) bots++;
      else humans++;
    }
    const total = humans + bots;
    return total ? (humans + bots * 0.5) / total : 1;
  }
  function rewardRatio(roster, team, mode) {
    return strengthRatio(roster, team) * opponentRatio(roster, team, mode);
  }
  return { price, rates, strengthRatio, opponentRatio, rewardRatio, killTechnologyRate };
})();
if (typeof module !== "undefined") module.exports = BattleEconomy;
