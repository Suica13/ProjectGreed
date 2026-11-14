/* 0079 早期／后期与0083开发目录：客户端展示与服务端编组裁定共用同一份节点数据。 */
"use strict";
const Development = (() => {
  const saveCodec = typeof SaveCodec !== "undefined" ? SaveCodec : require("./save-codec.js");
  const economy = typeof Economy !== "undefined" ? Economy : require("./economy.js");
  const tree =
    typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const factions = Object.keys(tree);
  const laterFactions = ["AEUG", "TITANS", "NEO_ZEON"];
  // Alternatives are OR; each required tree must have its whole middle branch complete.
  const treePrerequisites = {
    AEUG: ["EFSF"],
    TITANS: ["EFSF"],
    NEO_ZEON: ["ZEON"],
    EFSF_0093: ["AEUG", "TITANS"],
    NEO_ZEON_0093: ["NEO_ZEON"],
  };
  const starterTech = {
    // 原 MOD 的起始科技；61式和飞鳐都由联邦基础科技解锁。
    EFSF: ["Tech_EFSF_0079_BaseTech"],
    ZEON: ["Tech_ZEON_0079_BaseTech"],
    OMNI: ["Tech_OMNI_CE71_BaseTech"],
    ZAFT: ["Tech_ZAFT_CE71_BaseTech"],
    EFSF_0093: ["Tech_0093_EFSF_BaseTech"],
    NEO_ZEON_0093: ["Tech_0093_NZN_BaseTech"],
  };
  const unitCache = new Map();
  const aces =
    (typeof PILOT_DATA !== "undefined" ? PILOT_DATA : require("./pilots.json")).aces || [];
  const progressKey = "projectgreed.developmentProgress.v1";
  let progress = { points: { EFSF: 0, ZEON: 0 }, claimed: {} };
  if (typeof localStorage !== "undefined") {
    try {
      const saved = saveCodec.parse(localStorage.getItem(progressKey) || "null");
      if (saved?.points && saved?.claimed) progress = saved;
    } catch {}
  }

  let localResearchSource, localResearchCache;
  function currentResearch() {
    if (!localResearchCache || localResearchSource !== progress.researched) {
      localResearchSource = progress.researched;
      localResearchCache = normalizeResearch(progress.researched);
    }
    return localResearchCache;
  }
  function nodes(faction) {
    return tree[faction] || [];
  }
  const unitThresholds = new Map();
  function allowsPointCaps(unitId, caps) {
    if (!caps) return true;
    if (!unitThresholds.has(unitId)) {
      const thresholds = [];
      for (const faction of factions) {
        const byId = new Map(nodes(faction).map((node) => [node.id, node]));
        const requirement = (node, seen = new Set()) => {
          if (seen.has(node.id)) return Infinity;
          const visited = new Set(seen).add(node.id);
          return Math.max(
            node.points || 0,
            ...node.requires.map((id) =>
              byId.has(id) ? requirement(byId.get(id), visited) : Infinity,
            ),
          );
        };
        for (const node of nodes(faction))
          if (node.unlocks.includes(unitId)) thresholds.push([faction, requirement(node)]);
      }
      unitThresholds.set(unitId, thresholds);
    }
    return unitThresholds.get(unitId).some(([faction, points]) => points <= (caps[faction] || 0));
  }
  function unlockedTech(faction) {
    return [...(currentResearch()[faction] || [])];
  }
  function completedMainline(faction, value) {
    const mainline = nodes(faction).filter(node => node.row === "mid" && !node.placeholder);
    const active = new Set(value?.[faction] || []);
    return mainline.length > 0 && mainline.every(node => active.has(node.id));
  }
  function treeAccessible(faction, value) {
    return !treePrerequisites[faction] ||
      treePrerequisites[faction].some(required => completedMainline(required, value));
  }
  function normalizeResearch(value = {}, { includeLocked = false } = {}) {
    const result = { units: {} };
    for (const faction of factions) {
      result[faction] = [];
      const knownUnits = new Set([
        ...nodes(faction).flatMap((node) => node.unlocks),
        ...aces.filter((p) => p.faction === faction).map((p) => p.id),
      ]);
      result.units[faction] = [
        ...new Set(Array.isArray(value?.units?.[faction]) ? value.units[faction] : []),
      ].filter((id) => knownUnits.has(id));
    }
    // Resolve the dependency graph independently of the order of factions in the JSON.
    for (let stage = 0; stage < factions.length; stage++) {
      let changed = false;
      for (const faction of factions) {
        if (!includeLocked && !treeAccessible(faction, result)) continue;
        const requested = new Set(Array.isArray(value?.[faction]) ? value[faction] : []);
        const active = new Set(result[faction]);
        const start = starterTech[faction] || ["Tech_" + faction + "_0087_BaseTech"];
        for (const id of start) if (nodes(faction).some(node => node.id === id)) active.add(id);
        for (let pass = 0; pass < nodes(faction).length; pass++) {
          const before = active.size;
          for (const node of nodes(faction))
            if (requested.has(node.id) && node.requires.every(id => active.has(id))) active.add(node.id);
          if (active.size === before) break;
        }
        if (active.size !== result[faction].length) changed = true;
        result[faction] = [...active];
      }
      if (!changed) break;
    }
    return result;
  }
  function mainlineComplete(faction, value) {
    return completedMainline(faction, value === undefined ? currentResearch() : normalizeResearch(value));
  }
  function hasCompleted0079(value = progress.researched) {
    const active = normalizeResearch(value);
    return ["EFSF", "ZEON"].some(faction => completedMainline(faction, active));
  }
  function eraLocked(faction, value) {
    return !treeAccessible(faction, value === undefined ? currentResearch() : normalizeResearch(value));
  }
  // Room-only AI progression: union each participant's active-faction research, then mirror the furthest
  // main-line column (page first) across both factions and all three lanes.
  // Explicit branch/event unlocks remain in the union but cannot advance the main line.
  function aiResearch(researches = []) {
    const union = { units: {} };
    for (const faction of factions) {
      union[faction] = new Set();
      union.units[faction] = new Set();
    }
    for (const group of [["EFSF", "ZEON"], laterFactions]) {
      let stage = [0, 1];
      for (const value of researches) {
        const clean = normalizeResearch(value?.researched ?? value);
        const character = value?.characterFaction;
        const activeFactions = factions.includes(character)
          ? group.includes(character)
            ? [character]
            : []
          : group;
        for (const faction of activeFactions) {
          for (const id of clean[faction]) union[faction].add(id);
          for (const id of clean.units[faction]) union.units[faction].add(id);
          for (const node of nodes(faction)) {
            if (node.row !== "mid" || !clean[faction].includes(node.id)) continue;
            const next = [node.page || 0, node.column];
            if (next[0] > stage[0] || (next[0] === stage[0] && next[1] > stage[1])) stage = next;
          }
        }
        // An 0087 participant necessarily completed one legacy tree. Carry that gate proof
        // without treating its columns as 0087 progression.
        if (laterFactions.includes(character))
          for (const legacy of ["EFSF", "ZEON"])
            if (completedMainline(legacy, clean))
              for (const id of clean[legacy]) union[legacy].add(id);
      }
      for (const faction of group)
        for (const node of nodes(faction))
          if (
            (node.page || 0) < stage[0] ||
            ((node.page || 0) === stage[0] && node.column <= stage[1])
          )
            union[faction].add(node.id);
    }
    for (const faction of factions) {
      union[faction] = [...union[faction]].sort();
      union.units[faction] = [...union.units[faction]].sort();
    }
    return normalizeResearch(union);
  }
  function research(faction, id) {
    const node = nodes(faction).find((node) => node.id === id);
    const active = new Set(unlockedTech(faction));
    if (
      eraLocked(faction) ||
      !node ||
      active.has(id) ||
      !node.requires.every((id) => active.has(id)) ||
      pointBalance(faction) < node.points
    )
      return false;
    const next = {
      ...progress,
      points: { ...progress.points },
      researched: { ...normalizeResearch(progress.researched, { includeLocked: true }), [faction]: [...active, id] },
    };
    if (!economy.transact({}, {}, [[progressKey, saveCodec.stringify(next)]])) return false;
    progress = next;
    unitCache.clear();
    return true;
  }
  // Rewards/scripts may grant a specific unit; there is deliberately no individual research UI.
  function grantUnit(faction, unitId) {
    const researched = normalizeResearch(progress.researched, { includeLocked: true });
    if (
      !researched.units[faction] ||
      !(
        nodes(faction).some((node) => node.unlocks.includes(unitId)) ||
        aces.some((p) => p.id === unitId && p.faction === faction)
      ) ||
      researched.units[faction].includes(unitId)
    )
      return false;
    researched.units[faction].push(unitId);
    const next = { ...progress, researched };
    if (typeof localStorage !== "undefined")
      localStorage.setItem(progressKey, saveCodec.stringify(next));
    progress = next;
    unitCache.clear();
    return true;
  }
  function receiveActivity(award) {
    const next = exportProgress();
    for (const id of [...(award.unlockUnits || []), ...(award.unlockAces || [])]) {
      const faction =
        aces.find((p) => p.id === id)?.faction ||
        factions.find((group) => nodes(group).some((node) => node.unlocks.includes(id)));
      if (!faction) throw Error("活动开发奖励无效：" + id);
      if (!next.researched.units[faction].includes(id)) next.researched.units[faction].push(id);
    }
    if (!economy.creditActivity(award, [[progressKey, saveCodec.stringify(next)]])) return false;
    progress = next;
    unitCache.clear();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("development-changed"));
    return true;
  }
  function researchSnapshot() {
    return normalizeResearch(progress.researched);
  }
  function unlockedUnits(faction) {
    if (eraLocked(faction)) return new Set();
    if (!unitCache.has(faction)) {
      const active = new Set(unlockedTech(faction));
      const ids = new Set(
        nodes(faction)
          .filter((node) => active.has(node.id))
          .flatMap((node) => node.unlocks),
      );
      for (const id of normalizeResearch(progress.researched).units[faction] || []) ids.add(id);
      unitCache.set(faction, ids);
    }
    return unitCache.get(faction);
  }
  function allows(faction, prefabId, researched) {
    const ace = aces.find((p) => p.id === prefabId);
    if (ace) {
      if (faction !== "PMC" && !(ace.availableFactions || [ace.faction]).includes(faction))
        return false;
      faction = ace.faction;
    }
    if (researched !== undefined) {
      const active = normalizeResearch(researched);
      return (faction === "PMC" ? factions : [faction]).some(
        (side) =>
          treeAccessible(side, active) &&
          (active.units[side]?.includes(prefabId) ||
            nodes(side).some(
              (node) => active[side]?.includes(node.id) && node.unlocks.includes(prefabId),
            )),
      );
    }
    if (faction === "PMC") return factions.some((side) => unlockedUnits(side).has(prefabId));
    return unlockedUnits(faction).has(prefabId);
  }
  function normalizeTechnologyPoints(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("科技点无效");
    const result = {};
    for (const faction of factions) {
      const points = value[faction] ?? 0;
      if (!Number.isSafeInteger(points) || points < 0) throw Error("科技点无效：" + faction);
      result[faction] = points;
    }
    return result;
  }
  function maximumPoints(faction) {
    return Math.max(0, ...nodes(faction).map((node) => node.points));
  }
  function pointSnapshot() {
    return normalizeTechnologyPoints(progress.points);
  }
  function pointBalance(faction) {
    return Number(progress.points[faction]) || 0;
  }
  function creditAward(award) {
    if (
      !award ||
      typeof award.id !== "string" ||
      !award.matchId ||
      !factions.includes(award.faction) ||
      !Number.isInteger(award.points) ||
      award.points < 1 ||
      progress.claimed[award.id]
    )
      return false;
    progress.points[award.faction] = pointBalance(award.faction) + award.points;
    progress.claimed[award.id] = award.matchId;
    try {
      localStorage.setItem(progressKey, saveCodec.stringify(progress));
    } catch {}
    return true;
  }
  function validateProgress(value) {
    if (!value || typeof value !== "object" || !value.points || !value.claimed)
      throw Error("科技进度无效");
    const points = {},
      claimed = {};
    for (const faction of factions) {
      const balance = value.points[faction] ?? 0;
      if (!Number.isSafeInteger(balance) || balance < 0) throw Error("科技点余额无效");
      points[faction] = balance;
    }
    for (const [id, match] of Object.entries(value.claimed)) {
      if (typeof match !== "string" || id.length > 200 || match.length > 200)
        throw Error("科技奖励记录无效");
      Object.defineProperty(claimed, id, { value: match, enumerable: true });
    }
    return { points, claimed, researched: normalizeResearch(value.researched, { includeLocked: true }) };
  }
  function exportProgress() {
    return validateProgress(progress);
  }
  return {
    factions,
    allowsPointCaps,
    hasCompleted0079,
    mainlineComplete,
    treePrerequisites,
    eraLocked,
    exportProgress,
    validateProgress,
    nodes,
    unlockedTech,
    unlockedUnits,
    allows,
    pointBalance,
    pointSnapshot,
    normalizeTechnologyPoints,
    maximumPoints,
    creditAward,
    research,
    researchSnapshot,
    normalizeResearch,
    aiResearch,
    grantUnit,
    receiveActivity,
  };
})();
if (typeof module !== "undefined") module.exports = Development;
