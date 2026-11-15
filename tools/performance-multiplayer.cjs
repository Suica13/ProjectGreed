"use strict";
// Reproduce large-room server/wire and browser snapshot workloads.
// Actor movement is synthetic; this is CPU profiling, not Internet RTT or GPU FPS.
// All reports and profiles belong under tmp/verification/reports/.
const fs = require("node:fs"),
  path = require("node:path"),
  { performance } = require("node:perf_hooks"),
  { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test"),
  G = require(path.resolve("shared/rules")),
  Wire = require(path.resolve("shared/state-wire"));
const { createRoomEngine } = require(path.resolve("shared/room-engine"));
const args = process.argv.slice(2),
  option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const count = Number(option("--units", 300)),
  samples = Number(option("--samples", 40)),
  players = Number(option("--players", 6));
if (
  ![2, 4, 6, 8, 10].includes(players) ||
  !Number.isInteger(samples) ||
  samples < 5 ||
  !Number.isInteger(count) ||
  count < players
)
  throw Error("Invalid benchmark size");
const output = path.resolve(option("--output", "tmp/verification/reports/multiplayer.json"));
const summary = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / Math.max(1, s.length),
    p50: s[Math.floor(s.length * 0.5)] || 0,
    p95: s[Math.floor(s.length * 0.95)] || 0,
    max: s.at(-1) || 0,
  };
};
async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let serial = 0,
    measuring = false;
  const sockets = [],
    encoders = new Map(),
    wire = [],
    broadcast = [],
    messages = [];
  const serializationBatches = new WeakMap();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "perf-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send(ws, state, batchContext) {
      if (state.type !== "state") return;
      if (!encoders.has(ws)) encoders.set(ws, Wire.createEncoder());
      let cache;
      if (batchContext) {
        cache = serializationBatches.get(batchContext);
        if (!cache) serializationBatches.set(batchContext, (cache = new WeakMap()));
      }
      const at = performance.now(),
        encoded = encoders.get(ws).encode(state, cache);
      if (measuring) wire.push(performance.now() - at);
      if (measuring && ws === sockets[0]) messages.push(encoded);
    },
  });
  try {
    for (let i = 0; i < players; i++) {
      const ws = { readyState: 1 };
      sockets.push(ws);
      engine.join(ws, {
        mode: i ? "join" : "create",
        room: "MP-PERF",
        roomMode: "battlefield",
        characterFaction: "PMC",
        inventory: { Medea: 5 },
        licenses: { Medea: true },
      });
    }
    const room = engine.rooms.get("MP-PERF"),
      armies = Array(12).fill(null);
    for (const p of room.seats.filter((p) => p && !p.bot))
      armies[p.seat] = [{ unitId: "Medea", kitId: "standard" }];
    room.settings.fogMode = option("--fog", "disabled");
    room.game = G.create(false, 7319, armies, false, room.settings);
    room.game.deployment = null;
    for (let i = room.game.units.length; i < count; i++) {
      const seat = 2 + (i % players),
        id = i % 2 ? "RGM_79" : "MS_06F",
        entry = { unitId: id, kitId: G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id };
      const u = G.makeUnit(
        entry,
        seat,
        "load-" + i,
        { x: 3 + (i % 18) * 3, y: 4 + Math.floor(i / 18) * 2 },
        0,
        7319,
      );
      u.formationIndex = i;
      room.game.units.push(u);
    }
    room.game.units.forEach((u, i) => (u.customName = "Load " + i));
    Object.assign(room, {
      started: true,
      matchId: "load-benchmark",
      phase: "idle",
      activeSeats: room.seats.map(Boolean),
      turnDone: Array(12).fill(false),
    });
    room.log = Array.from({ length: 200 }, (_, i) => "战场记录 " + i);
    room.teamLogs = { 0: room.log, 1: room.log };
    for (const encoder of encoders.values()) encoder.reset();
    const actor = room.game.units.find((u) => G.ownerOf(u) === 2 && !u.facility);
    measuring = true;
    const profiler = new (require("node:inspector").Session)();
    profiler.connect();
    const post = (method) =>
      new Promise((resolve, reject) =>
        profiler.post(method, (error, result) => (error ? reject(error) : resolve(result))),
      );
    await post("Profiler.enable");
    await post("Profiler.start");
    for (let i = 0; i < samples; i++) {
      room.revision++;
      actor.angle = (i % 4) * 90;
      room.lastEvent = { id: "frame-" + i, type: "perf_tick" };
      const at = performance.now();
      engine.broadcast(room);
      broadcast.push(performance.now() - at);
    }
    const profile = await post("Profiler.stop");
    profiler.disconnect();
    fs.writeFileSync(
      output.replace(".json", "-server.cpuprofile"),
      JSON.stringify(profile.profile),
    );
    const report = {
      players,
      units: room.game.units.length,
      samples,
      fog: room.settings.fogMode,
      note: "Local server broadcast, wire and browser snapshot CPU. Not WAN RTT or physical GPU FPS.",
      server: {
        broadcastMs: summary(broadcast.slice(1)),
        encodePerRecipientMs: summary(wire.slice(players)),
        bytes: messages.reduce((n, m) => n + Buffer.byteLength(m), 0),
      },
      client: [],
      errors: [],
    };
    engine.close();
    const browser = await chromium.launch({ channel: process.env.SLG_BROWSER || "msedge" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      page.on("pageerror", (e) => report.errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
      await page.waitForFunction(() => assetsReady);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable");
      for (const choose of [false, true]) {
        await page.evaluate(
          async ({ messages, choose }) => {
            Net.leave();
            const socket = { readyState: 1, send() {}, close() {} };
            Net.beginLocal(socket);
            Net.local = false;
            const first = StateWire.createDecoder().decode(JSON.parse(messages[0]));
            Net.receive(
              { type: "joined", seat: first.you.seat, memberId: first.you.id, token: "benchmark" },
              socket,
            );
            Net.receive(first, socket);
            while (BattleAssets.loading) await new Promise((resolve) => setTimeout(resolve, 10));
            MapCamera.setPercent(25);
            selected = choose
              ? game.units.find((u) => u.ownerSeat === Net.seat && !u.facility).id
              : null;
            update();
          },
          { messages, choose },
        );
        await cdp.send("Profiler.start");
        const result = await page.evaluate(async (messages) => {
          const decoder = StateWire.createDecoder(),
            decode = [],
            apply = [],
            draw = [],
            interval = [];
          decoder.decode(JSON.parse(messages[0]));
          let last = null;
          for (const encoded of messages.slice(1)) {
            const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
            if (last !== null) interval.push(timestamp - last);
            last = timestamp;
            let at = performance.now();
            const snapshot = decoder.decode(JSON.parse(encoded));
            decode.push(performance.now() - at);
            at = performance.now();
            Net.receive(snapshot, Net.socket);
            apply.push(performance.now() - at);
            at = performance.now();
            drawMap(performance.now());
            draw.push(performance.now() - at);
          }
          return { decode, apply, draw, interval };
        }, messages);
        const cpu = await cdp.send("Profiler.stop");
        fs.writeFileSync(
          output.replace(".json", choose ? "-selected.cpuprofile" : "-idle.cpuprofile"),
          JSON.stringify(cpu.profile),
        );
        report.client.push({
          scenario: choose ? "selected" : "idle",
          ...Object.fromEntries(Object.entries(result).map(([k, v]) => [k + "Ms", summary(v)])),
        });
      }
    } finally {
      await browser.close();
    }
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) throw Error(report.errors.join("\n"));
  } finally {
    engine.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
