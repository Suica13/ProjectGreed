/* 0079 第一页开发目录：客户端展示与服务端编组裁定共用同一份节点数据。 */
"use strict";
const Development = (() => {
  const economy = typeof Economy !== "undefined" ? Economy : require("./economy.js");
  const tree =
    typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const starterTech = {
    // 原 MOD 的起始科技；61式和飞鳐都由联邦基础科技解锁。
    EFSF: ["Tech_EFSF_0079_BaseTech"],
    ZEON: ["Tech_ZEON_0079_BaseTech"],
  };
  const unitCache = new Map();
  const progressKey = "projectgreed.developmentProgress.v1";
  let progress = { points: { EFSF: 0, ZEON: 0 }, claimed: {} };
  if (typeof localStorage !== "undefined") {
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey) || "null");
      if (saved?.points && saved?.claimed) progress = saved;
    } catch {}
  }

  function nodes(faction) {
    return tree[faction] || [];
  }
  function unlockedTech(faction) {
    return normalizeResearch(progress.researched)[faction] || [];
  }
  function normalizeResearch(value = {}) {
    const result = { units: {} };
    for (const faction of ["EFSF", "ZEON"]) {
      const requested = new Set(Array.isArray(value?.[faction]) ? value[faction] : []);
      const active = new Set(starterTech[faction]);
      for (let pass = 0; pass < nodes(faction).length; pass++)
        for (const node of nodes(faction))
          if (requested.has(node.id) && node.requires.every((id) => active.has(id)))
            active.add(node.id);
      result[faction] = [...active];
      const knownUnits = new Set(nodes(faction).flatMap((node) => node.unlocks));
      result.units[faction] = [
        ...new Set(Array.isArray(value?.units?.[faction]) ? value.units[faction] : []),
      ].filter((id) => knownUnits.has(id));
    }
    return result;
  }
  function research(faction, id) {
    const node = nodes(faction).find((node) => node.id === id);
    const active = new Set(unlockedTech(faction));
    if (
      !node ||
      active.has(id) ||
      !node.requires.every((id) => active.has(id)) ||
      pointBalance(faction) < node.points ||
      !economy.affordable(node)
    )
      return false;
    const next = {
      ...progress,
      points: { ...progress.points, [faction]: pointBalance(faction) - node.points },
      researched: { ...normalizeResearch(progress.researched), [faction]: [...active, id] },
    };
    if (!economy.transact(node, {}, [[progressKey, JSON.stringify(next)]])) return false;
    progress = next;
    unitCache.clear();
    return true;
  }
  // Rewards/scripts may grant a specific unit; there is deliberately no individual research UI.
  function grantUnit(faction, unitId) {
    const researched = normalizeResearch(progress.researched);
    if (
      !researched.units[faction] ||
      !nodes(faction).some((node) => node.unlocks.includes(unitId)) ||
      researched.units[faction].includes(unitId)
    )
      return false;
    researched.units[faction].push(unitId);
    const next = { ...progress, researched };
    if (typeof localStorage !== "undefined")
      localStorage.setItem(progressKey, JSON.stringify(next));
    progress = next;
    unitCache.clear();
    return true;
  }
  function receiveActivity(award) {
    const next = exportProgress();
    for (const id of award.unlockUnits || []) {
      const faction = ["EFSF","ZEON"].find(group=>nodes(group).some(node=>node.unlocks.includes(id)));
      if (!faction) throw Error("活动开发奖励无效："+id);
      if (!next.researched.units[faction].includes(id)) next.researched.units[faction].push(id);
    }
    if (!economy.creditActivity(award,[[progressKey,JSON.stringify(next)]])) return false;
    progress = next;
    unitCache.clear();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("development-changed"));
    return true;
  }
  function researchSnapshot() {
    return normalizeResearch(progress.researched);
  }
  function unlockedUnits(faction) {
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
    if (researched !== undefined) {
      const active = normalizeResearch(researched);
      return (faction === "PMC" ? ["EFSF", "ZEON"] : [faction]).some(
        (side) =>
          active.units[side]?.includes(prefabId) ||
          nodes(side).some(
            (node) => active[side]?.includes(node.id) && node.unlocks.includes(prefabId),
          ),
      );
    }
    if (faction === "PMC")
      return ["EFSF", "ZEON"].some((side) => unlockedUnits(side).has(prefabId));
    return unlockedUnits(faction).has(prefabId);
  }
  function pointBalance(faction) {
    return Number(progress.points[faction]) || 0;
  }
  function creditAward(award) {
    if (
      !award ||
      typeof award.id !== "string" ||
      !award.matchId ||
      !["EFSF", "ZEON"].includes(award.faction) ||
      !Number.isInteger(award.points) ||
      award.points < 1 ||
      progress.claimed[award.id]
    )
      return false;
    progress.points[award.faction] = pointBalance(award.faction) + award.points;
    progress.claimed[award.id] = award.matchId;
    try {
      localStorage.setItem(progressKey, JSON.stringify(progress));
    } catch {}
    return true;
  }
  function validateProgress(value) {
    if (!value || typeof value !== "object" || !value.points || !value.claimed)
      throw Error("科技进度无效");
    const points = {},
      claimed = {};
    for (const faction of ["EFSF", "ZEON"]) {
      if (!Number.isSafeInteger(value.points[faction]) || value.points[faction] < 0)
        throw Error("科技点余额无效");
      points[faction] = value.points[faction];
    }
    for (const [id, match] of Object.entries(value.claimed)) {
      if (typeof match !== "string" || id.length > 200 || match.length > 200)
        throw Error("科技奖励记录无效");
      Object.defineProperty(claimed, id, { value: match, enumerable: true });
    }
    return { points, claimed, researched: normalizeResearch(value.researched) };
  }
  function exportProgress() {
    return validateProgress(progress);
  }
  return {
    exportProgress,
    validateProgress,
    nodes,
    unlockedTech,
    unlockedUnits,
    allows,
    pointBalance,
    creditAward,
    research,
    researchSnapshot,
    normalizeResearch,
    grantUnit,
    receiveActivity,
  };
})();
if (typeof module !== "undefined") module.exports = Development;
