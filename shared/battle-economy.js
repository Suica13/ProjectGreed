"use strict";
// Prices are per deployed unit, including its selected kit, never tactical COST.
const BattleEconomy = (() => {
  const rewardMultiplier = 1;
  const roundReward = (value) => Math.max(0, Math.round(value / 25) * 25);
  // Current mode bases are final values; only live event multipliers apply.
  // Pilot experience keeps its existing event and quick-mode multipliers.
  function rewardMultipliers(activity = {}) {
    return Object.fromEntries(
      ["money", "supplies", "technology", "experience"].map((key) => [
        key,
        (key === "experience" ? 1 : rewardMultiplier) * (activity[key] ?? 1),
      ]),
    );
  }
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-data.cjs");
  // Fixed research progress per completed, actively contested match. Independent
  // of army size, unit COST, strength settings and the number of kills/assists.
  function technologyReward(won, mode, activity = 1, formationCost = 1500) {
    return roundReward(
      calculateBattleReward(formationCost).technology *
        (won === null ? 1 : 1.1) *
        (mode === "quick" ? 0.1 : 1) *
        activity,
    );
  }
  const researchFactions = ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"];
  function technologyFactions(model) {
    // Common units retain their source tag and all explicit playable faction tags.
    return [...new Set([...(model.tags || []), ...(model.availableFactions || []), model.faction])]
      .filter((faction) => researchFactions.includes(faction))
      .sort();
  }
  function technologyWeights(roster, memberId, characterFaction) {
    const weights = {};
    for (const record of Object.values(roster || {})) {
      if (record.memberId !== memberId) continue;
      for (const faction of new Set(record.technologyFactions || [])) {
        if (researchFactions.includes(faction)) weights[faction] = (weights[faction] || 0) + 1;
      }
    }
    return weights;
  }
  function allocateTechnology(total, weights, balances, limits) {
    let remaining = total;
    const awards = {};
    let active = Object.entries(weights)
      .filter(
        ([faction, weight]) =>
          researchFactions.includes(faction) && Number.isSafeInteger(weight) && weight > 0,
      )
      .map(([faction, weight]) => ({
        faction,
        weight,
        capacity: Math.max(0, (limits[faction] || 0) - (balances[faction] || 0)),
      }))
      .filter((item) => item.capacity > 0);
    while (remaining > 0 && active.length) {
      const sum = active.reduce((value, item) => value + item.weight, 0);
      const full = active.filter((item) => remaining * item.weight >= item.capacity * sum);
      if (full.length) {
        // Fill every saturated faction, then redistribute the remainder only
        // among the original roster's still-eligible factions.
        for (const item of full) {
          awards[item.faction] = (awards[item.faction] || 0) + item.capacity;
          remaining -= item.capacity;
        }
        active = active.filter((item) => !full.includes(item));
        continue;
      }
      const shares = active.map((item) => ({
        ...item,
        points: Math.floor((remaining * item.weight) / sum),
        remainder: (remaining * item.weight) % sum,
      }));
      let extra = remaining - shares.reduce((value, item) => value + item.points, 0);
      shares.sort(
        (a, b) =>
          b.remainder - a.remainder || (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0),
      );
      for (const item of shares) {
        const points = item.points + (extra-- > 0 ? 1 : 0);
        if (points) awards[item.faction] = (awards[item.faction] || 0) + points;
      }
      remaining = 0;
    }
    return awards;
  }
  function price(modelId, resource = "money") {
    const unitId = modelId.split("__")[0];
    const offer = catalog.licenseOffers[unitId];
    const fallback = catalog.offers[catalog.baseModels[unitId]];
    return offer
      ? (offer[resource] ?? 0)
      : fallback
        ? (fallback[resource] ?? 0) / fallback.quantity
        : 0;
  }
  function rates(faction, mode) {
    const speed = mode === "quick" ? 0.1 : 1;
    return {
      currency: speed,
      experience: speed,
    };
  }
  // Freeze input from the deployed roster, never the room budget or surviving army.
  function teamAverageFormationCost(roster, team) {
    const participants = new Map();
    for (const [id, unit] of Object.entries(roster || {})) {
      if (unit.team !== team) continue;
      const member = unit.memberId ?? unit.seat ?? id;
      participants.set(member, (participants.get(member) || 0) + (unit.cost || 0));
    }
    return participants.size
      ? [...participants.values()].reduce((sum, cost) => sum + cost, 0) / participants.size
      : 0;
  }
  function calculateBattleReward(formationCost) {
    // Preserve the existing 500-COST diminishing staircase, then normalize its
    // 1500..20000 endpoints to the newly requested resource ranges.
    const steps = Math.max(0, Math.floor((Math.min(formationCost, 20000) - 1500) / 500));
    let increment = 0;
    for (let i = 0; i < steps; i++) increment += 250 - 20 * Math.min(5, Math.floor(i / 6));
    const progress = increment / 7350;
    return {
      money: roundReward(2000 + 8000 * progress),
      supplies: roundReward(3000 + 12000 * progress),
      technology: roundReward(500 + 500 * progress),
    };
  }
  function strengthRatio(roster, team) {
    let own = 0,
      enemy = 0,
      ownSeats = 0,
      enemySeats = 0;
    const counted = new Set();
    for (const [id, unit] of Object.entries(roster || {})) {
      if (unit.team === undefined) continue;
      // Each room participant has one strength setting, independent of army size.
      const member = unit.memberId ?? id;
      if (counted.has(member)) continue;
      counted.add(member);
      const strength = unit.performance ?? 1;
      if (unit.team === team) {
        own += strength;
        ownSeats++;
      } else {
        enemy += strength;
        enemySeats++;
      }
    }
    return own > 0 && enemy > 0 ? enemy / enemySeats / (own / ownSeats) : 1;
  }
  // The deployment roster is immutable: count each opposing participant once,
  // regardless of their army size, later casualties, or connection status.
  function opponentRatio(roster, team, mode) {
    if (!["regular", "quick"].includes(mode)) return 1;
    const counted = new Set();
    let humans = 0,
      bots = 0;
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
  // Sum the authoritative receipts, not wallet differences or only the final payout.
  // This is presentation data: the original receipts remain the only credit operation.
  function rewardTotals(economyAwards = [], techAwards = [], matchId = null) {
    const totals = { money: 0, supplies: 0, technology: 0 };
    const number = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
    function receipts(awards, add) {
      const seen = new Set();
      for (const award of awards || []) {
        if (!award || (matchId && award.matchId && award.matchId !== matchId)) continue;
        const key = award.id ? JSON.stringify([award.matchId || matchId, award.id]) : null;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        add(award);
      }
    }
    receipts(economyAwards, (award) => {
      totals.money += number(award.money);
      totals.supplies += number(award.supplies);
    });
    receipts(techAwards, (award) => (totals.technology += number(award.points)));
    return totals;
  }
  return {
    rewardMultiplier,
    roundReward,
    rewardMultipliers,
    price,
    rates,
    calculateBattleReward,
    teamAverageFormationCost,
    strengthRatio,
    opponentRatio,
    rewardRatio,
    rewardTotals,
    technologyReward,
    technologyFactions,
    technologyWeights,
    allocateTechnology,
  };
})();
if (typeof module !== "undefined") module.exports = BattleEconomy;
