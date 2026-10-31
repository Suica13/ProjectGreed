"use strict";
// Compile license prices from archived factory/refit data; never alter unit files.
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
function roundPrice(value) {
  return value > 0 ? Math.max(50, Math.round(value / 50) * 50) : 0;
}
function compile(catalog, units) {
  const result = {};
  const byId = new Map(units.map((p) => [p.id, p]));
  for (const p of units) {
    if (p.formOnly || p.requiredPilotId || p.wip) continue;
    const factory = catalog.offers[catalog.baseModels[p.id]];
    if (factory && p.production?.enabled !== false)
      result[p.id] = {
        unitId: p.id,
        faction: factory.faction,
        ...(p.availableFactions ? { availableFactions: p.availableFactions } : {}),
        money: roundPrice(factory.money / factory.quantity),
        supplies: roundPrice(factory.supplies / factory.quantity),
        sourceType: "factory",
        source: factory.source,
      };
  }
  for (const p of units)
    for (const route of p.refits || []) {
      const target = byId.get(route.unitId);
      if (
        route.blocked ||
        route.pilotId ||
        !target ||
        target.formOnly ||
        target.requiredPilotId ||
        target.wip ||
        target.production?.enabled !== false
      )
        continue;
      const offer = {
        unitId: target.id,
        faction: target.tags.find((tag) => ["EFSF", "ZEON"].includes(tag)),
        ...(target.availableFactions ? { availableFactions: target.availableFactions } : {}),
        money: roundPrice(route.money),
        supplies: roundPrice(route.supplies),
        sourceType: "native-refit",
        source: route.source,
      };
      const old = result[target.id];
      if (!old || offer.money + offer.supplies < old.money + old.supplies)
        result[target.id] = offer;
    }
  return result;
}
function archive(catalog, units) {
  const result = {};
  for (const p of units) {
    const baseKitId = catalog.defaultKits[p.id] || p.weaponKits[0].id;
    const base = catalog.offers[p.id + "__" + baseKitId];
    const entry = {
      baseKitId,
      base: base
        ? {
            money: base.money,
            supplies: base.supplies,
            quantity: base.quantity,
            source: base.source,
          }
        : null,
      kits: {},
    };
    for (const kit of p.weaponKits) {
      const offer = catalog.offers[p.id + "__" + kit.id];
      if (!offer) {
        entry.kits[kit.id] = { available: false };
        continue;
      }
      const money = offer.money / offer.quantity,
        supplies = offer.supplies / offer.quantity;
      entry.kits[kit.id] = {
        available: true,
        equipmentIndex: offer.equipmentIndex,
        batchMoney: offer.money,
        batchSupplies: offer.supplies,
        quantity: offer.quantity,
        unitMoney: money,
        unitSupplies: supplies,
        source: offer.source,
        ...(base
          ? {
              moneyDifference: money - base.money / base.quantity,
              suppliesDifference: supplies - base.supplies / base.quantity,
            }
          : {}),
      };
    }
    result[p.id] = entry;
  }
  return result;
}
if (require.main === module) {
  const file = path.join(root, "shared/production-catalog.json"),
    catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const registry = JSON.parse(fs.readFileSync(path.join(root, "assets/unit-catalog.json"), "utf8"));
  const units = registry.units.map((ref) =>
    JSON.parse(fs.readFileSync(path.join(root, "assets", ref), "utf8")),
  );
  catalog.licenseOffers = compile(catalog, units);
  catalog.nativePricing = archive(catalog, units);
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
  console.log("License offers:", Object.keys(catalog.licenseOffers).length);
}
module.exports = { compile, archive, roundPrice };
