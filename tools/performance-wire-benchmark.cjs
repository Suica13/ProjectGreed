"use strict";
const fs = require("node:fs"),
  { performance } = require("node:perf_hooks"),
  zlib = require("node:zlib"),
  G = require("../shared/rules.js"),
  Wire = require("../shared/state-wire.js");
const formation = () => Array.from({ length: 24 }, () => ({ unitId: "Type61", kitId: "standard" }));
const game = G.create(false, 7319, [formation(), formation()], false, {
  costLimit: 99999,
  unitLimit: 72,
});
delete game.seed;
delete game.partSeed;
const state = {
    type: "state",
    room: "PERF",
    matchId: "benchmark",
    viewTeam: 0,
    you: { id: "p", seat: 0 },
    revision: 0,
    game,
    log: [],
  },
  encoder = Wire.createEncoder(),
  decoder = Wire.createDecoder();
const measurements = {
  units: game.units.length,
  frames: 100,
  fullBytes: 0,
  deltaBytes: 0,
  deflatedFullBytes: 0,
  deflatedDeltaBytes: 0,
  fullSerializeMs: 0,
  deltaEncodeMs: 0,
  fullDeflateMs: 0,
  deltaDeflateMs: 0,
};
for (let i = 0; i < measurements.frames; i++) {
  state.revision++;
  state.game.units[i % game.units.length].hp--;
  state.ack = "request-" + i;
  let at = performance.now();
  const full = JSON.stringify(state);
  measurements.fullSerializeMs += performance.now() - at;
  at = performance.now();
  const encoded = encoder.encode(state);
  measurements.deltaEncodeMs += performance.now() - at;
  measurements.fullBytes += Buffer.byteLength(full);
  measurements.deltaBytes += Buffer.byteLength(encoded);
  at = performance.now();
  measurements.deflatedFullBytes += zlib.deflateRawSync(full, { level: 3 }).length;
  measurements.fullDeflateMs += performance.now() - at;
  at = performance.now();
  measurements.deflatedDeltaBytes += zlib.deflateRawSync(encoded, { level: 3 }).length;
  measurements.deltaDeflateMs += performance.now() - at;
  require("node:assert/strict").deepEqual(decoder.decode(JSON.parse(encoded)), state);
}
fs.mkdirSync(".openai", { recursive: true });
fs.writeFileSync(".openai/performance-wire.json", JSON.stringify(measurements, null, 2));
console.log(JSON.stringify(measurements, null, 2));
