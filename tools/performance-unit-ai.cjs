"use strict";
const { performance } = require("node:perf_hooks");
const G = require("../shared/rules.js");
function fixture() {
  const e = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 71, [[e], [e]], false, { fogMode: "disabled" });
  g.tiles.forEach((r) => r.fill("plain"));
  const [a, b] = g.units;
  g.units = Array.from({ length: 16 }, (_, i) => ({
    ...structuredClone(a),
    id: "friend-" + i,
    x: i ? 2 + (i % 4) * 2 : 5,
    y: i ? 13 + Math.floor(i / 4) * 2 : 5,
  })).concat(
    Array.from({ length: 16 }, (_, i) => ({
      ...structuredClone(b),
      id: "enemy-" + i,
      x: 10 + (i % 4),
      y: 5 + Math.floor(i / 4),
    })),
  );
  return g;
}
function run() {
  const g = fixture(),
    u = g.units[0],
    samples = [];
  for (let i = 0; i < 12; i++) G.aiChoice(g, u);
  for (let i = 0; i < 60; i++) {
    const at = performance.now(),
      choice = G.aiChoice(g, u);
    samples.push({ ms: performance.now() - at, choice });
  }
  const launch = fixture(),
    passenger = launch.units[0],
    e = { unitId: "Medea", kitId: "standard" };
  const carrier = G.create(false, 1, [[e], [e]], false).units[0];
  Object.assign(carrier, { id: "carrier", x: 8, y: 7 });
  passenger.embarked = { carrierId: carrier.id, hangarId: "Hangar_1" };
  launch.units.push(carrier);
  const exits = G.hangars.launchCells(launch, passenger).filter((point) => !point.boarding);
  launch.units
    .filter((v) => v.team === passenger.team && v !== passenger && v !== carrier)
    .slice(0, 4)
    .forEach((v, i) => Object.assign(v, { x: exits[i].x, y: exits[i].y }));
  const groupedExits = G.hangars
    .launchCells(launch, passenger)
    .filter((point) => point.squadTarget).length;
  for (let i = 0; i < 4; i++) G.aiLaunchChoice(launch, passenger);
  const launchSamples = [];
  let choice;
  let tacticBuilds = 0;
  const original = G.aiTactics.forUnit;
  G.aiTactics.forUnit = (...args) => {
    tacticBuilds++;
    return original(...args);
  };
  try {
    for (let i = 0; i < 20; i++) {
      const at = performance.now();
      choice = G.aiLaunchChoice(launch, passenger);
      launchSamples.push(performance.now() - at);
    }
  } finally {
    G.aiTactics.forUnit = original;
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return {
    units: g.units.length,
    meanMs: samples.reduce((n, r) => n + r.ms, 0) / samples.length,
    medianMs: median(samples.map((s) => s.ms)),
    choice: samples[0].choice,
    launch: {
      medianMs: median(launchSamples),
      groupedExits,
      tacticBuilds: tacticBuilds / launchSamples.length,
      choice,
    },
  };
}
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { fixture, run };
