/* Permanent permits and counted chassis; equipment selection is free. */
"use strict";
const Economy = (() => {
  const contacts = typeof ContactTasks !== "undefined" ? ContactTasks : require("./contact-tasks.js");
  const pilots = typeof PilotSystem !== "undefined" ? PilotSystem : require("./pilots.js");
  const saveCodec = typeof SaveCodec !== "undefined" ? SaveCodec : require("./save-codec.js");
  const warehouse = typeof Warehouse !== "undefined" ? Warehouse : require("./warehouse.js");
  const plugins = typeof UnitPlugins !== "undefined" ? UnitPlugins : require("./unit-plugins.js");
  const merchants =
    typeof MERCHANT_DATA !== "undefined" ? MERCHANT_DATA : require("./merchant-catalog.json");
  const baseFacilities =
    typeof BaseFacilities !== "undefined" ? BaseFacilities : require("./base-facilities.js");
  const key = "projectgreed.economy.v1";
  const progressEpoch = typeof ProfileReset !== "undefined" ? ProfileReset.epoch : require("./profile-reset.js").epoch;
  const catalog =
    typeof PRODUCTION_CATALOG !== "undefined"
      ? PRODUCTION_CATALOG
      : require("./production-data.cjs");
  let kitModels, unitCatalog, unsellableForms;
  function catalogForUnits() {
    return (unitCatalog ||=
      typeof ART !== "undefined"
        ? ART
        : require("../tools/load-catalog.cjs").loadCatalog({ embedAssets: false }));
  }
  function modelsForUnits() {
    return (kitModels ||= catalogForUnits().models);
  }
  const starter =
    typeof STARTER_PROFILE !== "undefined" ? STARTER_PROFILE : require("./starter-profile.json");
  const tree =
    typeof DEVELOPMENT_TREE !== "undefined" ? DEVELOPMENT_TREE : require("./development-tree.json");
  const licenseUnit = (id) =>
    catalog.unitFamilies?.[id]?.unitId || (id === "RGZ_91" ? "RGZ_91_MA" : id);
  const ownsLicense = (id) => !!state.licenses[licenseUnit(id)];
  const defaultLicenses = () => Object.fromEntries(
    ["EFSF", "ZEON"].flatMap(faction =>
      (tree[faction] || []).filter(node => node.id === `Tech_${faction}_0079_BaseTech`)
        .flatMap(node => node.unlocks)
    ).map(licenseUnit).filter(id => Object.hasOwn(catalog.baseModels, id)).map(id => [id, true])
  );
  function initial(faction = null) {
    if (faction !== null && !Object.hasOwn(starter.startingFactions, faction))
      throw Error("初始势力无效");
    const inventory = {...(faction ? starter.startingFactions[faction].inventory : starter.inventory)},
      kits = {};
    return {
      schemaVersion: 4,
      progressEpoch,
      onboardingPending: faction === null,
      ...(faction ? { startingFaction: faction } : {}),
      storage: warehouse.normalize(warehouse.empty(),modelsForUnits(),inventory,defaultKit),
      baseFacilities: baseFacilities.initial(),
      inventory,
      kits,
      money: starter.money,
      supplies: starter.supplies,
      licenses: defaultLicenses(),
      crewStock: pilots.normalizeCrewStock(),
      pluginInventory: {},
      contactTasks: [],
      contactIntro: false,
      contactAffinity: 0,
      contactRewardVersion: 2,
      merchantAffinities: { anaheim: 0 },
    };
  }
  function validate(value) {
    if (value === undefined) return initial();
    if (value?.schemaVersion > 4) throw Error("经济存档来自更新的版本，无法读取");
    if (
      !value ||
      !Number.isSafeInteger(value.money) ||
      value.money < 0 ||
      !Number.isSafeInteger(value.supplies) ||
      value.supplies < 0
    )
      throw Error("资金、物资或部署许可无效");
    // All pre-warehouse profiles start with empty physical stock, including imported backups.
    const stock = normalizeStock(value.schemaVersion === 4 ? value : {});
    const facilities = baseFacilities.normalize(
      value.baseFacilities,
      value.schemaVersion === 4 ? value.storage : null,
    );
    const capacity = baseFacilities.capacity(facilities);
    const storageInput =
      value.schemaVersion === 4 && value.storage
        ? structuredClone(value.storage)
        : warehouse.empty();
    storageInput.slots = capacity;
    storageInput.pages = {
      units: Math.ceil(capacity.units / warehouse.defaults.unitsPerPage),
      ships: Math.ceil(capacity.ships / warehouse.defaults.shipsPerPage),
    };
    const storage = warehouse.normalize(
      storageInput,
      modelsForUnits(),
      stock.inventory,
      defaultKit,
    );
    stock.inventory = warehouse.counts(storage);
    const contactTasks = contacts.normalize(value.contactTasks);
    for(const entry of contactTasks) {
      const task=contacts.byId.get(entry.id);
      if(!task?.reclaim || entry.loanTracking || entry.loanReturned || entry.status==="claimed") continue;
      const item=[...storage.units,...storage.ships,...storage.deliveries].find(item=>Object.hasOwn(task.reclaim,item.unitId));
      if(item) item.contactLoan=entry.id;
      entry.loanTracking=true;
    }
    const owned = value.licenses;
    if (!owned || typeof owned !== "object" || Array.isArray(owned)) throw Error("部署许可无效");
    const licenses = defaultLicenses();
    for (const [id, amount] of Object.entries(owned)) {
      if (typeof amount !== "boolean") throw Error("部署许可无效: " + id);
      const unitId = licenseUnit(id);
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
    if (value.startingFaction !== undefined && !Object.hasOwn(starter.startingFactions, value.startingFaction))
      throw Error("初始势力无效");
    if (value.contactAffinity !== undefined && (!Number.isFinite(value.contactAffinity) || value.contactAffinity < 0 || value.contactAffinity > Number.MAX_SAFE_INTEGER))
      throw Error("联络人好感度无效");
    const merchantAffinities = {};
    for(const merchant of merchants.filter(m=>m.id!=="efsf")){
      const points=value.merchantAffinities?.[merchant.id]??0;
      if(!Number.isFinite(points)||points<0||points>Number.MAX_SAFE_INTEGER)throw Error("联络人好感度无效");
      merchantAffinities[merchant.id]=points;
    }
    return {
      money: value.money,
      supplies: value.supplies,
      schemaVersion: 4,
      progressEpoch,
      ...(value.onboardingPending === true ? { onboardingPending: true } : {}),
      ...(value.startingFaction ? { startingFaction: value.startingFaction } : {}),
      storage,
      baseFacilities: facilities,
      licenses,
      ...stock,
      crewStock: pilots.normalizeCrewStock(value.crewStock),
      pluginInventory: normalizePluginInventory(value.pluginInventory, storage),
      contactTasks,
      contactIntro: value.contactIntro === true,
      contactAffinity: value.contactAffinity === undefined
        ? contacts.normalize(value.contactTasks).filter(e=>e.status==="claimed").reduce((sum,entry)=>sum+(contacts.byId.get(entry.id).affinity||100),0)
        : Math.round((value.contactAffinity + (value.contactRewardVersion===2 ? 0 : contacts.normalize(value.contactTasks).filter(e=>e.status==="claimed").length*99.9))*10)/10,
      contactRewardVersion: 2,
      merchantAffinities,
      ...(Object.keys(claimed).length ? { claimed } : {}),
    };
  }
  let state = initial(),
    storageError = null;
  if (typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        const parsed = saveCodec.parse(saved);
        const migrations =
          typeof ProfileMigrations !== "undefined"
            ? ProfileMigrations
            : require("./profile-migrations.js");
        state = validate(migrations.economy(parsed));
        if (parsed.schemaVersion !== 4 || parsed.licenses === undefined) {
          const backupKey = key + ".before-counted-stock";
          if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, saved);
          localStorage.setItem(key, saveCodec.stringify(state));
        } else if (parsed.contactTasks?.length) {
          // Retire the erroneous tactical-mission links, leaving wallet and parts intact.
          localStorage.setItem(key, saveCodec.stringify(state));
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
    if (error?.name === "QuotaExceededError")
      return "浏览器本地存储空间不足，未保存本次更改。请在设置中点击“检查存储”，新建个人存档不会重置浏览器的存储配额。";
    if (error?.name === "SecurityError")
      return "当前预览禁止访问本地存储，请在 Edge 或 Chrome 中打开此客户端页面。";
    if (error?.name === "SyntaxError") return "经济存档无法解析，请导入有效的个人存档。";
    return error?.message || String(error);
  }
  function completeOnboarding(faction, extraWrites = []) {
    if (!state.onboardingPending) return false;
    if (!Object.hasOwn(starter.startingFactions, faction)) throw Error("初始势力无效");
    const next = snapshot();
    for (const [id, count] of Object.entries(starter.startingFactions[faction].inventory))
      next.inventory[id] = (next.inventory[id] || 0) + count;
    next.storage = warehouse.normalize(next.storage, modelsForUnits(), next.inventory, defaultKit);
    next.onboardingPending = false;
    next.startingFaction = faction;
    return commit(next, extraWrites);
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
  // Persist the wallet and related records as one rollback-able change.
  // Memory is only updated after every storage write succeeds.
  function transact(cost, licenses = {}, extraWrites = []) {
    if (storageError) throw storageError;
    if (Object.keys(licenses).length) return false;
    if (!affordable(cost)) return false;
    const next = snapshot();
    next.money -= cost.money ?? 0;
    next.supplies -= cost.supplies ?? 0;
    return commit(next, extraWrites);
  }
  function commit(next, extraWrites = []) {
    if (storageError) throw storageError;
    next = validate(next);
    if (typeof localStorage !== "undefined") {
      const writes = [[key, saveCodec.stringify(next)], ...extraWrites];
      const previous = writes.map(([k]) => [k, localStorage.getItem(k)]);
      try {
        if (typeof AppRuntime !== "undefined" && AppRuntime.native) AppRuntime.replaceItems(writes);
        else for (const [k, v] of writes) localStorage.setItem(k, v);
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
    for (const result of award.contactProgress || []) {
      const task = contacts.byId.get(result.id), entry = next.contactTasks.find(e=>e.id===result.id);
      if (!task || !entry || entry.status !== "accepted" || !Number.isSafeInteger(result.amount) || result.amount < 0) continue;
      entry.progress = Math.min(task.required, entry.progress + result.amount);
      if (entry.progress >= task.required) entry.status = "ready";
    }
    if (award.crewLost) {
      const lost = pilots.normalizeCrewStock(award.crewLost);
      for (const grade of Object.keys(lost))
        next.crewStock[grade] = Math.max(0, next.crewStock[grade] - lost[grade]);
    }
    const stored = [...next.storage.units, ...next.storage.ships];
    const lossItems = (award.stockLostItems || []).map((item) => ({ ...item }));
    // Wrecks retain their physical slot; only the deployable quantity is reduced.
    for (const [unitId, count] of Object.entries(award.stockLost?.inventory || {})) {
      for (let i = 0; i < count; i++) {
        const detail = lossItems.find((item) => item.unitId === unitId && !item.used);
        if (detail) detail.used = true;
        const item =
          stored.find(
            (item) => !item.destroyed && item.unitId === unitId && item.id === detail?.stockId,
          ) ||
          stored.find(
            (item) =>
              !item.destroyed &&
              item.unitId === unitId &&
              (!detail?.kitId || item.kitId === detail.kitId),
          ) ||
          stored.find((item) => !item.destroyed && item.unitId === unitId);
        if (item) {
          item.destroyed = true;
          item.hp = 0;
          item.en = 0;
        }
      }
    }
    const updated = new Set();
    for (const result of award.stockStates || []) {
      const item =
        stored.find(
          (item) =>
            item.id === result.stockId && item.unitId === result.unitId && !updated.has(item.id),
        ) ||
        stored.find(
          (item) =>
            !item.destroyed &&
            !updated.has(item.id) &&
            item.unitId === result.unitId &&
            item.kitId === result.kitId,
        ) ||
        stored.find(
          (item) => !item.destroyed && !updated.has(item.id) && item.unitId === result.unitId,
        );
      if (!item) continue;
      if (item.destroyed && result.hp > 0) continue;
      updated.add(item.id);
      const model = modelsForUnits()[item.unitId + "__" + item.kitId];
      const condition = warehouse.condition({ ...result, plugins: item.plugins }, model);
      if (!item.destroyed && condition.destroyed)
        next.inventory[item.unitId] = Math.max(0, (next.inventory[item.unitId] || 0) - 1);
      Object.assign(item, condition);
    }
    // New matches deduct only actual losses at settlement. Keep legacy deployment/return
    // receipts readable for already-running older servers; all changes share one receipt.
    for (const [field, direction] of [
      ["stockUsed", -1],
      ["stockReturned", 1],
      ["stockGained", 1],
      ["stockLost", -1],
    ]) {
      if (!award[field]) continue;
      const stock = normalizeStock(award[field]);
      for (const kind of ["inventory"])
        for (const [id, count] of Object.entries(stock[kind])) {
          const change = (next[kind][id] || 0) + direction * count;
          // A delayed result may arrive after stock was used elsewhere. Still save
          // the receipt and rewards once rather than blocking settlement forever.
          const amount = field === "stockLost" ? Math.max(0, change) : change;
          if (amount < 0) throw Error("出战库存不足：" + id);
          next[kind][id] = amount;
        }
    }
    if (award.kind === "result") {
      const settled = new Set(award.settledStockIds || []);
      for (const kind of ["units", "ships"]) {
        next.storage[kind] = next.storage[kind].filter(item => {
          if (!item.rentalUses || !settled.has(item.id) || item.rentalLastMatchId === award.matchId) return true;
          const wasDestroyed = item.destroyed;
          item.rentalUses--;
          item.rentalLastMatchId = award.matchId;
          if (!item.rentalUses) {
            if (!wasDestroyed) next.inventory[item.unitId] = Math.max(0, (next.inventory[item.unitId] || 0) - 1);
            item.pilotId = null;
            return false;
          }
          if (wasDestroyed) next.inventory[item.unitId] = (next.inventory[item.unitId] || 0) + 1;
          Object.assign(item, warehouse.condition({ plugins: item.plugins }, modelsForUnits()[item.unitId + "__" + item.kitId]));
          return true;
        });
      }
    }
    for (const entry of next.contactTasks) if (entry.status === "ready") reclaimContactLoan(next, entry);
    next.claimed = { ...next.claimed, [award.id]: award.matchId };
    return commit(next);
  }
  function storedUnits() {
    return warehouse.profile([...state.storage.units, ...state.storage.ships], modelsForUnits());
  }
  function creditActivity(award, extraWrites = []) {
    if (!award?.id || !award.matchId || Object.hasOwn(state.claimed || {}, award.id)) return false;
    if (![award.money, award.supplies].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw Error("活动货币奖励无效");
    const next = snapshot();
    next.money += award.money;
    next.supplies += award.supplies;
    const awardedStock = normalizeStock(award);
    const rentals = warehouse.rentalRewards(award.rentals, modelsForUnits(), defaultKit);
    for(const [id,count]of Object.entries(normalizePluginInventory(award.pluginInventory||{},warehouse.empty()))){
      const total=(next.pluginInventory[id]||0)+count;
      if(!Number.isSafeInteger(total)||total>1000000)throw Error("零件库存数量超过上限："+id);
      next.pluginInventory[id]=total;
    }
    for (const kind of ["inventory"])
      for (const [id, count] of Object.entries(awardedStock[kind])) {
        const quantity = (next[kind][id] || 0) + count;
        if (!Number.isSafeInteger(quantity) || quantity > 1000000)
          throw Error("库存数量超过上限：" + id);
        next[kind][id] = quantity;
      }
    // Reconcile permanent rewards first so rentals cannot replace an existing hull.
    next.storage = warehouse.normalize(next.storage, modelsForUnits(), next.inventory, defaultKit);
    next.inventory = warehouse.counts(next.storage);
    for (const entry of rentals) for (let i = 0; i < entry.count; i++) {
      const model = modelsForUnits()[entry.unitId + "__" + entry.kitId], kind = warehouse.category(model);
      const item = { unitId: entry.unitId, kitId: entry.kitId, rentalUses: entry.uses,
        ...warehouse.condition({ plugins: entry.plugins }, model) };
      if (warehouse.fits(next.storage, model, modelsForUnits())) {
        next.storage[kind].push({ ...item, id: "stored-" + ++next.storage.serial, slot: warehouse.freeSlot(next.storage, kind) });
        next.inventory[entry.unitId] = (next.inventory[entry.unitId] || 0) + 1;
      } else next.storage.deliveries.push(item);
    }
    for (const [id, owned] of Object.entries(award.licenses || {})) {
      if (!Object.hasOwn(catalog.baseModels, id) || owned !== true) throw Error("活动单位奖励无效");
      next.licenses[id] = true;
    }
    next.claimed = { ...next.claimed, [award.id]: award.matchId };
    return commit(next, extraWrites);
  }
  function normalizeStock(value = {}) {
    const result = { inventory: {}, kits: {} };
    for (const kind of ["inventory"]) {
      const items = value[kind] ?? {};
      if (!items || typeof items !== "object" || Array.isArray(items)) throw Error("库存格式无效");
      for (const [id, count] of Object.entries(items)) {
        if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
          throw Error("库存数量无效：" + id);
        const known =
          kind === "inventory"
            ? Object.hasOwn(catalog.baseModels, id) ||
              Object.values(modelsForUnits()).some((m) => m.prefabId === id)
            : Object.hasOwn(modelsForUnits(), id);
        if (!known || ["__proto__", "constructor", "prototype"].includes(id))
          throw Error("库存物品无效：" + id);
        const target = catalog.unitFamilies?.[id]?.unitId || id;
        if (count) result[kind][target] = (result[kind][target] || 0) + count;
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
      else {
        available.inventory[entry.unitId]--;
      }
      if (reasons[index]) missing.push(index);
    });
    return { missing, reasons };
  }
  function quantity(unitId) {
    return state.inventory[catalog.unitFamilies?.[unitId]?.unitId || unitId] || 0;
  }
  function recruitCrew() {
    return false;
  }
  function unitOffer(unitId, production = catalog) {
    const permit = production.licenseOffers[unitId];
    if (!permit) return null;
    // Retain the original single-chassis production basis independently of permit pricing.
    return { unitId, money: permit.money, supplies: permit.supplies, quantity: 1 };
  }
  function chassisProductionOffer(unitId, production = catalog) {
    const base = unitOffer(unitId, production);
    return base ? {...base, money: base.money * 2, supplies: base.supplies * 4} : null;
  }
  // Factory times are batch totals. Both campaign orders and the catalog expose
  // the same single-unit duration; personal production remains immediate for now.
  function productionTiming(unitId, kitId = defaultKit(unitId), production = catalog) {
    const native = production.nativePricing?.[unitId]?.kits?.[kitId];
    const offer =
      production.offers?.[unitId + "__" + kitId] ||
      production.offers?.[production.baseModels?.[unitId]];
    const source = native?.source || offer?.source;
    const quantity = Math.max(1, native?.quantity || offer?.quantity || 1);
    const seconds = ((source?.buildSeconds ?? 30) + (source?.queueSeconds || 0)) / quantity;
    const secondsPerTurn = production.productionSecondsPerTurn || 20;
    return {
      seconds,
      secondsPerTurn,
      turns: Math.max(1, Math.min(5, Math.ceil(seconds / secondsPerTurn))),
    };
  }
  function productionOffer(unitId, kitId, production = catalog, models = modelsForUnits()) {
    const chassis = chassisProductionOffer(unitId, production),
      model = models[unitId + "__" + kitId];
    if (!chassis || !model || model.formOnly || model.wip) return null;
    return {
      ...chassis,
      unitId,
      kitId,
      chassis,
      turns: productionTiming(unitId, kitId, production).turns,
    };
  }
  function mayProduce(unitId, faction) {
    return ownsLicense(unitId) && available(licenseOffer(unitId), faction);
  }
  function produce(unitId, kitId, faction, slot) {
    kitId = defaultKit(unitId);
    const offer = productionOffer(unitId, kitId);
    if (!offer || !mayProduce(unitId, faction) || !affordable(offer)) return false;
    if (!canStore(unitId, kitId)) throw Error("机库或船坞已满");
    const next = snapshot();
    const model = modelsForUnits()[unitId + "__" + kitId],
      kind = warehouse.category(model);
    if (slot === undefined) slot = warehouse.freeSlot(next.storage, kind);
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= storageUsage(kind).slots ||
      next.storage[kind].some((item) => item.slot === slot)
    )
      throw Error("该格子已被占用，请选择其他空位");
    next.money -= offer.money;
    next.supplies -= offer.supplies;
    next.inventory[unitId] = quantity(unitId) + 1;
    next.storage[kind].push({ id: "stored-" + ++next.storage.serial, unitId, kitId, slot });
    return commit(next);
  }
  function canStore(unitId, kitId = defaultKit(unitId)) {
    const model = modelsForUnits()[unitId + "__" + kitId];
    return !!model && warehouse.fits(state.storage, model, modelsForUnits());
  }
  function storageUsage(kind) {
    return warehouse.usage(state.storage, modelsForUnits(), kind);
  }
  function changeStoredKit(id, kitId) {
    const next = snapshot(),
      item = [...next.storage.units, ...next.storage.ships].find((i) => i.id === id);
    if (!item || !modelsForUnits()[item.unitId + "__" + kitId]) return false;
    item.kitId = kitId;
    return commit(next);
  }
  function setStoredPlugin(id, slot, pluginId) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw Error("零件槽位无效");
    const next = snapshot(),
      item = [...next.storage.units, ...next.storage.ships].find((item) => item.id === id);
    if (!item) throw Error("库存单位不存在");
    if (item.rentalUses) throw Error("租赁单位不能调整零件");
    const base = modelsForUnits()[item.unitId + "__" + item.kitId],
      previous = plugins.apply(base, item.plugins);
    const slots = plugins.normalize(item.plugins, base);
    if (pluginId === slots[slot]) return false;
    if (pluginId !== null && pluginQuantity(pluginId) < 1)
      throw Error("零件库存不足，请前往联络商人购买");
    slots[slot] = pluginId;
    const installed = plugins.normalize(slots, base),
      updated = plugins.apply(base, installed);
    item.plugins = installed;
    // Preserve damage proportion when maximum resources change; fitting cannot repair damage.
    item.hp = item.destroyed
      ? 0
      : Math.max(1, Math.min(updated.hp, Math.round((item.hp / previous.hp) * updated.hp)));
    item.en =
      previous.en > 0
        ? Math.min(updated.en, Math.round((item.en / previous.en) * updated.en))
        : updated.en;
    return commit(next);
  }
  function fittedPlugins(storage) {
    const counts = {};
    for (const item of [...storage.units, ...storage.ships, ...storage.deliveries].filter(item => !item.rentalUses))
      for (const id of item.plugins || []) if (id) counts[id] = (counts[id] || 0) + 1;
    return counts;
  }
  function normalizePluginInventory(value, storage) {
    const fitted = fittedPlugins(storage);
    // Preserve already fitted equipment when migrating the former free-fitting profile.
    if (value === undefined) return fitted;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("零件库存无效");
    const counts = {};
    for (const [id, count] of Object.entries(value)) {
      if (!plugins.byId.has(id) || !Number.isSafeInteger(count) || count < 0 || count > 1000000)
        throw Error("零件库存无效");
      if (count) counts[id] = count;
    }
    for (const [id, count] of Object.entries(fitted))
      if ((counts[id] || 0) < count) throw Error("已装配零件超过持有数量");
    return counts;
  }
  function pluginQuantity(id) {
    if (!plugins.byId.has(id)) return 0;
    return (state.pluginInventory[id] || 0) - (fittedPlugins(state.storage)[id] || 0);
  }
  function purchasePlugin(merchantId, id) {
    const offer = pluginOffer(merchantId, id);
    if (!offer)
      throw Error("商人或零件不存在");
    if(!offer.available)throw Error("联络人好感度等级不足");
    if (!affordable(offer)) return false;
    const next = snapshot();
    next.money -= offer.money;
    next.pluginInventory[id] = (next.pluginInventory[id] || 0) + 1;
    return commit(next);
  }
  function pluginOffer(merchantId, id) {
    const merchant = merchants.find(item => item.id === merchantId), part = plugins.byId.get(id);
    return merchant?.sellsPlugins && part?.merchant===merchantId ? { money: part.rarity * 3000, available: merchantLevel(merchantId)>=(part.merchantLevel||1), requiredLevel:part.merchantLevel||1 } : null;
  }
  function moveStoredUnit(id, slot, swap = false) {
    const next = snapshot(),
      kind = ["units", "ships"].find((kind) => next.storage[kind].some((item) => item.id === id));
    if (!kind) throw Error("库存单位不存在");
    const item = next.storage[kind].find((item) => item.id === id),
      target = next.storage[kind].find((item) => item.slot === slot);
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= storageUsage(kind).slots ||
      (target && swap !== true)
    )
      throw Error("该格子已被占用，请选择其他空位");
    if (target?.id === id) return false;
    if (target) target.slot = item.slot;
    item.slot = slot;
    return commit(next);
  }
  function setStoredPilot(id, pilotId) {
    const next = snapshot(),
      item = [...next.storage.units, ...next.storage.ships].find((item) => item.id === id);
    if (!item || item.destroyed) return false;
    // A personal pilot moves with the assignment, including away from a wreck.
    if (pilotId && !pilotId.startsWith("crew:"))
      for (const other of [...next.storage.units, ...next.storage.ships])
        if (other.id !== id && other.pilotId === pilotId) other.pilotId = null;
    item.pilotId = pilotId;
    return commit(next);
  }
  function reorderStoredUnits(kind, ids) {
    if (!["units", "ships"].includes(kind)) throw Error("库存分类无效");
    const next = snapshot(),
      records = next.storage[kind],
      byId = new Map(records.map((item) => [item.id, item]));
    if (
      !Array.isArray(ids) ||
      ids.length !== records.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !byId.has(id))
    )
      throw Error("库存排序列表无效");
    next.storage[kind] = ids.map((id, slot) => ({ ...byId.get(id), slot }));
    return commit(next);
  }
  function receiveDeliveries(index = null) {
    const next = snapshot(),
      remaining = [];
    for (const [i, item] of next.storage.deliveries.entries()) {
      if (index !== null && i !== index) { remaining.push(item); continue; }
      const model = modelsForUnits()[item.unitId + "__" + item.kitId];
      if (warehouse.fits(next.storage, model, modelsForUnits())) {
        next.storage[warehouse.category(model)].push({
          ...item,
          id: "stored-" + ++next.storage.serial,
          slot: warehouse.freeSlot(next.storage, warehouse.category(model)),
        });
        next.inventory[item.unitId] = (next.inventory[item.unitId] || 0) + 1;
      } else remaining.push(item);
    }
    next.storage.deliveries = remaining;
    return commit(next);
  }
  function discardDelivery(index, expected) {
    if (!Number.isInteger(index) || index < 0 || index >= state.storage.deliveries.length) return false;
    if (expected && JSON.stringify(expected) !== JSON.stringify(state.storage.deliveries[index]))
      throw Error("保管库内容已变化，请重新确认");
    if(isContactLoan(state.storage.deliveries[index])) throw Error("任务借用机体不能出售或删除，完成任务后自动回收");
    const next = snapshot();
    next.storage.deliveries.splice(index, 1);
    return commit(next);
  }
  function grantPlan(next, planId) {
    const plan = Object.values(tree).flat().find(node=>node.id===planId);
    if (!plan) throw Error("许可计划不存在");
    for (const id of plan.unlocks || []) if (modelsForUnits()[id+"__"+defaultKit(id)] && catalog.baseModels[licenseUnit(id)]) next.licenses[licenseUnit(id)] = true;
  }
  function meetLiaison() {
    if (state.contactIntro) return false;
    const next=snapshot();next.contactIntro=true;
    grantPlan(next,"Tech_EFSF_0079_AntiMSPlan");
    return commit(next);
  }
  function acceptContactTask(id) {
    const task=contacts.byId.get(id);
    if(!task || !state.contactIntro || state.contactTasks.some(e=>e.id===id) ||
      !contacts.unlocked(task,state.contactTasks,state.contactIntro)) throw Error("任务尚未解锁或已接取");
    const next=snapshot();next.contactTasks.push({id,status:"accepted",progress:0,...(task.reclaim?{loanTracking:true}:{})});
    for(const [unitId,count] of Object.entries(task.grant||{})) for(let i=0;i<count;i++) {
      const kitId=defaultKit(unitId),model=modelsForUnits()[unitId+"__"+kitId];
      const item={unitId,kitId,...warehouse.condition({},model),...(task.reclaim?{contactLoan:id}:{})};
      if(warehouse.fits(next.storage,model,modelsForUnits())) {
        next.storage[warehouse.category(model)].push({...item,id:"stored-"+ ++next.storage.serial,slot:warehouse.freeSlot(next.storage,warehouse.category(model))});
        next.inventory[unitId]=(next.inventory[unitId]||0)+1;
      } else next.storage.deliveries.push(item);
    }
    return commit(next);
  }
  function reclaimContactLoan(next, entry) {
    const task=contacts.byId.get(entry.id);
    if(!task?.reclaim || entry.loanReturned || entry.status==="claimed") return;
    for(const [unitId,count] of Object.entries(task.reclaim)) for(let i=0;i<count;i++) {
      const kinds=["units","ships","deliveries"];
      const tagged=kinds.flatMap(kind=>next.storage[kind].map(item=>({kind,item}))).find(({item})=>item.contactLoan===task.id);
      // Older accepted saves predate loan tags. Remove at most one matching hull;
      // newly tagged loans that were sold/discarded never consume another hull.
      const found=tagged || (!entry.loanTracking && kinds.flatMap(kind=>next.storage[kind].map(item=>({kind,item})))
        .find(({item})=>item.unitId===unitId));
      if(!found) continue;
      // Parts are physical stock totals, and pilot assignments live on the
      // chassis. Detach both before returning the loan; neither is consumed.
      found.item.plugins=[];
      delete found.item.pilotId;
      next.storage[found.kind].splice(next.storage[found.kind].indexOf(found.item),1);
      if(found.kind!=="deliveries" && !found.item.destroyed)
        next.inventory[found.item.unitId]=Math.max(0,(next.inventory[found.item.unitId]||0)-1);
    }
    entry.loanReturned=true;
  }
  function isContactLoan(item) {
    return !!item?.contactLoan && state.contactTasks.some(entry=>entry.id===item.contactLoan && entry.status!=="claimed" && !entry.loanReturned);
  }
  function completeContactTask(id) {
    const task=contacts.byId.get(id),next=snapshot(),entry=next.contactTasks.find(e=>e.id===id);
    if(!task || entry?.status!=="ready") throw Error("任务尚未完成或已交付");
    reclaimContactLoan(next,entry);
    entry.status="claimed";next.money+=task.money;
    next.contactAffinity += task.affinity || 100;
    for(const [unitId,count] of Object.entries(task.inventory))next.inventory[unitId]=(next.inventory[unitId]||0)+count;
    if(task.licensePlan)grantPlan(next,task.licensePlan);
    return commit(next);
  }
  const liaisonAffinity = () => state.contactAffinity;
  const liaisonLevel = () => liaisonAffinity() >= 800 ? 2 : 1;
  const merchantAffinity = id => id==="efsf"?liaisonAffinity():state.merchantAffinities[id]||0;
  const merchantLevel = id => merchantAffinity(id)>=800?2:1;
  function facilityUpgradeOffer(id) {
    const offer=baseFacilities.upgradeOffer(state.baseFacilities,id);
    const supported=["hq","factory","giantFactory","academy"].includes(id) && offer.next===2;
    const unlocked=supported && state.contactTasks.some(e=>e.id==="efsf-6"&&e.status==="claimed");
    const money=id==="hq"?20000:10000;
    return {...offer,unlocked,condition:supported?"完成联邦联络任务：绿色通道":id==="beacon"?"信标暂未开放升级":"开发中",money:supported?money:null,supplies:supported?money:null,available:unlocked&&!offer.max&&!offer.hqRequired};
  }
  function upgradeFacility(id, expected) {
    const offer=facilityUpgradeOffer(id);
    if(expected && JSON.stringify(expected)!==JSON.stringify(offer))throw Error("升级条件已变化，请重新确认");
    if(!offer.available)throw Error("尚未满足设施升级条件");
    if(!affordable(offer))throw Error("资金或物资不足");
    const next=snapshot();next.money-=offer.money;next.supplies-=offer.supplies;
    next.baseFacilities.levels[id]=offer.next;return commit(next);
  }
  function saleOffer(unitId) {
    const prefabs = catalogForUnits().prefabs;
    if (!prefabs.some((prefab) => prefab.id === unitId)) return null;
    if (!unsellableForms) {
      unsellableForms = new Set(
        prefabs.filter((prefab) => prefab.formOnly).map((prefab) => prefab.id),
      );
      // Some older imports omit formOnly on alternate/purged forms. A priced
      // base chassis still identifies those otherwise unpriced skill targets.
      for (const prefab of prefabs)
        if (!prefab.formOnly && Object.hasOwn(catalog.licenseOffers, prefab.id))
          for (const skill of prefab.skills || [])
            if (
              ["transform", "armor_purge"].includes(skill.type) &&
              skill.source?.mode === "transform" &&
              !Object.hasOwn(catalog.licenseOffers, skill.source.unitId)
            )
              unsellableForms.add(skill.source.unitId);
    }
    if (unsellableForms.has(unitId)) return null;
    const offer = Object.hasOwn(catalog.licenseOffers, unitId) ? unitOffer(unitId) : null;
    return {
      unitId,
      quantity: 1,
      money: Math.floor((offer?.money || 0) / 2),
      supplies: Math.floor((offer?.supplies || 0) / 2),
    };
  }
  function sellUnit(unitId, storedId) {
    const offer = saleOffer(unitId);
    if (!offer || quantity(unitId) < 1) return false;
    const next = snapshot();
    const all=[...next.storage.units,...next.storage.ships];
    const item=storedId?all.find(item=>item.id===storedId && item.unitId===unitId && !item.destroyed)
      :all.find(item=>item.unitId===unitId && !item.destroyed && !item.rentalUses && !isContactLoan(item));
    if(!item) return false;
    if(item.rentalUses) throw Error("租赁单位不能出售");
    if(isContactLoan(item)) throw Error("任务借用机体不能出售或删除，完成任务后自动回收");
    const kind=["units","ships"].find(kind=>next.storage[kind].some(value=>value.id===item.id));
    next.storage[kind]=next.storage[kind].filter(value=>value.id!==item.id);
    next.inventory[unitId]--;
    next.money += offer.money;
    next.supplies += offer.supplies;
    // A sale is an inventory transaction, not a battle/event reward. Keep the
    // permit and use the same atomic persistence/rollback path as production.
    return commit(next);
  }
  function discardStoredUnit(storedId) {
    if (typeof storedId !== "string" || !storedId) return false;
    const next = snapshot();
    const kind = ["units", "ships"].find((kind) =>
      next.storage[kind].some((item) => item.id === storedId),
    );
    if (!kind) return false;
    const item = next.storage[kind].find((item) => item.id === storedId);
    if(isContactLoan(item)) throw Error("任务借用机体不能出售或删除，完成任务后自动回收");
    if (!item.destroyed)
      next.inventory[item.unitId] = Math.max(0, (next.inventory[item.unitId] || 0) - 1);
    next.storage[kind] = next.storage[kind].filter((item) => item.id !== storedId);
    // Keep counts in sync before storage reconciliation. Wrecks have already
    // been deducted, so removing one must not deduct another chassis.
    return commit(next);
  }
  function repairQuote(stockIds = null) {
    const selected = stockIds == null ? null : new Set(stockIds);
    const items = [];
    for (const item of [...state.storage.units, ...state.storage.ships]) {
      if (item.rentalUses) continue;
      if (selected && !selected.has(item.id)) continue;
      const model = plugins.apply(modelsForUnits()[item.unitId + "__" + item.kitId], item.plugins),
        destroyed = item.destroyed || item.hp === 0,
        parts =
          Object.values(item.brokenParts || {}).some(Boolean) ||
          (model.modules || []).some((part) => (item.moduleHp?.[part.id] ?? part.hp) < part.hp);
      if (!destroyed && !parts && item.hp >= model.hp && item.en >= model.en) continue;
      const price = chassisProductionOffer(item.unitId)?.supplies || 0;
      items.push({
        ...structuredClone(item),
        supplies: Math.ceil(price * (destroyed ? 0.75 : parts ? 0.5 : 0)),
      });
    }
    return { items, supplies: items.reduce((sum, item) => sum + item.supplies, 0) };
  }
  function repairAllStoredUnits(expected, additionalSupplies = 0, extraWrites = []) {
    if (!Number.isSafeInteger(additionalSupplies) || additionalSupplies < 0) throw Error("无效的整备费用");
    const quote = repairQuote(expected ? expected.items.map((item) => item.id) : null);
    if (expected && JSON.stringify(expected) !== JSON.stringify(quote))
      throw Error("库存状态已变化，请重新确认修复费用");
    if (!quote.items.length && !extraWrites.length) return false;
    const totalSupplies = quote.supplies + additionalSupplies;
    if (!Number.isSafeInteger(totalSupplies) || !affordable({ supplies: totalSupplies })) throw Error("物资不足");
    const next = snapshot(),
      ids = new Set(quote.items.map((item) => item.id));
    const claimedPilots = new Set([...next.storage.units, ...next.storage.ships]
      .filter(item => !item.destroyed && item.hp > 0 && item.pilotId && !item.pilotId.startsWith("crew:"))
      .map(item => item.pilotId));
    next.supplies -= totalSupplies;
    for (const item of [...next.storage.units, ...next.storage.ships]) {
      if (!ids.has(item.id)) continue;
      if ((item.destroyed || item.hp === 0) && item.pilotId && !item.pilotId.startsWith("crew:")) {
        // Older saves allowed the same pilot on a wreck and a surviving chassis.
        if (claimedPilots.has(item.pilotId)) item.pilotId = null;
        else claimedPilots.add(item.pilotId);
      }
      const model = plugins.apply(modelsForUnits()[item.unitId + "__" + item.kitId], item.plugins);
      Object.assign(item, { hp: model.hp, en: model.en, destroyed: false, brokenParts: {} });
      if (model.modules?.length)
        item.moduleHp = Object.fromEntries(model.modules.map((part) => [part.id, part.hp]));
    }
    next.inventory = warehouse.counts(next.storage);
    return commit(next, extraWrites);
  }
  function purchasePlan(entries) {
    const units = {};
    for (const entry of entries) units[entry.unitId] = (units[entry.unitId] || 0) + 1;
    const items = [],
      total = { money: 0, supplies: 0 };
    function add(kind, id, count, offer) {
      if (count <= 0) return;
      items.push({ kind, id, unitId: id, count, offer });
      if (offer) for (const key of ["money", "supplies"]) total[key] += offer[key] * count;
    }
    for (const [id, needed] of Object.entries(units)) {
      add("inventory", id, Math.max(0, needed - quantity(id)), productionOffer(id, defaultKit(id)));
    }
    return { ...total, items };
  }
  function purchaseMissingStock(entries, faction) {
    const plan = purchasePlan(entries);
    const unavailable = plan.items.filter(
      (item) => !item.offer || !mayProduce(item.unitId, faction),
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
      next[item.kind][item.id] = (next[item.kind][item.id] || 0) + item.count;
    }
    const simulated = warehouse.normalize(
      next.storage,
      modelsForUnits(),
      next.inventory,
      defaultKit,
    );
    if (simulated.deliveries.length > state.storage.deliveries.length)
      return { ok: false, reason: "storage", units: plan.items.map((item) => item.unitId), plan };
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
    return base && production
      ? { ...base, money: production.money, supplies: production.supplies * 3 }
      : null;
  }
  function available(offer, faction) {
    if (
      !offer ||
      ![
        "PMC",
        "EFSF",
        "ZEON",
        "AEUG",
        "TITANS",
        "NEO_ZEON",
        "EFSF_0093",
        "NEO_ZEON_0093",
        "OMNI",
        "ZAFT",
      ].includes(faction) ||
      (faction !== "PMC" && !(offer.availableFactions || [offer.faction]).includes(faction))
    )
      return false;
    const model = modelsForUnits()[offer.unitId + "__" + defaultKit(offer.unitId)];
    return !!model && !model.wip && !model.formOnly;
  }
  function purchaseLicense(unitId, faction) {
    return false;
  }
  function licensePlan(entries) {
    const items = [],
      total = { money: 0, supplies: 0 };
    const unlicensed = entries.filter((entry) => !state.licenses[entry.unitId]);
    const missingStock = stockPlan(unlicensed, state).missing.map((index) => unlicensed[index]);
    for (const unitId of new Set(missingStock.map((entry) => entry.unitId))) {
      if (state.licenses[unitId]) continue;
      items.push({ unitId });
    }
    return { ...total, items };
  }
  function purchaseMissingLicenses(entries, faction) {
    const plan = licensePlan(entries);
    if (!plan.items.length) return { ok: true, plan };
    return { ok: false, reason: "unlicensed", units: plan.items.map((item) => item.unitId), plan };
  }
  function transformStock(from, to, storedId) {
    const catalog = catalogForUnits();
    const forms = typeof NormalForms !== "undefined" ? NormalForms : require("./normal-forms.js");
    const selected =
        storedId &&
        [...state.storage.units, ...state.storage.ships].find(
          (item) => item.id === storedId && !item.destroyed,
        ),
      stockId = storedId
        ? selected?.unitId
        : forms.family(catalog, from).find((id) => quantity(id) > 0);
    if (
      !forms.options(catalog, from).some((o) => o.unitId === to) ||
      !stockId ||
      (selected && !forms.family(catalog, from).includes(selected.unitId))
    )
      throw Error("没有可变形的机体库存");
    const next = snapshot();
    const item = [...next.storage.units, ...next.storage.ships].find(
        (item) => item.unitId === stockId && !item.destroyed && (!storedId || item.id === storedId),
      ),
      originalKit = item.kitId,
      kitId = forms.kit(catalog, stockId, to, originalKit, defaultKit(to)),
      model = modelsForUnits()[to + "__" + kitId];
    if (item) {
      const previousKind = warehouse.category(modelsForUnits()[item.unitId + "__" + item.kitId]),
        nextKind = warehouse.category(model);
      if (previousKind !== nextKind) {
        if (!warehouse.fits(next.storage, model, modelsForUnits())) throw Error("仓储数量超出上限");
        next.storage[previousKind] = next.storage[previousKind].filter(
          (entry) => entry.id !== item.id,
        );
        item.slot = warehouse.freeSlot(next.storage, nextKind);
        next.storage[nextKind].push(item);
      }
      item.unitId = to;
      item.kitId = kitId;
    }
    next.inventory[stockId]--;
    next.inventory[to] = (next.inventory[to] || 0) + 1;
    if (forms.family(catalog, from).some((id) => next.licenses[id])) next.licenses[to] = true;
    normalizeStock(next);
    return commit(next);
  }
  return {
    merchants,
    pluginQuantity,
    pluginOffer,
    purchasePlugin,
    canRecruitCrew: (grade) => baseFacilities.canRecruit(state.baseFacilities, grade),
    customPilotLimit: () => baseFacilities.pilotLimit(state.baseFacilities),
    academyLevel: () => state.baseFacilities.levels.academy,
    acePilotLimit: () => baseFacilities.pilotLimit(state.baseFacilities),
    canStore,
    storageUsage,
    changeStoredKit,
    setStoredPlugin,
    moveStoredUnit,
    receiveDeliveries,
    discardDelivery,
    meetLiaison,
    acceptContactTask,
    completeContactTask,
    isContactLoan,
    liaisonAffinity,
    liaisonLevel,
    merchantAffinity,
    merchantLevel,
    facilityUpgradeOffer,
    upgradeFacility,
    storedUnits,
    setStoredPilot,
    reorderStoredUnits,
    transformStock,
    key,
    catalog,
    normalizeStock,
    recruitCrew,
    stockPlan,
    quantity,
    unitOffer,
    productionOffer,
    productionTiming,
    available,
    mayProduce,
    produce,
    saleOffer,
    sellUnit,
    discardStoredUnit,
    repairQuote,
    repairAllStoredUnits,
    purchasePlan,
    purchaseMissingStock,
    initial,
    starterFormation: () => [],
    completeOnboarding,
    startingFactions: () => structuredClone(starter.startingFactions),
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
    hasLicense: ownsLicense,
  };
})();
if (typeof module !== "undefined") module.exports = Economy;
