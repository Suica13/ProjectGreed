"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  assets = path.join(root, "assets");
const M = require(path.join(root, "shared/map-document.js"));

function ensureDeploymentCapacity(map, maxUnits) {
  for (const [seat, area] of map.deploymentAreas.entries()) {
    const passable = (x, y) => !["rock", "water"].includes(map.tiles[y][x]);
    const sufficient = () => {
      let cells = 0,
        hulls = 0;
      for (let y = area.y; y < area.y + area.height; y++)
        for (let x = area.x; x < area.x + area.width; x++) if (passable(x, y)) cells++;
      for (let y = area.y; y + 1 < area.y + area.height; y += 2)
        for (let x = area.x; x + 1 < area.x + area.width; x += 2)
          if (passable(x, y) && passable(x + 1, y) && passable(x, y + 1) && passable(x + 1, y + 1))
            hulls++;
      return cells >= maxUnits && hulls >= Math.floor(maxUnits / 4);
    };
    while (!sufficient() && area.width < Math.floor(map.width / 2)) {
      area.width++;
      if (seat % 2) area.x = map.width - area.width;
    }
    if (!sufficient()) throw Error("Insufficient deployment capacity: " + map.id + "/" + seat);
  }
  if (map.tileMap) map.tileMap.deploymentAreas = structuredClone(map.deploymentAreas);
  return map;
}
function compactMap(source, maxUnits = 72) {
  if (source.encounterScale?.version === 1)
    return ensureDeploymentCapacity(structuredClone(source), maxUnits);
  const map = structuredClone(source),
    oldWidth = map.width,
    oldHeight = map.height;
  const width = Math.round(oldWidth * 0.75),
    height = Math.round(oldHeight * 0.75);
  const sx = width / oldWidth,
    sy = height / oldHeight;
  const sample = (data) =>
    Array.from({ length: height }, (_, y) =>
      Array.from(
        { length: width },
        (_, x) =>
          data[Math.min(oldHeight - 1, Math.floor((y + 0.5) / sy))][
            Math.min(oldWidth - 1, Math.floor((x + 0.5) / sx))
          ],
      ),
    );
  map.width = width;
  map.height = height;
  map.tiles = sample(map.tiles);
  if (map.cellEnvironments) map.cellEnvironments = sample(map.cellEnvironments);
  map.deploymentRadius = Math.max(1, Math.round(map.deploymentRadius * 0.75));
  map.deploymentAreas = source.deploymentAreas.map((area) => {
    const x = Math.round(area.x * sx),
      y = Math.round(area.y * sy);
    return {
      x,
      y,
      width: Math.max(1, Math.round((area.x + area.width) * sx) - x),
      height: Math.max(1, Math.round((area.y + area.height) * sy) - y),
    };
  });
  // Keep every seat deployable after resampling. Expand edge strips inward when
  // a shorter map would otherwise leave fewer than 72 passable deployment cells.
  ensureDeploymentCapacity(map, maxUnits);
  map.spawns = source.spawns.map((spawn, seat) => {
    const area = map.deploymentAreas[seat];
    return {
      ...spawn,
      x: Math.max(area.x, Math.min(area.x + area.width - 1, Math.floor((spawn.x + 0.5) * sx))),
      y: Math.max(area.y, Math.min(area.y + area.height - 1, Math.floor((spawn.y + 0.5) * sy))),
    };
  });
  if (map.deploymentExpansion) {
    const old = source.deploymentExpansion,
      value = map.deploymentExpansion;
    value.addedLeft = Math.round(old.addedLeft * sx);
    value.addedRight = Math.round(old.addedRight * sx);
    value.baseWidth = width - value.addedLeft - value.addedRight;
    value.addedTop = Math.round((old.addedTop || 0) * sy);
    value.addedBottom = Math.round((old.addedBottom || 0) * sy);
    value.baseHeight = height - value.addedTop - value.addedBottom;
  }
  if (map.tileMap) {
    const doc = map.tileMap;
    for (const layer of doc.layers) {
      if (layer.type === "tile") {
        const rows = Array.from({ length: oldHeight }, (_, y) =>
          layer.data.slice(y * oldWidth, (y + 1) * oldWidth),
        );
        layer.data = sample(rows).flat();
      } else if (layer.image) {
        layer.image.x *= sx;
        layer.image.y *= sy;
        layer.image.width *= sx;
        layer.image.height *= sy;
      }
    }
    for (const unit of doc.units || []) {
      unit.x = Math.min(width - 1, Math.floor((unit.x + 0.5) * sx));
      unit.y = Math.min(height - 1, Math.floor((unit.y + 0.5) * sy));
    }
    Object.assign(doc, {
      width,
      height,
      spawns: structuredClone(map.spawns),
      deploymentAreas: structuredClone(map.deploymentAreas),
    });
    M.validate(doc);
    const terrain = M.terrainData(doc);
    map.tiles = terrain.tiles;
    map.cellEnvironments = terrain.cellEnvironments;
  }
  map.encounterScale = { version: 1, factor: 0.75, sourceWidth: oldWidth, sourceHeight: oldHeight };
  return map;
}

function main() {
  const catalogFile = path.join(assets, "unit-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8")),
    overrides = {};
  for (const ref of catalog.maps.filter((ref) => ref.startsWith("maps/encounter/")))
    overrides[ref] = compactMap(
      JSON.parse(fs.readFileSync(path.join(assets, ref), "utf8")),
      catalog.formation.maxUnits,
    );
  const defaultMap = Object.values(overrides).find((map) => map.id === catalog.defaultMap);
  catalog.map = { width: defaultMap.width, height: defaultMap.height };
  catalog.deployment.spawns = defaultMap.spawns.map(({ x, y }) => ({ x, y }));
  require(path.join(root, "tools/load-catalog.cjs")).loadCatalog({
    catalogOverride: catalog,
    mapOverrides: overrides,
  });
  if (!process.argv.includes("--check")) {
    for (const [ref, map] of Object.entries(overrides))
      fs.writeFileSync(path.join(assets, ref), JSON.stringify(map, null, 2) + "\n");
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + "\n");
  }
  console.log(
    JSON.stringify(
      Object.values(overrides).map((map) => ({
        id: map.id,
        before: [map.encounterScale.sourceWidth, map.encounterScale.sourceHeight],
        after: [map.width, map.height],
      })),
      null,
      2,
    ),
  );
}
module.exports = { compactMap };
if (require.main === module) main();
