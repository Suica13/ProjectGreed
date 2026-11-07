"use strict";
// Repeated scene lifetime stress. Timings during GC/other tests are not FPS comparisons.
const fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, ".."),
  args = process.argv.slice(2);
const option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const duration = Number(option("--duration", "1800000"));
const output = path.resolve(root, option("--output", "build/performance-v98/scene-soak.json"));
const html = path.resolve(root, option("--html", "public/client.html"));
async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ channel: process.env.SLG_BROWSER || "msedge" });
  const report = {
    started: new Date().toISOString(),
    html,
    browser: browser.version(),
    shadows: args.includes("--shadows"),
    cycles: [],
    errors: [],
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("pageerror", (error) => report.errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => assetsReady);
    if (args.includes("--shadows"))
      await page.evaluate(() => {
        ClientSettings.unitShadows = () => true;
      });
    const started = Date.now();
    let cycle = 0;
    while (Date.now() - started < duration) {
      const viewport = cycle % 2 ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
      await page.setViewportSize(viewport);
      const result = await page.evaluate(async (cycle) => {
        Net.leave();
        setPageView("room");
        CombatPlayback.reset();
        PlanningUI.reset();
        MapEffects.reset();
        const entry = { unitId: "Type61", kitId: "standard" };
        const maps = Object.values(Rules.catalog.maps)
          .filter((map) => map.tileMap && map.environment !== "space")
          .slice(0, 2);
        const map = maps[cycle % 3 === 2 ? 1 : 0];
        const g = Rules.create(false, cycle + 1, [[entry], [entry]], false, {
          fogMode: "disabled",
        });
        g.mapId = map.id;
        g.tiles = structuredClone(map.tiles);
        g.environment = map.environment;
        const ids = ["Type61", "Medea", "SalamisClass", "MA_08", "RGM_79", "MS_06F"];
        const entries = ids.map((id) => ({
          unitId: id,
          kitId: ART.prefabs.find((p) => p.id === id).weaponKits[0].id,
        }));
        g.units = Array.from({ length: 96 }, (_, i) =>
          Rules.makeUnit(
            entries[i % entries.length],
            i % 2,
            "cycle-" + i,
            { x: 3 + (i % 12) * 2, y: 4 + Math.floor(i / 12) * 3 },
            (i % 4) * 90,
            cycle + 1,
          ),
        );
        g.deployment = null;
        g.ai = false;
        g.climateSettings = {
          weather: ["clear", "heavy_rain", "blizzard"][cycle % 3],
          dayNight: cycle % 2 ? "late_night" : "noon",
        };
        const snapshot = {
          room: "SOAK",
          matchId: "scene-" + cycle,
          started: true,
          phase: "idle",
          game: g,
        };
        const loading = new Promise((resolve) => {
          if (!BattleAssets.guard(snapshot, resolve)) resolve();
        });
        const cleared = SpriteRenderer.cacheStats();
        if (
          cleared.idle ||
          cleared.shadow ||
          cleared.outlines ||
          TileMapRenderer.cacheStats().chunks
        )
          throw Error("Previous scene canvases retained");
        await loading;
        game = g;
        phase = "idle";
        mode = "select";
        selected = moving = battleView = null;
        setPageView("game");
        MapCamera.reset();
        MapCamera.setPercent(25);
        update();
        const start = performance.now(),
          samples = [];
        await new Promise((resolve) => {
          let lastStep = -1;
          function exercise(now) {
            const step = Math.floor((now - start) / 500);
            if (step !== lastStep) {
              lastStep = step;
              MapCamera.setPercent([1, 25, 50, 100, 25, 0, 65, 25][step % 8]);
              if (step % 3 === 0) select(g.units[(step * 2) % g.units.length].id);
              if (step % 5 === 0) {
                const actor = g.units[2];
                PlanningUI.move({
                  unitId: actor.id,
                  from: { x: actor.x, y: actor.y },
                  path: [
                    { x: actor.x + 1, y: actor.y },
                    { x: actor.x + 2, y: actor.y },
                  ],
                });
              }
            }
            const at = performance.now();
            drawMap(now);
            samples.push(performance.now() - at);
            if (now - start < 8000) requestAnimationFrame(exercise);
            else resolve();
          }
          requestAnimationFrame(exercise);
        });
        const same = JSON.stringify(SpriteRenderer.cacheStats());
        BattleAssets.guard(snapshot, () => {});
        if (same !== JSON.stringify(SpriteRenderer.cacheStats()))
          throw Error("Unchanged snapshot discarded resources");
        const sprites = SpriteRenderer.cacheStats(),
          tiles = TileMapRenderer.cacheStats();
        if (
          sprites.idlePixels > 16 * 1024 * 1024 ||
          sprites.shadowPixels > 8 * 1024 * 1024 ||
          tiles.pixels > 8 * 1024 * 1024
        )
          throw Error("Cache budget exceeded");
        samples.sort((a, b) => a - b);
        const active = {
          sprites,
          tiles,
          p50: samples[Math.floor(samples.length * 0.5)],
          p95: samples[Math.floor(samples.length * 0.95)],
        };
        setPageView("room");
        BattleAssets.release();
        PlanningUI.reset();
        MapEffects.reset();
        const released = SpriteRenderer.cacheStats(),
          releasedTiles = TileMapRenderer.cacheStats();
        if (
          released.idlePixels +
          released.shadowPixels +
          released.outlinePixels +
          releasedTiles.pixels
        )
          throw Error("Released scene still owns derived canvases");
        game = Rules.create(false, 1, [[entry], [entry]], false);
        selected = moving = battleView = null;
        return { cycle, map: map.id, active, released, releasedTiles };
      }, cycle);
      if (cycle % 10 === 0) await cdp.send("HeapProfiler.collectGarbage");
      result.viewport = viewport;
      result.dom = await cdp.send("Memory.getDOMCounters");
      result.heap = await page.evaluate(() => performance.memory?.usedJSHeapSize);
      result.heapUsage = await cdp.send("Runtime.getHeapUsage");
      result.collected = cycle % 10 === 0;
      result.elapsed = Date.now() - started;
      report.cycles.push(result);
      cycle++;
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      if (cycle % 5 === 0)
        console.log(
          JSON.stringify({
            cycle,
            elapsed: result.elapsed,
            heap: result.heap,
            actualHeap: result.heapUsage.usedSize,
            dom: result.dom,
            errors: report.errors.length,
          }),
        );
      if (report.errors.length) throw Error(report.errors.join("\n"));
    }
    report.finished = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ cycles: cycle, elapsed: Date.now() - started, output }));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
