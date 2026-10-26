/* 0079 第一页开发目录：客户端展示与服务端编组裁定共用同一份节点数据。 */
"use strict";
const Development = (() => {
  const tree =
    typeof DEVELOPMENT_TREE !== "undefined"
      ? DEVELOPMENT_TREE
      : require("./development-tree.json");
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
    return starterTech[faction] || [];
  }
  function unlockedUnits(faction) {
    if (!unitCache.has(faction)) {
      const active = new Set(unlockedTech(faction));
      const ids = new Set(
        nodes(faction)
          .filter((node) => active.has(node.id))
          .flatMap((node) => node.unlocks),
      );
      unitCache.set(faction, ids);
    }
    return unitCache.get(faction);
  }
  function allows(faction, prefabId) {
    if (faction === "PMC")
      return ["EFSF", "ZEON"].some((side) => unlockedUnits(side).has(prefabId));
    return unlockedUnits(faction).has(prefabId);
  }
  function pointBalance(faction) {
    return Number(progress.points[faction]) || 0;
  }
  function creditAward(award) {
    if (!award || typeof award.id !== "string" || !award.matchId ||
        !["EFSF", "ZEON"].includes(award.faction) ||
        !Number.isInteger(award.points) || award.points < 1 || progress.claimed[award.id])
      return false;
    progress.points[award.faction] = pointBalance(award.faction) + award.points;
    progress.claimed[award.id] = award.matchId;
    try { localStorage.setItem(progressKey, JSON.stringify(progress)); } catch {}
    return true;
  }
  return { nodes, unlockedTech, unlockedUnits, allows, pointBalance, creditAward };
})();
if (typeof module !== "undefined") module.exports = Development;

