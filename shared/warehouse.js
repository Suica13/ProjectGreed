/* Physical chassis storage. Counts used by battle rules are derived from the stored items. */
"use strict";
const Warehouse = (() => {
  const plugins = typeof UnitPlugins !== "undefined" ? UnitPlugins : require("./unit-plugins.js");
  const defaults = { pages: 1, unitsPerPage: 10, shipsPerPage: 10, maxLevel: 5 };
  function category(model) {
    return model.ship ||
      ((model.movementType === "air" || model.tags?.includes("Aircraft")) &&
        model.hangars?.some((h) => h.kind !== "sfs"))
      ? "ships"
      : "units";
  }
  function empty() {
    return {
      version: 1,
      serial: 0,
      pages: { units: 2, ships: 1 },
      slots: { units: 20, ships: 4 },
      units: [],
      ships: [],
      deliveries: [],
    };
  }
  function usage(storage, models, kind) {
    return {
      count: storage[kind].length,
      slots:
        storage.slots?.[kind] ?? storage.pages[kind] * (kind === "ships" ? defaults.shipsPerPage : defaults.unitsPerPage),
    };
  }
  function fits(storage, model, models) {
    const used = usage(storage, models, category(model));
    return used.count < used.slots;
  }
  function freeSlot(storage, kind) {
    const occupied = new Set(storage[kind].map((item) => item.slot));
    const limit = usage(storage, null, kind).slots;
    for (let slot = 0; slot < limit; slot++) if (!occupied.has(slot)) return slot;
    return -1;
  }
  function condition(value, model) {
    const installed = plugins.normalize(value.plugins, model);
    model = plugins.apply(model, installed);
    const destroyed = value.destroyed === true || value.hp === 0;
    const resource = (key) => {
      const n = value[key] ?? model[key];
      if (!Number.isFinite(n) || n < 0) throw Error("库存单位状态无效");
      return destroyed && key === "hp" ? 0 : Math.min(model[key], n);
    };
    const allowed = new Set(["head", "backpack", "leftArm", "rightArm", "leftLeg", "rightLeg",
      ...(model.modules || []).map((part) => part.id)]);
    const brokenParts = {};
    for (const [key, broken] of Object.entries(value.brokenParts || {})) {
      if (!allowed.has(key) || typeof broken !== "boolean") throw Error("库存单位部件无效");
      if (broken) brokenParts[key] = true;
    }
    const moduleHp = {};
    for (const part of model.modules || []) {
      const hp = value.moduleHp?.[part.id] ?? (brokenParts[part.id] ? 0 : part.hp);
      if (!Number.isFinite(hp) || hp < 0) throw Error("库存单位部件耐久无效");
      moduleHp[part.id] = Math.min(part.hp, hp);
      if (!hp) brokenParts[part.id] = true;
    }
    return { plugins: installed, hp: resource("hp"), en: resource("en"), destroyed, brokenParts,
      ...(Object.keys(moduleHp).length ? { moduleHp } : {}) };
  }
  function status(item, model) {
    if (model) model = plugins.apply(model, item.plugins);
    return item.destroyed || item.hp === 0 ? "destroyed" :
      Object.values(item.brokenParts || {}).some(Boolean) || (model &&
        (item.hp < model.hp || item.en < model.en || (model.modules || []).some(part=>(item.moduleHp?.[part.id] ?? part.hp)<part.hp))) ? "damaged" : "healthy";
  }
  // Profile import only. Match actions never accept replacement combat resources.
  function profile(items, models) {
    if (items === undefined) return undefined;
    if (!Array.isArray(items) || items.length > 80) throw Error("库存单位状态无效");
    const ids = new Set();
    return items.map((item) => {
      const model = models[item.unitId + "__" + item.kitId];
      if (!model || typeof item.id !== "string" || item.id.length > 100 || ids.has(item.id))
        throw Error("库存单位状态无效");
      ids.add(item.id);
      return { id: item.id, unitId: item.unitId, kitId: item.kitId, ...condition(item, model) };
    });
  }
  function normalize(value, models, inventory, defaultKit) {
    const storage = value ? structuredClone(value) : empty();
    if (storage.version !== 1 || !Number.isSafeInteger(storage.serial) || storage.serial < 0)
      throw Error("仓储存档无效");
    const ids = new Set();
    const assignedPilots = new Set();
    for (const kind of ["units", "ships"]) {
      if (
        !Number.isInteger(storage.pages?.[kind]) ||
        storage.pages[kind] < 1 || storage.pages[kind] > (kind === "units" ? 6 : 5) ||
        !Array.isArray(storage[kind])
      )
        throw Error("仓储页数或格子无效");
      if(storage.slots && (!Number.isInteger(storage.slots[kind]) || storage.slots[kind]<1 ||
        storage.slots[kind]>(kind==="ships"?20:60)))throw Error("仓储格子上限无效");
      const slots = new Set();
      for (const item of storage[kind]) {
        const model = models[item.unitId + "__" + item.kitId];
        if (!model || category(model) !== kind || typeof item.id !== "string" || ids.has(item.id))
          throw Error("仓储单位或套件无效");
        ids.add(item.id);
        Object.assign(item, condition(item, model));
        if (item.pilotId !== undefined && item.pilotId !== null &&
            (typeof item.pilotId !== "string" || !item.pilotId || item.pilotId.length > 128))
          throw Error("库存驾驶员配属无效");
        if (!item.destroyed && item.pilotId && !item.pilotId.startsWith("crew:")) {
          if (assignedPilots.has(item.pilotId)) throw Error("驾驶员重复配属");
          assignedPilots.add(item.pilotId);
        }
        if (item.slot !== undefined) {
          if (
            !Number.isInteger(item.slot) ||
            item.slot < 0 ||
            item.slot >= usage(storage, models, kind).slots ||
            slots.has(item.slot)
          )
            throw Error("仓储格子无效");
          slots.add(item.slot);
        }
      }
      // Older physical storage records were compact arrays. Assign positions once,
      // then retain holes when units are sold or lost.
      for (const item of storage[kind])
        if (item.slot === undefined) {
          let slot = 0;
          while (slots.has(slot)) slot++;
          item.slot = slot;
          slots.add(slot);
        }
      const used = usage(storage, models, kind);
      if (used.count > used.slots) throw Error("仓储数量超出上限");
    }
    storage.deliveries ??= [];
    if (!Array.isArray(storage.deliveries) || storage.deliveries.length > 10000)
      throw Error("待入库队列无效");
    for (const item of storage.deliveries)
      if (!models[item.unitId + "__" + item.kitId]) throw Error("待入库单位无效");
    // Existing count-based operations (settlement, sale, bulk production) use this one reconciliation boundary.
    const current = {};
    for (const kind of ["units", "ships"])
      for (let i = storage[kind].length - 1; i >= 0; i--) {
        if (storage[kind][i].destroyed) continue;
        const id = storage[kind][i].unitId;
        if ((current[id] || 0) >= (inventory[id] || 0)) storage[kind].splice(i, 1);
        else current[id] = (current[id] || 0) + 1;
      }
    for (const [unitId, count] of Object.entries(inventory)) {
      const kitId = defaultKit(unitId),
        model = models[unitId + "__" + kitId];
      if (!model && count) throw Error("仓储单位不可用: " + unitId);
      for (let i = current[unitId] || 0; i < count; i++) {
        if (fits(storage, model, models))
          storage[category(model)].push({
            ...condition({}, model),
            id: "stored-" + ++storage.serial,
            unitId,
            kitId,
            slot: freeSlot(storage, category(model)),
          });
        else {
          if (storage.deliveries.length >= 10000) throw Error("待入库队列已满");
          storage.deliveries.push({ unitId, kitId });
        }
      }
    }
    return storage;
  }
  function counts(storage) {
    const result = {};
    for (const item of [...storage.units, ...storage.ships])
      if (!item.destroyed) result[item.unitId] = (result[item.unitId] || 0) + 1;
    return result;
  }
  return { defaults, category, freeSlot, empty, normalize, usage, fits, counts, condition, status, profile };
})();
if (typeof module !== "undefined") module.exports = Warehouse;
