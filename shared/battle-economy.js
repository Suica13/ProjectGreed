"use strict";
// Prices are per deployed unit, including its selected kit, never tactical COST.
const BattleEconomy = (() => {
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-catalog.json");
  function price(modelId, resource = "money") {
    const unitId = modelId.split("__")[0];
    const offer = catalog.offers[modelId] || catalog.offers[catalog.baseModels[unitId]];
    return offer ? (offer[resource] ?? 0) / offer.quantity : 0;
  }
  function rates(faction, mode) {
    const speed = mode === "quick" ? 0.1 : 1;
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
  return { price, rates, strengthRatio };
})();
if (typeof module !== "undefined") module.exports = BattleEconomy;
