"use strict";
// Sight and radar are independent, team-scoped facts. Only visible targets can be attacked.
const UnitSensors = {
  create({ modelOf, cells, onMap, minovskyAt = () => false, spaceAt = g => g.environment === "space" }) {
    const fogMode = (game) =>
      ["full", "visible", "disabled"].includes(game?.fogMode) ? game.fogMode : "full";
    function ranges(unit, game = null) {
      const base = (unit.sensorArea ? unit.sensors : modelOf(unit).sensors) || {
        sight: 8,
        radar: 10,
        antiDetection: 0,
      };
      const water =
        !!game &&
        !unit.sensorArea &&
        !spaceAt(game, unit.x, unit.y) &&
        game.tiles?.[unit.y]?.[unit.x] === "water";
      const head = unit.brokenParts?.head ? 0.75 : 1;
      const climate = game?.climate || null;
      const sightFactor = climate?.sight ?? 1, radarFactor = climate?.radar ?? 1;
      return {
        ...base,
        sight: Math.round(base.sight * head * sightFactor),
        radar: base.radar * head * radarFactor,
        antiDetection: (base.antiDetection || 0) + (game && minovskyAt(game, unit) ? 5 : 0),
        stealth: !!base.stealth || (water && !!base.stealthAqua) || (!!unit.opticalCamouflage && unit.en > 0 && modelOf(unit).skills?.some(skill => skill.type === "optical_camouflage")),
        antiDetect: !!base.antiDetect || (water && !!base.antiDetectAqua),
      };
    }
    const footprint = (u) => (u.sensorArea || u.groundTarget ? [{ x: u.x, y: u.y }] : cells(u));
    function distance(a, b) {
      const ac = footprint(a),
        bc = footprint(b);
      let best = Infinity;
      for (const p of ac)
        for (const q of bc) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
      return best;
    }
    const allies = (g, team) => [
      ...g.units.filter((u) => u.team === team && onMap(u)),
      // Occupied objectives provide persistent sight without radar marking or connection requirements.
      ...(g.campaignBattlefield?.layout.nodes || [])
        .filter((node) => g.campaignBattlefield.owners[node.id] === team)
        .map((node) => ({ ...node, team, sensorArea: true,
          sensors: { sight: 5, radar: 0, antiDetection: 0 } })),
      ...(g.visionAreas || [])
        .filter((area) => area.team === team && area.expiresRound > g.round)
        .map((area) => ({
          ...area,
          sensorArea: true,
          sensors: { sight: area.sight, radar: area.radar, antiDetection: 0 },
        })),
    ];
    function crossLayer(g, a, b) {
      if (spaceAt(g, a.x, a.y) && spaceAt(g, b.x, b.y)) return 1;
      const airborne = (u) => !u.sensorArea && (u.flying || modelOf(u).movementType === "air");
      return !!airborne(a) !== !!airborne(b) ? 0.5 : 1;
    }
    function scanTargets(g, source, range, waterOnly = false) {
      return g.units.filter(
        (target) =>
          target.team !== source.team &&
          onMap(target) &&
          (!waterOnly || g.tiles[target.y][target.x] === "water") &&
          distance(source, target) <= range &&
          distance(source, target) + (ranges(target, g).antiDetection || 0) <
            range *
              crossLayer(g, source, target) *
              (ranges(target, g).stealth ? 0.75 : 1) *
              (ranges(target, g).antiDetect ? 0.5 : 1),
      );
    }
    function detected(g, team, target, query = null) {
      if (!target || target.groundTarget) return false;
      if (target.team === team) return true;
      if (fogMode(g) === "disabled") return onMap(target);
      if (g.intel?.team === team) return g.intel.detectedIds.includes(target.id);
      if (target.detectedBy?.[team] >= g.round) return true;
      const rangeOf = query?.rangeOf || (unit => ranges(unit, g));
      const distanceOf = query?.distanceOf || distance;
      return (query?.observers || allies(g, team)).some(
        (u) =>
          (!u.sensorArea || !rangeOf(target).antiDetect) &&
          rangeOf(u).radar > 0 &&
          distanceOf(u, target) + (rangeOf(target).antiDetection || 0) <
            rangeOf(u).radar *
              (u.sensorArea ? crossLayer(g, u, target) : 1) *
              (rangeOf(target).stealth ? 0.75 : 1) *
              (rangeOf(target).antiDetect ? 0.5 : 1),
      );
    }
    function visible(g, team, target, query = null) {
      if (!target || target.groundTarget) return false;
      if (target.team === team) return true;
      if (fogMode(g) !== "full") return onMap(target);
      if (g.intel?.team === team) return g.intel.visibleIds.includes(target.id);
      if (!onMap(target)) return false;
      const rangeOf = query?.rangeOf || (unit => ranges(unit, g));
      const distanceOf = query?.distanceOf || distance;
      return (
        (query?.observers || allies(g, team)).some((u) => distanceOf(u, target) <= rangeOf(u).sight) ||
        (rangeOf(target).revealOnDetection && detected(g, team, target, query))
      );
    }
    const fullMapCells = new WeakMap();
    function mapCellOrder(g) {
      const width = g.tiles[0].length, height = g.tiles.length;
      let cached = fullMapCells.get(g.tiles);
      if (!cached || cached.width !== width || cached.height !== height) {
        const cells = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push(x + "," + y);
        fullMapCells.set(g.tiles, cached = { width, height, cells });
      }
      return cached.cells;
    }
    function orderedVisibility(g, visible) {
      const ordered = mapCellOrder(g).filter(id => visible.has(id));
      // Keep explicit reveal markers even for custom callers with off-map
      // targets. Normal battles only contain legal, in-bounds occupied cells.
      if (ordered.length !== visible.size) {
        const present = new Set(ordered);
        for (const id of visible) if (!present.has(id)) ordered.push(id);
      }
      return ordered;
    }
    function view(g, team) {
      if (g.intel?.team === team) return g.intel;
      const visibleIds = [],
        detectedIds = [],
        radarContacts = [];
      const observers = allies(g, team);
      // A query sees one immutable board. Share ranges and footprints within it,
      // never across actions where damage, weather or movement can change them.
      const rangeCache = new WeakMap(), footprintCache = new WeakMap();
      const rangeOf = unit => {
        if (!rangeCache.has(unit)) rangeCache.set(unit, ranges(unit, g));
        return rangeCache.get(unit);
      };
      const footprintOf = unit => {
        if (!footprintCache.has(unit)) footprintCache.set(unit, footprint(unit));
        return footprintCache.get(unit);
      };
      const query = { observers, rangeOf, distanceOf(a, b) {
        let nearest = Infinity;
        for (const p of footprintOf(a)) for (const q of footprintOf(b))
          nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y));
        return nearest;
      } };
      const fullFog = fogMode(g) === "full", visibleCells = fullFog ? new Set() : null;
      for (const u of fullFog ? observers : []) {
        const radius = rangeOf(u).sight;
        for (const p of footprintOf(u)) {
          for (
            let y = Math.max(0, Math.ceil(p.y - radius));
            y <= Math.min(g.tiles.length - 1, Math.floor(p.y + radius));
            y++
          )
            for (
              let x = Math.max(0, Math.ceil(p.x - radius));
              x <= Math.min(g.tiles[0].length - 1, Math.floor(p.x + radius));
              x++
            )
              if (Math.hypot(x - p.x, y - p.y) <= radius) visibleCells.add(x + "," + y);
        }
      }
      for (const u of g.units) {
        if (!onMap(u)) continue;
        const seen = visible(g, team, u, query),
          found = detected(g, team, u, query);
        if (seen) visibleIds.push(u.id);
        if (found) detectedIds.push(u.id);
        if (visibleCells && seen && rangeOf(u).revealOnDetection && found)
          for (const p of footprintOf(u)) visibleCells.add(p.x + "," + p.y);
        if (u.team !== team && found && (!seen || fogMode(g) !== "full")) {
          const footprint = footprintOf(u);
          radarContacts.push({
            x:
              (Math.min(...footprint.map((p) => p.x)) + Math.max(...footprint.map((p) => p.x))) / 2,
            y:
              (Math.min(...footprint.map((p) => p.y)) + Math.max(...footprint.map((p) => p.y))) / 2,
          });
        }
      }
      return { team, visibleIds, detectedIds, radarContacts,
        visibleCells: visibleCells ? orderedVisibility(g, visibleCells) : mapCellOrder(g).slice() };
    }
    return { ranges, distance, visible, detected, view, scanTargets };
  },
};
if (typeof module !== "undefined") module.exports = UnitSensors;
