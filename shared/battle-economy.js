"use strict";
// Prices are per deployed unit, including its selected kit, never tactical COST.
const BattleEconomy = (() => {
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-catalog.json");
  function price(modelId) {
    const unitId = modelId.split("__")[0];
    const offer = catalog.offers[modelId] || catalog.offers[catalog.baseModels[unitId]];
    return offer ? offer.money / offer.quantity : 0;
  }
  function rates(faction, mode) {
    const speed = mode === "quick" ? 0.1 : 1;
    return {
      currency: (faction === "PMC" ? 1 : 0.5) * speed,
      technology: (faction === "PMC" ? 0.5 : 1) * speed,
      experience: speed,
    };
  }
  return { price, rates };
})();
if (typeof module !== "undefined") module.exports = BattleEconomy;
