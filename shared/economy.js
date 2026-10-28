/* Personal wallet and inventory. Authoritative awards and final losses are persisted atomically. */
"use strict";
const Economy = (() => {
  const key = "projectgreed.economy.v1";
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-catalog.json");
  let kitModels;
  function modelsForKits() {
    return kitModels ||= typeof ART !== "undefined" ? ART.models : require("../tools/load-catalog.cjs").loadCatalog().models;
  }
  const initial = () => ({
    money: 5000,
    supplies: 10000,
    inventory: { Type61: 24, FF_B2: 12, Medea: 3, MS_06F: 4, MS_06S: 2, FatUncle: 3 },
    kits: {},
  });
  function validate(value) {
    if (value === undefined) return initial(); // Profiles from before production existed.
    if (
      !value ||
      !Number.isSafeInteger(value.money) ||
      value.money < 0 ||
      !Number.isSafeInteger(value.supplies) ||
      value.supplies < 0 ||
      !value.inventory ||
      typeof value.inventory !== "object" ||
      Array.isArray(value.inventory)
    )
      throw Error("资金、物资或库存无效");
    const inventory = {},
      kits = {};
    if (
      value.kits !== undefined &&
      (!value.kits || typeof value.kits !== "object" || Array.isArray(value.kits))
    )
      throw Error("套件库存无效");
    for (const [id, count] of Object.entries(value.kits || {})) {
      if ((!Object.hasOwn(catalog.offers, id) && !kitPrice(id)) || !Number.isSafeInteger(count) || count < 0)
        throw Error("套件数量无效: " + id);
      kits[id] = count;
    }
    for (const [id, count] of Object.entries(value.inventory)) {
      if (!Number.isSafeInteger(count) || count < 0) throw Error("单位数量无效: " + id);
      // Early production previews stored complete units under model/kit IDs.
      // Preserve those paid-for chassis and their included extra equipment.
      const legacy = Object.hasOwn(catalog.offers, id) ? catalog.offers[id] : null;
      const unitId = legacy ? legacy.unitId : id;
      if (!Object.hasOwn(catalog.baseModels, unitId)) throw Error("单位数量无效: " + id);
      inventory[unitId] = (inventory[unitId] || 0) + count;
      if (!Number.isSafeInteger(inventory[unitId])) throw Error("单位数量超出上限: " + unitId);
      if (legacy && id !== baseModel(unitId)) {
        kits[id] = (kits[id] || 0) + count;
        if (!Number.isSafeInteger(kits[id])) throw Error("套件数量超出上限: " + id);
      }
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
      inventory,
      kits,
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
        state = validate(parsed);
        if (Object.keys(parsed.inventory).some((id) => Object.hasOwn(catalog.offers, id))) {
          const backupKey = key + ".before-unit-inventory";
          if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, saved);
          localStorage.setItem(key, JSON.stringify(state));
        }
      }
    } catch (error) {
      storageError = error;
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
    return validate(state);
  }
  function affordable(cost) {
    return ["money", "supplies"].every(
      (k) =>
        Number.isSafeInteger(cost[k] ?? 0) && (cost[k] ?? 0) >= 0 && state[k] >= (cost[k] ?? 0),
    );
  }
  // Persist the wallet, inventory and optional research progress as one rollback-able change.
  // Memory is only updated after every storage write succeeds.
  function transact(cost, quantities = {}, extraWrites = [], kits = {}) {
    if (storageError) throw storageError;
    if (!affordable(cost)) return false;
    const next = snapshot();
    next.money -= cost.money ?? 0;
    next.supplies -= cost.supplies ?? 0;
    for (const [id, count] of Object.entries(quantities)) {
      if (!Number.isSafeInteger(count) || count < 1) throw Error("生产数量无效");
      next.inventory[id] = (next.inventory[id] || 0) + count;
    }
    for (const [id, count] of Object.entries(kits)) {
      if (!Number.isSafeInteger(count) || count < 1) throw Error("套件数量无效");
      next.kits[id] = (next.kits[id] || 0) + count;
    }
    return commit(next, extraWrites);
  }
  function commit(next, extraWrites = []) {
    if (storageError) throw storageError;
    validate(next);
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
    for (const [unitId, count] of Object.entries(award.losses || {})) {
      if (!Object.hasOwn(catalog.baseModels, unitId) || !Number.isSafeInteger(count) || count < 0)
        throw Error("战损库存无效");
      next.inventory[unitId] = Math.max(0, (next.inventory[unitId] || 0) - count);
    }
    next.claimed = { ...next.claimed, [award.id]: award.matchId };
    return commit(next);
  }
  function creditActivity(award, extraWrites = []) {
    if (!award?.id || !award.matchId || Object.hasOwn(state.claimed || {},award.id)) return false;
    if (![award.money,award.supplies].every(value=>Number.isSafeInteger(value)&&value>=0)) throw Error("活动货币奖励无效");
    const next = snapshot();
    next.money += award.money; next.supplies += award.supplies;
    for (const [id,count] of Object.entries(award.inventory || {})) {
      if (!Object.hasOwn(catalog.baseModels,id) || !Number.isSafeInteger(count) || count < 1) throw Error("活动单位奖励无效");
      next.inventory[id] = (next.inventory[id] || 0) + count;
    }
    next.claimed = {...next.claimed,[award.id]:award.matchId};
    return commit(next,extraWrites);
  }
  function sellPrice(unitId) {
    const offer = catalog.offers[baseModel(unitId)];
    return offer ? { money: Math.floor(offer.money / offer.quantity / 100) * 50, supplies: Math.floor(offer.supplies / offer.quantity / 100) * 50 } : null;
  }
  function sellUnit(unitId) {
    const price = sellPrice(unitId);
    if (!price || !(state.inventory[unitId] > 0)) return false;
    const next = snapshot();
    next.inventory[unitId]--;
    next.money += price.money; next.supplies += price.supplies;
    return commit(next);
  }
  function baseModel(unitId) {
    return catalog.baseModels[unitId] || null;
  }
  function baseKit(unitId) {
    return baseModel(unitId)?.slice(unitId.length + 2) || null;
  }
  function kitPrice(modelId) {
    if (!catalog.offers[modelId]) {
      // Some selectable equipment has no standalone factory order in the MOD.
      // Price it from the same chassis' nearest COST tier; extrapolate only above
      // its highest priced tier. Existing imported prices remain authoritative.
      const models = modelsForKits(), model = models[modelId];
      const baseId = model && baseModel(model.prefabId), base = models[baseId];
      if (!base || modelId === baseId) return null;
      const delta = Math.max(0, model.cost - base.cost);
      const candidates = Object.entries(catalog.offers)
        .filter(([id, offer]) => offer.unitId === model.prefabId && id !== baseId && models[id])
        .map(([id]) => ({ id, delta: Math.max(0, models[id].cost - base.cost) }));
      candidates.sort((a, b) =>
        Number(a.delta < delta) - Number(b.delta < delta) ||
        Math.abs(a.delta - delta) - Math.abs(b.delta - delta) || a.id.localeCompare(b.id));
      const reference = candidates[0];
      if (!reference) return null;
      const price = kitPrice(reference.id);
      const scale = reference.delta > 0 ? Math.max(1, delta / reference.delta) : 1;
      return { quantity: price.quantity,
        money: Math.ceil(price.money / price.quantity * scale) * price.quantity,
        supplies: Math.ceil(price.supplies / price.quantity * scale) * price.quantity };
    }
    const offer = catalog.offers[modelId],
      base = offer && catalog.offers[baseModel(offer.unitId)];
    if (!base || modelId === baseModel(offer.unitId)) return null;
    const price = { quantity: base.quantity };
    for (const key of ["money", "supplies"])
      price[key] =
        Math.max(
          0,
          Math.ceil(
            (offer[key] * base.quantity - base[key] * offer.quantity) /
              (offer.quantity * base.quantity),
          ),
        ) * base.quantity;
    return price;
  }
  function available(offer, faction, allowOwned = false) {
    const owned = allowOwned && offer && (state.inventory[offer.unitId] || 0) > 0;
    if (
      !offer ||
      !["PMC", "EFSF", "ZEON"].includes(faction) ||
      (!owned && faction !== "PMC" && !(offer.availableFactions || [offer.faction]).includes(faction))
    )
      return false;
    const development =
      typeof Development !== "undefined" ? Development : require("./development.js");
    const models =
      typeof ART !== "undefined"
        ? ART.models
        : require("../tools/load-catalog.cjs").loadCatalog().models;
    const model = models[baseModel(offer.unitId)];
    return !!model && !model.wip && (owned || development.allows(faction, offer.unitId));
  }
  function produce(unitId, faction) {
    const offer = catalog.offers[baseModel(unitId)];
    if (!available(offer, faction)) return false;
    return transact(offer, { [unitId]: offer.quantity });
  }
  function productionPlan(entries) {
    const required = {};
    for (const entry of entries) required[entry.unitId] = (required[entry.unitId] || 0) + 1;
    const items = [],
      total = { money: 0, supplies: 0 };
    for (const [unitId, count] of Object.entries(required)) {
      const missing = Math.max(0, count - (state.inventory[unitId] || 0));
      if (!missing) continue;
      const offer = catalog.offers[baseModel(unitId)];
      const batches = offer ? Math.ceil(missing / offer.quantity) : 0;
      items.push({ unitId, missing, batches, quantity: offer ? batches * offer.quantity : 0 });
      if (offer) {
        total.money += offer.money * batches;
        total.supplies += offer.supplies * batches;
      }
    }
    return { ...total, items };
  }
  function produceMissing(entries, faction) {
    const plan = productionPlan(entries);
    const unavailable = plan.items.filter(
      (item) => !available(catalog.offers[baseModel(item.unitId)], faction),
    );
    if (unavailable.length)
      return { ok: false, reason: "unavailable", units: unavailable.map((item) => item.unitId) };
    if (!plan.items.length) return { ok: true, plan };
    const quantities = Object.fromEntries(plan.items.map((item) => [item.unitId, item.quantity]));
    return { ok: transact(plan, quantities), reason: "funds", plan };
  }
  function canBuyKit(modelId, faction) {
    const unitId = modelId.split("__")[0];
    return !!kitPrice(modelId) && available(catalog.offers[modelId] || catalog.offers[baseModel(unitId)], faction, true);
  }
  function buyKit(modelId, faction) {
    const price = kitPrice(modelId);
    if (!canBuyKit(modelId, faction)) return false;
    return transact(price, {}, [], { [modelId]: price.quantity });
  }
  // Presets are alternatives. Only entries in the current formation reserve equipment;
  // changing/removing an entry releases its reservation without consuming owned stock.
  function fitKits(entries) {
    const used = {};
    return entries.map((entry) => {
      const base = baseKit(entry.unitId),
        id = entry.unitId + "__" + entry.kitId;
      if (!base || entry.kitId === base) return { ...entry };
      if ((used[id] || 0) < (state.kits[id] || 0)) {
        used[id] = (used[id] || 0) + 1;
        return { ...entry };
      }
      return { ...entry, kitId: base };
    });
  }
  function freeKits(modelId, entries, exceptIndex = null) {
    const used = entries.filter(
      (e, i) => i !== exceptIndex && e.unitId + "__" + e.kitId === modelId,
    ).length;
    return Math.max(0, (state.kits[modelId] || 0) - used);
  }
  return {
    key,
    catalog,
    initial,
    errorMessage,
    validate,
    snapshot,
    affordable,
    transact,
    produce,
    buyKit,
    canBuyKit,
    productionPlan,
    creditAward,
    creditActivity,
    sellPrice,
    sellUnit,
    produceMissing,
    baseModel,
    baseKit,
    kitPrice,
    fitKits,
    freeKits,
    quantity: (unitId) => state.inventory[unitId] || 0,
    kitQuantity: (modelId) => state.kits[modelId] || 0,
  };
})();
if (typeof module !== "undefined") module.exports = Economy;
