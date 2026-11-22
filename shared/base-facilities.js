/* Personal facilities, unlocks and stock limits. No map or deployment state. */
const BaseFacilities = (() => {
  const art =
    typeof BASE_FACILITY_TYPES !== "undefined"
      ? BASE_FACILITY_TYPES
      : require("./base-facility-types.json");
  const definitions = {
    hq: { name: "HQ", maxLevel: 5, description: "HQ等级决定其他建筑的等级上限。" },
    factory: { name: "工厂", maxLevel: 5, description: "一级提供20个单位格纳库，之后每级增加10格。" },
    giantFactory: { name: "巨型工厂", maxLevel: 5, description: "一级提供6个舰船格纳库，之后每级增加4格。" },
    beacon: {
      name: "信标",
      maxLevel: 3,
      description: "一级提供一般PMC驾驶员，二级解锁ACE驾驶员招募。",
    },
    academy: { name: "士官学院", maxLevel: 5, description: "每级分别支持10名PMC驾驶员和10名ACE驾驶员；驾驶员等级上限依次为3、4、6、8、12级，5级开放转生。" },
  };
  const initial = () => ({
    version: 2,
    levels: Object.fromEntries(Object.keys(definitions).map((id) => [id, 1])),
  });
  function normalize(value, storage = null) {
    const result = initial();
    if (value?.version === 2) {
      for (const [id, def] of Object.entries(definitions)) {
        const n = value.levels?.[id];
        if (!Number.isInteger(n) || n < 1 || n > def.maxLevel) throw Error("设施等级无效");
        result.levels[id] = n;
      }
      if (Object.entries(result.levels).some(([id, n]) => id !== "hq" && n > result.levels.hq))
        throw Error("设施等级不能超过HQ等级");
    } else if (value != null && value.version !== 1) throw Error("设施存档版本无效");
    else if (storage) {
      // Preserve pre-facility stock and its purchased/unlocked capacity. Map
      // coordinates, deployed actors and decorative structures are discarded.
      const unitSlots = storage.slots?.units ?? (storage.pages?.units || 1) * 8;
      const shipSlots = storage.slots?.ships ?? (storage.pages?.ships || 1) * 3;
      result.levels.factory = Math.min(5, Math.max(1, Math.ceil(unitSlots / 10) - 1));
      result.levels.giantFactory = Math.min(5, Math.max(1, Math.ceil(shipSlots / 4)));
      result.levels.hq = Math.max(result.levels.factory, result.levels.giantFactory);
    }
    return result;
  }
  const capacity = (state) => ({
    units: (state.levels.factory + 1) * 10,
    ships: state.levels.giantFactory * 4 + 2,
  });
  const pilotLimit = (state) => state.levels.academy * 10;
  const crewLevel = (grade) =>
    ({ general: 1, ace: 2 })[grade] ?? Infinity;
  const canRecruit = (state, grade) => state.levels.beacon >= crewLevel(grade);
  function unlock(id, level) {
    if (id === "hq") return "其他建筑等级上限 " + level;
    if (id === "factory") return "单位格纳库 " + (level + 1) * 10 + " 格";
    if (id === "giantFactory") return "舰船格纳库 " + (level * 4 + 2) + " 格";
    if (id === "academy") return "PMC／ACE驾驶员各 " + level * 10 + " 名 · 等级上限 " + [3,4,6,8,12][level-1] + (level===5?" · 开放转生":"");
    return level === 1
      ? "一般PMC驾驶员（免费配属）"
      : level === 2
        ? "解锁ACE驾驶员招募"
        : "更多功能开发中";
  }
  function upgradeOffer(state, id) {
    const def = definitions[id];
    if (!def) throw Error("建筑不存在");
    const current = state.levels[id],
      next = current + 1;
    return {
      current,
      next,
      max: current >= def.maxLevel,
      hqRequired: id !== "hq" && next > state.levels.hq,
      condition: "开发中",
      money: null,
      supplies: null,
      available: false,
    };
  }
  return {
    definitions,
    art,
    initial,
    normalize,
    capacity,
    pilotLimit,
    canRecruit,
    crewLevel,
    unlock,
    upgradeOffer,
  };
})();
if (typeof module !== "undefined") module.exports = BaseFacilities;
