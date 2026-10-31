/* Personal wallet and permanent deployment licenses; old inventory migrates once. */
"use strict";
const Economy = (() => {
  const key = "projectgreed.economy.v1";
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-catalog.json");
  let kitModels;
  function modelsForUnits() {
    return (kitModels ||=
      typeof ART !== "undefined"
        ? ART.models
        : require("../tools/load-catalog.cjs").loadCatalog().models);
  }
  const initial = () => ({
    schemaVersion: 2,
    money: 5000,
    supplies: 10000,
    licenses: Object.fromEntries(
      ["Type61", "FF_B2", "Medea", "MS_06F", "MS_06S", "FatUncle"].map((id) => [id, true]),
    ),
  });
  function validate(value) {
    if (value === undefined) return initial();
    if (
      !value ||
      !Number.isSafeInteger(value.money) ||
      value.money < 0 ||
      !Number.isSafeInteger(value.supplies) ||
      value.supplies < 0
    )
      throw Error("资金、物资或部署许可无效");
    if (Object.hasOwn(value, "inventory") || Object.hasOwn(value, "kits"))
      throw Error("旧库存格式必须先转换为部署许可");
    const owned = value.licenses;
    if (!owned || typeof owned !== "object" || Array.isArray(owned)) throw Error("部署许可无效");
    const licenses = {};
    for (const [id, amount] of Object.entries(owned)) {
      if (typeof amount !== "boolean")
        throw Error("部署许可无效: " + id);
      const unitId = id;
      if (
        !Object.hasOwn(catalog.baseModels, unitId) &&
        !Object.values(modelsForUnits()).some((model) => model.prefabId === unitId)
      )
        throw Error("存档包含当前版本不支持的单位: " + id);
      if (amount) licenses[unitId] = true;
    }
    const claimed = {};
    if (value.claimed !== undefined) {
      if (!value.claimed || typeof value.claimed !== "object" || Array.isArray(value.claimed))
        throw Error("战斗奖励记录无效");
      for (const [id, match] of Object.entries(value.claimed)) {
        if (!id || id.length > 200 || typeof match !== "string" || match.length > 200)
          throw Error("战斗奖励记录无效");
        Object.defineProperty(claimed, id, { value: match, enumerable: true });
      }
    }
    return {
      money: value.money,
      supplies: value.supplies,
      schemaVersion: 2,
      licenses,
      ...(Object.keys(claimed).length ? { claimed } : {}),
    };
  }
  let state = initial(),
    storageError = null;
  if (typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        const migrations = typeof ProfileMigrations !== "undefined"
          ? ProfileMigrations : require("./profile-migrations.js");
        state = validate(migrations.economy(parsed));
        if (parsed.schemaVersion !== 2 || parsed.licenses === undefined) {
          const backupKey = key + ".before-deployment-licenses";
          if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, saved);
          localStorage.setItem(key, JSON.stringify(state));
        }
      }
    } catch (error) {
      storageError = error;
      // Preserve the original before any recovery/new-profile action.
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null && localStorage.getItem(key + ".recovery-backup") === null)
          localStorage.setItem(key + ".recovery-backup", raw);
      } catch {}
    }
  }
  function errorMessage(error) {
    if (error?.name === "QuotaExceededError") return "浏览器本地存储空间不足，未保存本次更改。";
    if (error?.name === "SecurityError")
      return "当前预览禁止访问本地存储，请在 Edge 或 Chrome 中打开此客户端页面。";
    if (error?.name === "SyntaxError") return "经济存档无法解析，请导入有效的个人存档。";
    return error?.message || String(error);
  }
  function snapshot() {
    // State is normalized on load/commit. UI reads must not rerun migrations
    // or fail halfway through menu initialization.
    return structuredClone(state);
  }
  function exportProgress() {
    if (storageError) throw storageError;
    return structuredClone(state);
  }
  function affordable(cost) {
    return ["money", "supplies"].every(
      (k) =>
        Number.isSafeInteger(cost[k] ?? 0) && (cost[k] ?? 0) >= 0 && state[k] >= (cost[k] ?? 0),
    );
  }
  // Persist the wallet, licenses and optional research progress as one rollback-able change.
  // Memory is only updated after every storage write succeeds.
  function transact(cost, licenses = {}, extraWrites = []) {
    if (storageError) throw storageError;
    if (!affordable(cost)) return false;
    const next = snapshot();
    next.money -= cost.money ?? 0;
    next.supplies -= cost.supplies ?? 0;
    for (const [id, owned] of Object.entries(licenses)) {
      if (owned !== true) throw Error("部署许可必须为true");
      next.licenses[id] = true;
    }
    return commit(next, extraWrites);
  }
  function commit(next, extraWrites = []) {
    if (storageError) throw storageError;
    next = validate(next);
    if (typeof localStorage !== "undefined") {
      const writes = [[key, JSON.stringify(next)], ...extraWrites];
      const previous = writes.map(([k]) => [k, localStorage.getItem(k)]);
      try {
        for (const [k, v] of writes) localStorage.setItem(k, v);
      } catch (error) {
        for (const [k, v] of previous) {
          try {
            v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
          } catch {}
        }
        throw error;
      }
    }
    state = next;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("economy-changed"));
    return true;
  }
  function creditAward(award) {
    if (
      !award ||
      typeof award.id !== "string" ||
      !award.id ||
      !award.matchId ||
      Object.hasOwn(state.claimed || {}, award.id)
    )
      return false;
    if (![award.money, award.supplies].every((n) => Number.isSafeInteger(n) && n >= 0))
      throw Error("战斗资源奖励无效");
    const next = snapshot();
    next.money += award.money;
    next.supplies += award.supplies;
    // Battle damage is a match record; permanent deployment licenses cannot be lost.
    next.claimed = { ...next.claimed, [award.id]: award.matchId };
    return commit(next);
  }
  function creditActivity(award, extraWrites = []) {
    if (!award?.id || !award.matchId || Object.hasOwn(state.claimed || {}, award.id)) return false;
    if (![award.money, award.supplies].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw Error("活动货币奖励无效");
    const next = snapshot();
    next.money += award.money;
    next.supplies += award.supplies;
    if (award.inventory !== undefined) throw Error("活动奖励仅支持部署许可");
    for (const [id, owned] of Object.entries(award.licenses || {})) {
      if (!Object.hasOwn(catalog.baseModels, id) || owned !== true)
        throw Error("活动单位奖励无效");
      next.licenses[id] = true;
    }
    next.claimed = { ...next.claimed, [award.id]: award.matchId };
    return commit(next, extraWrites);
  }
  function baseModel(unitId) {
    return catalog.baseModels[unitId] || null;
  }
  function defaultKit(unitId) {
    return catalog.defaultKits?.[unitId] || baseModel(unitId)?.slice(unitId.length + 2) || null;
  }
  function licenseOffer(unitId) {
    return catalog.licenseOffers[unitId] || null;
  }
  function available(offer, faction) {
    if (
      !offer ||
      !["PMC", "EFSF", "ZEON"].includes(faction) ||
      (faction !== "PMC" && !(offer.availableFactions || [offer.faction]).includes(faction))
    )
      return false;
    const development =
      typeof Development !== "undefined" ? Development : require("./development.js");
    const model = modelsForUnits()[offer.unitId + "__" + defaultKit(offer.unitId)];
    return (
      !!model &&
      !model.wip &&
      !model.formOnly &&
      development.allows(faction, offer.unitId)
    );
  }
  function purchaseLicense(unitId, faction) {
    const offer = licenseOffer(unitId);
    if (state.licenses[unitId] || !available(offer, faction)) return false;
    return transact(offer, { [unitId]: true });
  }
  function licensePlan(entries) {
    const items = [],
      total = { money: 0, supplies: 0 };
    for (const unitId of new Set(entries.map(entry => entry.unitId))) {
      if (state.licenses[unitId]) continue;
      const offer = licenseOffer(unitId);
      items.push({ unitId });
      if (offer) {
        total.money += offer.money;
        total.supplies += offer.supplies;
      }
    }
    return { ...total, items };
  }
  function purchaseMissingLicenses(entries, faction) {
    const plan = licensePlan(entries);
    const unavailable = plan.items.filter(
      (item) => !available(licenseOffer(item.unitId), faction),
    );
    if (unavailable.length)
      return { ok: false, reason: "unavailable", units: unavailable.map((item) => item.unitId) };
    if (!plan.items.length) return { ok: true, plan };
    const licenses = Object.fromEntries(plan.items.map((item) => [item.unitId, true]));
    return { ok: transact(plan, licenses), reason: "funds", plan };
  }
  return {
    key,
    catalog,
    initial,
    errorMessage,
    validate,
    snapshot,
    exportProgress,
    storageIssue: () => (storageError ? errorMessage(storageError) : null),
    affordable,
    transact,
    purchaseLicense,
    licenseOffer,
    licensePlan,
    creditAward,
    creditActivity,
    purchaseMissingLicenses,
    baseModel,
    defaultKit,
    defaultModel: (unitId) => unitId + "__" + defaultKit(unitId),
    hasLicense: (unitId) => !!state.licenses[unitId],
  };
})();
if (typeof module !== "undefined") module.exports = Economy;
