"use strict";

// Collision/deployment cells are independent of native ship artwork.
function compactShipFootprint(prefab) {
  if (!prefab.stats?.ship) return prefab;
  const previous = prefab.stats.footprint;
  if (!previous) return prefab;
  prefab.sourceStats ||= {};
  prefab.sourceStats.shipFootprintBeforeCompaction ||= { ...previous };
  prefab.stats.footprint = { width: previous.width > 1 ? 2 : 1, height: 2 };
  return prefab;
}
module.exports = { compactShipFootprint };
