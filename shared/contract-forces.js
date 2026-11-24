"use strict";
const ContractForces = (() => {
  const data =
    typeof CONTRACT_FORCE_POOLS !== "undefined"
      ? CONTRACT_FORCE_POOLS
      : require("./contract-force-pools.json");
  const caches = new WeakMap();
  function aiKitAllowed(model) {
    return !/nuclear|nuke|核弹|核爆/i.test(model.kitId || "") &&
      !(model.weapons || []).some(w => /nuclear|nuke|核弹|核爆/i.test([w.id,w.name,w.category,w.special?.type].join(" "))) &&
      !(model.skills || []).some(s => /nuclear|nuke|核弹|核爆/i.test([s.id,s.type,s.name].join(" ")));
  }
  function profile(settings) {
    const source = settings.sweepEra === data.era ? data : data.eras?.[settings.sweepEra];
    if (!source || settings.sweepEnvironment !== source.environment)
      return null;
    return source.factions[settings.sweepFaction]?.[settings.sweepDifficulty] || null;
  }
  function formations(settings, G) {
    const level = profile(settings);
    if (!level) return null;
    let cache = caches.get(G.catalog);
    if (!cache) caches.set(G.catalog, (cache = new Map()));
    const key = settings.sweepEra + ":" + settings.sweepFaction + ":" + settings.sweepDifficulty;
    if (!cache.has(key)) {
      const models = Object.values(G.models);
      cache.set(
        key,
        level.formations
          .map((formation) => ({
            ...formation,
            kits: formation.units.map((id) => {
              const kits = models.filter(
                (m) =>
                  m.prefabId === id &&
                  !m.formOnly &&
                  !m.wip &&
                  !m.requiredPilotId &&
                  !m.facility &&
                  !m.ship &&
                  aiKitAllowed(m) &&
                  G.aiTechnologyAllows(m, settings.sweepFaction) &&
                  !(G.aiUnitBans?.sweep || []).includes(id) &&
                  m.tags?.includes(settings.sweepEra) &&
                  (m.availableFactions || [m.faction]).includes(settings.sweepFaction) &&
                  ((m.adaptability.ground || 0) >= 100 || (m.adaptability.air || 0) >= 100),
              );
              if (!models.some((m) => m.prefabId === id))
                throw Error("合约部队池单位不存在：" + id);
              return kits;
            }),
          }))
          .filter((formation) => formation.kits.every((kits) => kits.length)),
      );
    }
    return cache.get(key);
  }
  function weighted(values, rng) {
    let roll = rng() * values.reduce((sum, item) => sum + item.weight, 0);
    return values.find((item) => (roll -= item.weight) < 0) || values[values.length - 1];
  }
  // A draw is always a whole configured formation. Unspent budget is discarded;
  // neither a cap nor an incompatible transport may turn it into isolated units.
  function draw(
    settings,
    G,
    rng,
    budget,
    slots = Infinity,
    allows = () => true,
    capacity = Infinity,
  ) {
    const source = formations(settings, G);
    if (!source) return null;
    const result = [];
    let remaining = budget,
      space = slots,
      cargoSpace = capacity;
    while (remaining > 0 && space > 0) {
      const eligible = source
        .map((f) => ({ ...f, kits: f.kits.map((kits) => kits.filter(allows)) }))
        .filter(
          (f) =>
            f.budget <= remaining &&
            f.units.length <= space &&
            f.kits.every((kits) => kits.length) &&
            f.kits.reduce(
              (sum, kits) => sum + Math.max(...kits.map((m) => m.transport?.slotCost || 1)),
              0,
            ) <= cargoSpace,
        );
      if (!eligible.length) break;
      const formation = weighted(eligible, rng);
      const models = formation.kits.map((kits) => kits[Math.floor(rng() * kits.length)]);
      result.push({ budget: formation.budget, models });
      remaining -= formation.budget;
      space -= models.length;
      cargoSpace -= models.reduce((sum, m) => sum + (m.transport?.slotCost || 1), 0);
    }
    return result;
  }
  function pick(settings, G, rng, allows = () => true) {
    const source = formations(settings, G);
    if (!source) return null;
    const available = source.filter((f) => f.kits.some((kits) => kits.some(allows)));
    if (!available.length) throw Error("合约部队池没有符合条件的单位");
    const formation = weighted(available, rng),
      kits = formation.kits.filter((kits) => kits.some(allows));
    const variants = kits[Math.floor(rng() * kits.length)].filter(allows);
    return variants[Math.floor(rng() * variants.length)];
  }
  const difficultyScale = difficulty => [1, 1, 1.1, 1.15, 1.15, 1.15][Number(difficulty) - 1] || 1;
  function budget(room, amount, reinforcement = false) {
    const players = room.game.contract.players;
    // Explicit per-event budgets supersede the old generic head-count tuning.
    // Only the shared multiplayer multiplier remains; never scale heads again.
    const multiplier = 1 + 0.25 * Math.max(0, players - 1);
    // Use integer percentages so a half-step cannot drift below the rounding boundary.
    const percent = Math.round(difficultyScale(room.settings.sweepDifficulty) * 100);
    return Math.round(amount * multiplier * percent / 2500) * 25;
  }
  return { profile, formations, draw, pick, budget, aiKitAllowed, difficultyScale };
})();
if (typeof module !== "undefined") module.exports = ContractForces;
