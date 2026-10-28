"use strict";
// Preserve every logical asset ID while storing identical binary payloads once.
const AssetPool = (() => {
  function pack(catalog) {
    const sources = [],
      indices = new Map();
    const intern = (value) => {
      if (!indices.has(value)) {
        indices.set(value, sources.length);
        sources.push(value);
      }
      return indices.get(value);
    };
    // Animation clips and fully identical weapons retain logical names but share payloads.
    const objects = [],
      objectIndices = new Map();
    const objectRef = (value) => {
      const key = JSON.stringify(value);
      if (!objectIndices.has(key)) {
        objectIndices.set(key, objects.length);
        objects.push(value);
      }
      return objectIndices.get(key);
    };
    const mapValues = (values, fn) =>
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fn(value)]));
    return {
      ...catalog,
      ...(catalog.units && {
        units: catalog.units.map((unit) => ({
          ...unit,
          animations: mapValues(unit.animations, objectRef),
        })),
      }),
      ...(catalog.prefabs && {
        prefabs: catalog.prefabs.map((prefab) => ({
          ...prefab,
          weapons: mapValues(prefab.weapons, objectRef),
        })),
      }),
      ...(catalog.models && {
        models: mapValues(catalog.models, (model) => ({
          ...model,
          weapons: model.weapons.map(objectRef),
        })),
      }),
      assets: Object.fromEntries(
        Object.entries(catalog.assets).map(([id, source]) => [id, intern(source)]),
      ),
      sounds: Object.fromEntries(
        Object.entries(catalog.sounds).map(([id, source]) => [id, intern(source)]),
      ),
      assetPoolVersion: 2,
      objectSources: objects,
      assetSources: sources,
    };
  }
  function unpack(catalog) {
    if (catalog.assetPoolVersion === undefined) return catalog;
    if (![1, 2].includes(catalog.assetPoolVersion) || !Array.isArray(catalog.assetSources))
      throw Error("Invalid asset pool");
    const sources = catalog.assetSources;
    for (const field of ["assets", "sounds"])
      for (const [id, index] of Object.entries(catalog[field])) {
        if (!Number.isSafeInteger(index) || typeof sources[index] !== "string")
          throw Error("Invalid pooled asset: " + id);
        catalog[field][id] = sources[index];
      }
    if (catalog.assetPoolVersion === 2) {
      if (!Array.isArray(catalog.objectSources)) throw Error("Invalid object pool");
      const objects = catalog.objectSources,
        frozen = new WeakSet();
      function readOnly(value) {
        if (value && typeof value === "object" && !frozen.has(value)) {
          frozen.add(value);
          for (const child of Object.values(value)) readOnly(child);
          Object.freeze(value);
        }
        return value;
      }
      const restore = (index, shared = false) => {
        if (!Number.isSafeInteger(index) || !objects[index] || typeof objects[index] !== "object")
          throw Error("Invalid pooled object");
        // Curves and attack payloads are read-only. Names and scalar per-unit overrides
        // live on independent wrappers, keeping localization and editor bindings separate.
        return shared ? readOnly(objects[index]) : { ...readOnly(objects[index]) };
      };
      for (const unit of catalog.units || [])
        for (const key of Object.keys(unit.animations))
          unit.animations[key] = restore(unit.animations[key], true);
      for (const prefab of catalog.prefabs || [])
        for (const key of Object.keys(prefab.weapons))
          prefab.weapons[key] = restore(prefab.weapons[key]);
      for (const model of Object.values(catalog.models || {}))
        model.weapons = model.weapons.map((index) => restore(index));
      delete catalog.objectSources;
    }
    delete catalog.assetSources;
    delete catalog.assetPoolVersion;
    return catalog;
  }
  return { pack, unpack };
})();
if (typeof module !== "undefined") module.exports = AssetPool;
