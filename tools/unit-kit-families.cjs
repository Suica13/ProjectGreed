"use strict";
// Compose catalog loadouts after native models are compiled. Keep each variant's
// own skeleton, effects and combat stats instead of merging incompatible bones.
function apply(catalog, families, adjustments = {units:{}}) {
  const byId = new Map(catalog.prefabs.map((p) => [p.id, p]));
  for (const [variant, entry] of Object.entries(families || {})) {
    const base = byId.get(entry.unitId),
      source = byId.get(variant);
    if (!base || !source) throw Error("Unknown kit family: " + variant);
    const canonicalId = base.id + "__" + entry.kitId;
    if (source.kitFamily === base.id && catalog.models[canonicalId]) continue;
    const options = Object.entries(catalog.models).filter(([, m]) => m.prefabId === variant);
    const best = options.sort((a, b) => b[1].cost - a[1].cost || a[0].localeCompare(b[0]))[0];
    if (!best) throw Error("Missing variant model: " + variant);
    const [sourceId, model] = best,
      id = base.id + "__" + entry.kitId;
    const sourceKit = source.weaponKits.find(k => k.id === model.kitId);
    // Preserve explicit editor kit deltas while removing/reapplying global kit costs.
    const kitDelta = adjustments.units[variant]?.["/weaponKits/" + source.weaponKits.indexOf(sourceKit) + "/cost"] || 0;
    const originalCost = model.cost - base.stats.cost + ((sourceKit?.conversionBaseCost ?? sourceKit?.cost ?? 0) - (sourceKit?.cost ?? 0)) + kitDelta;
    const kit = {
      id: entry.kitId,
      name: source.name,
      conversionBaseCost: originalCost,
      cost: Math.max(0, originalCost + (catalog.conversionRules.weapons.kitCostOffset || 0)),
      weapons: model.weapons.map((w) => w.id),
      variantUnitId: variant,
      variantKitId: model.kitId,
      localization: source.localization,
    };
    base.weaponKits = base.weaponKits.filter((k) => k.id !== kit.id).concat(kit);
    const composed = {
      ...model,
      prefabId: base.id,
      kitId: kit.id,
      chassisCost: base.stats.cost,
      cost: base.stats.cost + kit.cost,
      kitName: kit.name,
      kitLocalization: kit.localization,
      name: base.name,
      localization: base.localization,
      formOnly: false,
      variantUnitId: variant,
    };
    catalog.models[id] = composed;
    const art = catalog.units.find((u) => u.id === sourceId);
    if (!art) throw Error("Missing variant art: " + sourceId);
    catalog.units = catalog.units.filter((u) => u.id !== id);
    const nativeKit = model.nativeKitId || model.kitId;
    composed.nativeKitId = nativeKit;
    const decals = art.decals.map((layer) => {
      const condition = layer.visibleWhen?.kit;
      if (condition === undefined) return layer;
      const show = Array.isArray(condition)
        ? condition.includes(nativeKit)
        : condition === nativeKit;
      return {
        ...layer,
        visibleWhen: { ...layer.visibleWhen, kit: show ? kit.id : "__unused_variant__" },
      };
    });
    catalog.units.push({ ...art, id, kit: kit.id, decals });
    source.formOnly = true;
    source.kitFamily = base.id;
    // Old saved formations using any kit of the retired variant normalize to
    // the retained strongest outfit, without invalidating their model keys.
    for (const [oldId] of options.filter(([oldId]) => oldId !== id))
      catalog.models[oldId] = { ...composed, formOnly: true, canonicalModel: id };
  }
  catalog.unitFamilies = families || {};
  return catalog;
}
module.exports = { apply };
