/* Physical chassis storage. Counts used by battle rules are derived from the stored items. */
"use strict";
const Warehouse = (() => {
  const defaults = { pages: 3, unitsPerPage: 8, shipsPerPage: 3 };
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
      pages: { units: 3, ships: 3 },
      units: [],
      ships: [],
      deliveries: [],
    };
  }
  function usage(storage, models, kind) {
    return {
      count: storage[kind].length,
      slots:
        storage.pages[kind] * (kind === "ships" ? defaults.shipsPerPage : defaults.unitsPerPage),
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
  function normalize(value, models, inventory, defaultKit) {
    const storage = value ? structuredClone(value) : empty();
    if (storage.version !== 1 || !Number.isSafeInteger(storage.serial) || storage.serial < 0)
      throw Error("仓储存档无效");
    const ids = new Set();
    for (const kind of ["units", "ships"]) {
      if (
        !Number.isInteger(storage.pages?.[kind]) ||
        storage.pages[kind] !== defaults.pages ||
        !Array.isArray(storage[kind])
      )
        throw Error("仓储页数或格子无效");
      const slots = new Set();
      for (const item of storage[kind]) {
        const model = models[item.unitId + "__" + item.kitId];
        if (!model || category(model) !== kind || typeof item.id !== "string" || ids.has(item.id))
          throw Error("仓储单位或套件无效");
        ids.add(item.id);
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
      result[item.unitId] = (result[item.unitId] || 0) + 1;
    return result;
  }
  return { defaults, category, freeSlot, empty, normalize, usage, fits, counts };
})();
if (typeof module !== "undefined") module.exports = Warehouse;
