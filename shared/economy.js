/* Permanent permits, counted chassis and independently counted equipment kits. */
"use strict";
const Economy = (() => {
  const key = "projectgreed.economy.v1";
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-data.cjs");
  let kitModels;
  function modelsForUnits() {
    return (kitModels ||=
      typeof ART !== "undefined"
        ? ART.models
        : require("../tools/load-catalog.cjs").loadCatalog().models);
  }
  const initial = () => ({
    schemaVersion: 3,
    inventory: {},
    kits: {},
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
    const stock = normalizeStock(value);
    const owned = value.licenses;
    if (!owned || typeof owned !== "object" || Array.isArray(owned)) throw Error("部署许可无效");
    const licenses = {};
    for (const [id, amount] of Object.entries(owned)) {
      if (typeof amount !== "boolean") throw Error("部署许可无效: " + id);
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
      schemaVersion: 3,
      licenses,
      ...stock,
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
        const migrations =
          typeof ProfileMigrations !== "undefined"
            ? ProfileMigrations
            : require("./profile-migrations.js");
        state = validate(migrations.economy(parsed));
        if (parsed.schemaVersion !== 3 || parsed.licenses === undefined) {
          const backupKey = key + ".before-counted-stock";
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
      grantPurchasedLicense(next, id);
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
    // Deployment consumes a reservation once; surviving physical items return at settlement.
    for (const [field, direction] of [
      ["stockUsed", -1],
      ["stockReturned", 1],
    ]) {
      if (!award[field]) continue;
      const stock = normalizeStock(award[field]);
      for (const kind of ["inventory", "kits"])
        for (const [id, count] of Object.entries(stock[kind])) {
          const amount = (next[kind][id] || 0) + direction * count;
          if (amount < 0) throw Error("出战库存不足：" + id);
          next[kind][id] = amount;
        }
    }
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
      if (!Object.hasOwn(catalog.baseModels, id) || owned !== true) throw Error("活动单位奖励无效");
      next.licenses[id] = true;
    }
    next.claimed = { ...next.claimed, [award.id]: award.matchId };
    return commit(next, extraWrites);
  }
  function normalizeStock(value = {}) {
    const result = { inventory: {}, kits: {} };
    for (const kind of ["inventory", "kits"]) {
      const items = value[kind] ?? {};
      if (!items || typeof items !== "object" || Array.isArray(items)) throw Error("库存格式无效");
      for (const [id, count] of Object.entries(items)) {
        if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
          throw Error("库存数量无效：" + id);
        const known =
          kind === "inventory"
            ? Object.hasOwn(catalog.baseModels, id)
            : Object.hasOwn(modelsForUnits(), id);
        if (!known || ["__proto__", "constructor", "prototype"].includes(id))
          throw Error("库存物品无效：" + id);
        if (count) result[kind][id] = count;
      }
    }
    return result;
  }
  // Pure allocation: a draft only occupies stock; switching kits never sells an item.
  function stockPlan(entries, stock) {
    const available = normalizeStock(stock),
      missing = [],
      reasons = {};
    entries.forEach((entry, index) => {
      const model = entry.unitId + "__" + entry.kitId;
      if (!(available.inventory[entry.unitId] > 0)) reasons[index] = "stock";
      else if (!(available.kits[model] > 0)) reasons[index] = "kit_stock";
      else {
        available.inventory[entry.unitId]--;
        available.kits[model]--;
      }
      if (reasons[index]) missing.push(index);
    });
    return { missing, reasons };
  }
  function quantity(unitId) {
    return state.inventory[unitId] || 0;
  }
  function kitQuantity(modelId) {
    return state.kits[modelId] || 0;
  }
  function unitOffer(unitId, production = catalog) {
    const permit = production.licenseOffers[unitId];
    if (!permit) return null;
    // Retain the original single-chassis production basis independently of permit pricing.
    return { unitId, money: permit.money, supplies: permit.supplies, quantity: 1 };
  }
  function kitOffer(modelId, production = catalog, models = modelsForUnits()) {
    const model = models[modelId];
    if (!model || model.formOnly || model.wip) return null;
    const chassis = unitOffer(model.prefabId, production);
    if (!chassis) return null;
    const native = production.nativeEquipmentCosts?.[modelId];
    // Independent items always have a non-negative absolute price. Native zero-fee
    // switching did not manufacture equipment; use 20% of chassis as its fallback.
    const fallback = (key) => Math.max(key === "money" ? 25 : 50, Math.round(chassis[key] * 0.2));
    return {
      unitId: model.prefabId,
      kitId: model.kitId,
      quantity: 1,
      money: native?.money > 0 ? Math.ceil(native.money) : fallback("money"),
      supplies: native?.supplies > 0 ? Math.ceil(native.supplies) : fallback("supplies"),
    };
  }
  // Factory times are batch totals. Both campaign orders and the catalog expose
  // the same single-unit duration; personal production remains immediate for now.
  function productionTiming(unitId, kitId = defaultKit(unitId), production = catalog) {
    const native = production.nativePricing?.[unitId]?.kits?.[kitId];
    const offer = production.offers?.[unitId + "__" + kitId] || production.offers?.[production.baseModels?.[unitId]];
    const source = native?.source || offer?.source;
    const quantity = Math.max(1, native?.quantity || offer?.quantity || 1);
    const seconds = ((source?.buildSeconds ?? 30) + (source?.queueSeconds || 0)) / quantity;
    const secondsPerTurn = production.productionSecondsPerTurn || 20;
    return { seconds, secondsPerTurn, turns: Math.max(1, Math.min(5, Math.ceil(seconds / secondsPerTurn))) };
  }
  function productionOffer(unitId, kitId, production = catalog, models = modelsForUnits()) {
    const chassis = unitOffer(unitId, production),
      kit = kitOffer(unitId + "__" + kitId, production, models);
    return chassis && kit
      ? {
          unitId,
          kitId,
          quantity: 1,
          chassis,
          kit,
          turns: productionTiming(unitId, kitId, production).turns,
          money: chassis.money + kit.money,
          supplies: chassis.supplies + kit.supplies,
        }
      : null;
  }
  function mayProduce(unitId, faction) {
    return !!state.licenses[unitId] && available(licenseOffer(unitId), faction);
  }
  function produce(unitId, kitId, faction) {
    const offer = productionOffer(unitId, kitId);
    if (!offer || !mayProduce(unitId, faction) || !affordable(offer)) return false;
    const next = snapshot(),
      modelId = unitId + "__" + kitId;
    next.money -= offer.money;
    next.supplies -= offer.supplies;
    next.inventory[unitId] = quantity(unitId) + 1;
    next.kits[modelId] = kitQuantity(modelId) + 1;
    return commit(next);
  }
  function buyKit(unitId, kitId, faction) {
    const modelId = unitId + "__" + kitId,
      offer = kitOffer(modelId);
    if (!offer || !mayProduce(unitId, faction) || !affordable(offer)) return false;
    const next = snapshot();
    next.money -= offer.money;
    next.supplies -= offer.supplies;
    next.kits[modelId] = kitQuantity(modelId) + 1;
    return commit(next);
  }
  function purchasePlan(entries) {
    const units = {},
      kits = {};
    for (const entry of entries) {
      units[entry.unitId] = (units[entry.unitId] || 0) + 1;
      const modelId = entry.unitId + "__" + entry.kitId;
      kits[modelId] = (kits[modelId] || 0) + 1;
    }
    const items = [],
      total = { money: 0, supplies: 0 };
    function add(kind, id, count, offer) {
      if (count <= 0) return;
      items.push({ kind, id, unitId: kind === "kits" ? id.split("__")[0] : id, count, offer });
      if (offer) for (const key of ["money", "supplies"]) total[key] += offer[key] * count;
    }
    for (const [id, needed] of Object.entries(units)) {
      if (!state.licenses[id]) add("licenses", id, 1, licenseOffer(id));
      const gift = state.licenses[id] ? 0 : 1;
      add("inventory", id, Math.max(0, needed - quantity(id) - gift), unitOffer(id));
    }
    for (const [id, needed] of Object.entries(kits)) {
      const unitId = id.split("__")[0];
      const gift = !state.licenses[unitId] && id === unitId + "__" + defaultKit(unitId) ? 1 : 0;
      add("kits", id, Math.max(0, needed - kitQuantity(id) - gift), kitOffer(id));
    }
    return { ...total, items };
  }
  function purchaseMissingStock(entries, faction) {
    const plan = purchasePlan(entries);
    const unavailable = plan.items.filter(
      (item) => !item.offer || !available(licenseOffer(item.unitId), faction),
    );
    if (unavailable.length)
      return {
        ok: false,
        reason: "unavailable",
        units: [...new Set(unavailable.map((item) => item.unitId))],
        plan,
      };
    if (!affordable(plan)) return { ok: false, reason: "funds", plan };
    if (!plan.items.length) return { ok: true, plan };
    const next = snapshot();
    next.money -= plan.money;
    next.supplies -= plan.supplies;
    for (const item of plan.items) {
      if (item.kind === "licenses") grantPurchasedLicense(next, item.id);
      else next[item.kind][item.id] = (next[item.kind][item.id] || 0) + item.count;
    }
    return { ok: commit(next), plan };
  }
  function baseModel(unitId) {
    return catalog.baseModels[unitId] || null;
  }
  function defaultKit(unitId) {
    return catalog.defaultKits?.[unitId] || baseModel(unitId)?.slice(unitId.length + 2) || null;
  }
  function licenseOffer(unitId) {
    const base = catalog.licenseOffers[unitId];
    const production = productionOffer(unitId, defaultKit(unitId));
    return base && production ? { ...base, money: production.money * 3, supplies: production.supplies * 3 } : null;
  }
  function grantPurchasedLicense(next, unitId) {
    if (next.licenses[unitId]) return;
    if (!licenseOffer(unitId)) throw Error("部署许可无效：" + unitId);
    next.licenses[unitId] = true;
    next.inventory[unitId] = (next.inventory[unitId] || 0) + 1;
    const modelId = unitId + "__" + defaultKit(unitId);
    next.kits[modelId] = (next.kits[modelId] || 0) + 1;
  }
  function available(offer, faction) {
    if (
      !offer ||
      !["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(faction) ||
      (faction !== "PMC" && !(offer.availableFactions || [offer.faction]).includes(faction))
    )
      return false;
    const development =
      typeof Development !== "undefined" ? Development : require("./development.js");
    const model = modelsForUnits()[offer.unitId + "__" + defaultKit(offer.unitId)];
    return !!model && !model.wip && !model.formOnly && development.allows(faction, offer.unitId);
  }
  function purchaseLicense(unitId, faction) {
    const offer = licenseOffer(unitId);
    if (state.licenses[unitId] || !available(offer, faction)) return false;
    return transact(offer, { [unitId]: true });
  }
  function licensePlan(entries) {
    const items = [],
      total = { money: 0, supplies: 0 };
    for (const unitId of new Set(entries.map((entry) => entry.unitId))) {
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
    const unavailable = plan.items.filter((item) => !available(licenseOffer(item.unitId), faction));
    if (unavailable.length)
      return { ok: false, reason: "unavailable", units: unavailable.map((item) => item.unitId) };
    if (!plan.items.length) return { ok: true, plan };
    const licenses = Object.fromEntries(plan.items.map((item) => [item.unitId, true]));
    return { ok: transact(plan, licenses), reason: "funds", plan };
  }
  return {
    key,
    catalog,
    normalizeStock,
    stockPlan,
    quantity,
    kitQuantity,
    unitOffer,
    kitOffer,
    productionOffer,
    productionTiming,
    produce,
    buyKit,
    purchasePlan,
    purchaseMissingStock,
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
