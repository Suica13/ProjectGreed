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
    return {
      ...catalog,
      assets: Object.fromEntries(
        Object.entries(catalog.assets).map(([id, source]) => [id, intern(source)]),
      ),
      sounds: Object.fromEntries(
        Object.entries(catalog.sounds).map(([id, source]) => [id, intern(source)]),
      ),
      assetPoolVersion: 1,
      assetSources: sources,
    };
  }
  function unpack(catalog) {
    if (catalog.assetPoolVersion === undefined) return catalog;
    if (catalog.assetPoolVersion !== 1 || !Array.isArray(catalog.assetSources))
      throw Error("Invalid asset pool");
    const sources = catalog.assetSources;
    for (const field of ["assets", "sounds"])
      for (const [id, index] of Object.entries(catalog[field])) {
        if (!Number.isSafeInteger(index) || typeof sources[index] !== "string")
          throw Error("Invalid pooled asset: " + id);
        catalog[field][id] = sources[index];
      }
    delete catalog.assetSources;
    delete catalog.assetPoolVersion;
    return catalog;
  }
  return { pack, unpack };
})();
if (typeof module !== "undefined") module.exports = AssetPool;
