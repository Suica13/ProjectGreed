"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, ".."),
  args = process.argv.slice(2);
const option = (key, value) => (args.includes(key) ? args[args.indexOf(key) + 1] : value);
const output = path.resolve(root, option("--output", "build/performance-v98/live.json"));
const html = path.resolve(root, option("--html", "public/client.html"));
const duration = Number(option("--duration", "20000"));
const delegate = args.includes("--delegate"),
  stopOnFinish = args.includes("--stop-on-finish");
const fog = option("--fog", "disabled"),
  profileEnabled = !args.includes("--no-profile");
if (!Number.isFinite(duration) || duration <= 0 || !["full", "visible", "disabled"].includes(fog))
  throw Error("Invalid duration or fog mode");
const stats = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    count: v.length,
    mean: values.reduce((a, b) => a + b, 0) / Math.max(1, v.length),
    p50: v[Math.floor(v.length * 0.5)] || 0,
    p95: v[Math.floor(v.length * 0.95)] || 0,
    max: v.at(-1) || 0,
  };
};
async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ channel: process.env.SLG_BROWSER || "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.exposeFunction("reportLiveProgress", (progress) => {
      const row = { timestamp: new Date().toISOString(), ...progress };
      fs.writeFileSync(output.replace(/\.json$/, "-progress.json"), JSON.stringify(row, null, 2));
      console.log(JSON.stringify(row));
    });
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      const original = createRoomEngine;
      createRoomEngine = (options) =>
        (window.livePerfEngine = original({
          ...options,
          aiDelayMs: 1,
          randomAIMoveDelay: () => 0,
        }));
      Formation.current = () => [{ unitId: "Type61", kitId: "standard" }];
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("battlefield");
    await page.locator("#createOfflineRoom").click();
    await page.evaluate(
      (fog) =>
        Net.request("configure_room", {
          ...Net.snapshot.settings,
          battleMode: "battlefield",
          fogMode: fog,
          battlefieldTeams: [
            { faction: "EFSF", era: "0079T1" },
            { faction: "ZEON", era: "0079T1" },
          ],
        }),
      fog,
    );
    await page.waitForFunction(
      () => !Net.awaiting && Net.snapshot.settings.battlefieldTeams[0].era === "0079T1",
    );
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await page.locator("#confirmDeployment").click();
    await page.waitForFunction(() => !BattleAssets.loading && Net.snapshot.phase === "idle");
    await page.evaluate(() => MapCamera.setPercent(1));
    if (delegate) {
      await page.evaluate(() => Net.request("set_ai_delegate", { delegate: true }));
      await page.waitForFunction(
        () => !Net.awaiting && Net.snapshot.delegatedSeats.includes(Net.seat),
      );
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    if (profileEnabled) await cdp.send("Profiler.start");
    const raw = await page.evaluate(
      async ({ duration, stopOnFinish }) => {
        const data = {
          frames: [],
          draw: [],
          update: [],
          ai: [],
          recovery: [],
          longTasks: [],
          rounds: [],
          revisions: 0,
        };
        const draw = drawMap,
          refresh = update,
          ai = Rules.battlefieldMode.aiChoice,
          recovery = Rules.hangars.recoveryOrder;
        drawMap = (...args) => {
          const at = performance.now();
          try {
            return draw(...args);
          } finally {
            data.draw.push(performance.now() - at);
          }
        };
        update = (...args) => {
          const at = performance.now();
          try {
            return refresh(...args);
          } finally {
            data.update.push(performance.now() - at);
          }
        };
        Rules.battlefieldMode.aiChoice = (...args) => {
          const at = performance.now();
          try {
            return ai(...args);
          } finally {
            data.ai.push(performance.now() - at);
          }
        };
        Rules.hangars.recoveryOrder = (...args) => {
          const at = performance.now();
          try {
            return recovery(...args);
          } finally {
            data.recovery.push(performance.now() - at);
          }
        };
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            data.longTasks.push(entry.duration);
            if (entry.duration > 200 && entry.duration > (data.slowest?.duration || 0))
              data.slowest = {
                duration: entry.duration,
                round: game.round,
                phase,
                game: structuredClone(game),
              };
          }
        });
        observer.observe({ type: "longtask", buffered: false });
        const started = performance.now();
        let previous = null,
          revision = Net.revision,
          heartbeat = 0;
        await new Promise((resolve) => {
          function sample(now) {
            if (previous !== null) data.frames.push(now - previous);
            previous = now;
            if (revision !== Net.revision) {
              data.revisions++;
              revision = Net.revision;
            }
            if (data.rounds.at(-1) !== game.round) data.rounds.push(game.round);
            if (now - started - heartbeat >= 30000) {
              heartbeat = now - started;
              void window.reportLiveProgress({
                elapsed: heartbeat,
                round: game.round,
                phase,
                units: game.units.length,
                authoritativeUnits: window.livePerfEngine?.rooms.get(Net.snapshot?.room)?.game.units
                  .length,
                longTasks: data.longTasks.length,
                heap: performance.memory?.usedJSHeapSize,
              });
            }
            if (phase === "idle" && Net.snapshot.turnDone?.[0] && Net.canAct() && !Net.awaiting)
              Net.request("end_turn");
            if (now - started < duration && !(stopOnFinish && game.winner !== null))
              requestAnimationFrame(sample);
            else resolve();
          }
          requestAnimationFrame(sample);
        });
        observer.disconnect();
        drawMap = draw;
        update = refresh;
        Rules.battlefieldMode.aiChoice = ai;
        Rules.hangars.recoveryOrder = recovery;
        data.elapsed = performance.now() - started;
        data.units = game.units.length;
        const authoritative = window.livePerfEngine?.rooms.get(Net.snapshot?.room)?.game;
        data.authoritativeUnits = authoritative?.units.length ?? data.units;
        data.livingUnits = authoritative?.units.filter((unit) => unit.hp > 0).length;
        data.winner = game.winner;
        data.sprites = SpriteRenderer.cacheStats();
        data.tiles = TileMapRenderer.cacheStats();
        data.heap = performance.memory?.usedJSHeapSize;
        Net.leave();
        return data;
      },
      { duration, stopOnFinish },
    );
    if (profileEnabled) {
      const { profile } = await cdp.send("Profiler.stop");
      fs.writeFileSync(output.replace(/\.json$/, "") + ".cpuprofile", JSON.stringify(profile));
    }
    const result = {
      timestamp: new Date().toISOString(),
      html,
      browser: browser.version(),
      fog,
      profileEnabled,
      elapsed: raw.elapsed,
      units: raw.units,
      authoritativeUnits: raw.authoritativeUnits,
      livingUnits: raw.livingUnits,
      winner: raw.winner,
      delegate,
      frames: stats(raw.frames),
      draw: stats(raw.draw),
      update: stats(raw.update),
      ai: stats(raw.ai),
      recovery: stats(raw.recovery),
      longTasks: raw.longTasks,
      slowest: raw.slowest
        ? { duration: raw.slowest.duration, round: raw.slowest.round, phase: raw.slowest.phase }
        : null,
      rounds: raw.rounds,
      revisions: raw.revisions,
      sprites: raw.sprites,
      tiles: raw.tiles,
      heap: raw.heap,
      errors,
    };
    if (raw.slowest)
      fs.writeFileSync(
        output.replace(/\.json$/, "-slow-game.json"),
        JSON.stringify(raw.slowest.game),
      );
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, longTasks: stats(raw.longTasks), output }, null, 2));
    if (errors.length) throw Error(errors.join("\n"));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
