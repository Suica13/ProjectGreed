/* Synchronous personal-save writes: release replaced data before allocating it again. */
const ProfileStorage = (() => {
  function inspect(storage) {
    const groups = new Map();
    const result = {
      readable: false,
      writable: false,
      estimatedBytes: 0,
      groups: [],
      largestRecords: [],
      errorName: null,
    };
    const category = (key) => {
      if (key.startsWith("projectgreed.custom-pilots.")) return "驾驶员名册";
      if (key.startsWith("slg-formations-")) return "单位编组";
      if (key === "projectgreed.economy.v1") return "资金和库存";
      if (key.startsWith("projectgreed.economy.v1.")) return "经济迁移备份";
      if (key.startsWith("projectgreed.development")) return "科技进度";
      if (key.startsWith("projectgreed.campaign.")) return "历史战役备份";
      if (key.startsWith("projectgreed.")) return "其他游戏数据";
      return "其他页面数据";
    };
    try {
      storage ||= localStorage;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i),
          value = storage.getItem(key) || "";
        const bytes = (key.length + value.length) * 2;
        const name = category(key);
        const group = groups.get(name) || { name, bytes: 0, records: 0 };
        group.bytes += bytes;
        group.records++;
        groups.set(name, group);
        result.estimatedBytes += bytes;
        result.largestRecords.push({ key, bytes, category: name });
      }
      result.readable = true;
      // Probe a new, tiny record. Never overwrite or remove an existing save.
      let key;
      do {
        key = "projectgreed.storage-probe." + Math.random().toString(36).slice(2);
      } while (storage.getItem(key) !== null);
      storage.setItem(key, "1");
      result.writable = storage.getItem(key) === "1";
      storage.removeItem(key);
    } catch (error) {
      result.errorName = error.name || "Error";
    }
    result.groups = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
    // Export only key names and sizes, never stored values.
    result.largestRecords.sort((a, b) => b.bytes - a.bytes);
    result.largestRecords = result.largestRecords.slice(0, 15);
    return result;
  }
  function replace(entries, storage = localStorage) {
    if (typeof AppRuntime !== "undefined" && AppRuntime.native && storage === localStorage)
      return AppRuntime.replaceItems(entries);
    const next = new Map(entries);
    const previous = new Map([...next.keys()].map((key) => [key, storage.getItem(key)]));
    const changes = [...next].filter(([key, value]) => previous.get(key) !== value);
    const write = (key, value) =>
      value === null ? storage.removeItem(key) : storage.setItem(key, value);
    const applied = [];
    try {
      // Shrinking/removing old records first avoids a temporary double-sized save.
      changes.sort(
        ([a, av], [b, bv]) =>
          (av?.length || 0) -
          (previous.get(a)?.length || 0) -
          ((bv?.length || 0) - (previous.get(b)?.length || 0)),
      );
      for (const [key, value] of changes) {
        write(key, value);
        applied.push(key);
      }
    } catch (error) {
      // Free all newly written values before restoring the exact original set.
      for (const key of applied) storage.removeItem(key);
      for (const key of applied) write(key, previous.get(key));
      throw error;
    }
  }
  function compactSquads(squads, pilots) {
    const ids = new Set(pilots.map((pilot) => pilot.id));
    return squads.map((squad) => ({
      ...squad,
      units: squad.units.map((unit) =>
        ids.has(unit.customPilot?.id)
          ? { ...unit, customPilot: { id: unit.customPilot.id } }
          : unit,
      ),
    }));
  }
  function expandSquads(squads, pilots) {
    const roster = new Map(pilots.map((pilot) => [pilot.id, pilot]));
    return squads.map((squad) => ({
      ...squad,
      units: squad.units.map((unit) => {
        // Full profiles in older saves remain valid; only resolve compact references.
        const pilot = unit.customPilot;
        if (!pilot || Object.keys(pilot).length !== 1) return unit;
        if (roster.has(pilot.id))
          return { ...unit, customPilot: structuredClone(roster.get(pilot.id)) };
        // A dismissed pilot leaves the archived unit unassigned, just as runtime hydration does.
        const { customPilot, ...unassigned } = unit;
        return unassigned;
      }),
    }));
  }
  return { inspect, replace, compactSquads, expandSquads };
})();
if (typeof module !== "undefined") module.exports = ProfileStorage;
