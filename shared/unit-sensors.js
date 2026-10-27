"use strict";
// Sight and radar are independent, team-scoped facts. Only visible targets can be attacked.
const UnitSensors = {
  create({ modelOf, cells, onMap, minovskyAt = () => false }) {
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
        game.environment !== "space" &&
        game.tiles?.[unit.y]?.[unit.x] === "water";
      const head = unit.brokenParts?.head ? 0.75 : 1;
      return {
        ...base,
        sight: Math.round(base.sight * head),
        radar: base.radar * head,
        antiDetection: (base.antiDetection || 0) + (game && minovskyAt(game, unit) ? 5 : 0),
        stealth: !!base.stealth || (water && !!base.stealthAqua),
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
      ...(g.visionAreas || [])
        .filter((area) => area.team === team && area.expiresRound > g.round)
        .map((area) => ({
          ...area,
          sensorArea: true,
          sensors: { sight: area.sight, radar: area.radar, antiDetection: 0 },
        })),
    ];
    function crossLayer(g, a, b) {
      if (g.environment === "space") return 1;
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
    function detected(g, team, target) {
      if (!target || target.groundTarget) return false;
      if (target.team === team) return true;
      if (fogMode(g) === "disabled") return onMap(target);
      if (g.intel?.team === team) return g.intel.detectedIds.includes(target.id);
      if (target.detectedBy?.[team] >= g.round) return true;
      return allies(g, team).some(
        (u) =>
          (!u.sensorArea || !ranges(target, g).antiDetect) &&
          ranges(u, g).radar > 0 &&
          distance(u, target) + (ranges(target, g).antiDetection || 0) <
            ranges(u, g).radar *
              (u.sensorArea ? crossLayer(g, u, target) : 1) *
              (ranges(target, g).stealth ? 0.75 : 1) *
              (ranges(target, g).antiDetect ? 0.5 : 1),
      );
    }
    function visible(g, team, target) {
      if (!target || target.groundTarget) return false;
      if (target.team === team) return true;
      if (fogMode(g) !== "full") return onMap(target);
      if (g.intel?.team === team) return g.intel.visibleIds.includes(target.id);
      if (!onMap(target)) return false;
      return (
        allies(g, team).some((u) => distance(u, target) <= ranges(u, g).sight) ||
        (ranges(target, g).revealOnDetection && detected(g, team, target))
      );
    }
    function view(g, team) {
      if (g.intel?.team === team) return g.intel;
      const visibleIds = [],
        detectedIds = [],
        radarContacts = [];
      const observers = allies(g, team);
      const visibleCells = new Set();
      for (const u of observers) {
        const radius = ranges(u, g).sight;
        for (const p of footprint(u)) {
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
      if (fogMode(g) !== "full")
        for (let y = 0; y < g.tiles.length; y++)
          for (let x = 0; x < g.tiles[0].length; x++) visibleCells.add(x + "," + y);
      for (const u of g.units) {
        if (!onMap(u)) continue;
        const seen = visible(g, team, u),
          found = detected(g, team, u);
        if (seen) visibleIds.push(u.id);
        if (found) detectedIds.push(u.id);
        if (seen && ranges(u, g).revealOnDetection && found)
          for (const p of cells(u)) visibleCells.add(p.x + "," + p.y);
        if (u.team !== team && found && (!seen || fogMode(g) !== "full")) {
          const footprint = cells(u);
          radarContacts.push({
            x:
              (Math.min(...footprint.map((p) => p.x)) + Math.max(...footprint.map((p) => p.x))) / 2,
            y:
              (Math.min(...footprint.map((p) => p.y)) + Math.max(...footprint.map((p) => p.y))) / 2,
          });
        }
      }
      return { team, visibleIds, detectedIds, radarContacts, visibleCells: [...visibleCells] };
    }
    return { ranges, distance, visible, detected, view, scanTargets };
  },
};
if (typeof module !== "undefined") module.exports = UnitSensors;
