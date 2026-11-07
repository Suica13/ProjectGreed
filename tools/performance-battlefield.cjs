"use strict";
// Repeatable presentation CPU and frame-interval samples, not a GPU FPS guarantee.
const fs = require("node:fs"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const output = path.resolve(root, option("--output", "build/performance-v98/render.json"));
const html = path.resolve(root, option("--html", "public/client.html"));
const samples = Number(option("--samples", "90"));
const fixturePath = option("--game", null);
const fixture = fixturePath
  ? JSON.parse(fs.readFileSync(path.resolve(root, fixturePath), "utf8"))
  : null;
const sizes = fixture
  ? [fixture.units.length]
  : option("--sizes", "50,150,300").split(",").map(Number);
if (
  !Number.isInteger(samples) ||
  samples < 2 ||
  sizes.some((size) => !Number.isInteger(size) || size < 1)
)
  throw Error("Samples must be at least 2; unit counts must be positive integers");
const viewports = args.includes("--desktop-only")
  ? [{ width: 1920, height: 1080 }]
  : [
      { width: 1920, height: 1080 },
      { width: 390, height: 844 },
    ];
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};
async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ channel: process.env.SLG_BROWSER || "msedge" });
  const report = {
    started: new Date().toISOString(),
    html,
    browser: browser.version(),
    samples,
    fixturePath,
    note: "Fixed-state presentation CPU workload. rAF intervals include scheduling; no GPU FPS claim.",
    cases: [],
    errors: [],
  };
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.goto(pathToFileURL(html).href);
      await page.waitForFunction(() => assetsReady);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
      for (const count of sizes) {
        const setup = await page.evaluate(
          async ({ count, fixture }) => {
            Net.leave();
            const armies = Array(10).fill(null);
            armies[2] = [{ unitId: "Type61", kitId: "standard" }];
            let g = Rules.create(false, 7319, armies, false, {
              mode: "battlefield",
              mapId: Rules.battlefieldMode.defaultMapId,
              fogMode: "disabled",
            });
            const ids = [
              "Type61",
              "RGM_79",
              "MS_06F",
              "Medea",
              "RGM_79C",
              "MS_06FZ",
              "Facility_MG",
              "Facility_Beam",
              "MA_08",
            ];
            const entries = ids.map((id) => ({
              unitId: id,
              kitId: ART.prefabs.find((p) => p.id === id).weaponKits[0].id,
            }));
            g.tiles.forEach((row) => row.fill("plain"));
            g.units = Array.from({ length: count }, (_, index) => {
              const group = Math.floor(index / 3),
                entry = entries[group % entries.length],
                team = group % 2;
              const actor = Rules.makeUnit(
                entry,
                team + 2,
                "perf-" + index,
                { x: 3 + (group % 21) * 3, y: 3 + Math.floor(group / 21) * 3 },
                0,
                7319,
              );
              actor.formationIndex = index;
              if (Rules.squadEligible(actor)) {
                actor.squadId = "perf-squad-" + group;
                actor.squadSlot = index % 3;
              }
              return actor;
            });
            if (fixture) g = fixture;
            g.deployment = null;
            g.ai = false;
            g.fogMode = "disabled";
            g.climateSettings = { weather: "clear", dayNight: "noon" };
            await new Promise((resolve) => {
              if (
                !BattleAssets.guard(
                  { room: "PERF", matchId: "render-" + count, phase: "idle", game: g },
                  resolve,
                )
              )
                resolve();
            });
            game = g;
            phase = "idle";
            mode = "select";
            selected = weaponId = moving = battleView = hover = null;
            setPageView("game");
            MapCamera.reset();
            MapCamera.setPercent(25);
            update();
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            const coldStart = performance.now();
            drawMap(coldStart);
            return { coldFrameMs: performance.now() - coldStart };
          },
          { count, fixture },
        );
        const cases = [
          { name: "overview", zoom: 1 },
          { name: "idle", zoom: 25 },
          { name: "selected", zoom: 25, selected: true },
          { name: "switch-selection", zoom: 25, switching: true },
          { name: "close", zoom: 65 },
          { name: "zoom", zoom: 25, zooming: true },
          { name: "post-zoom", zoom: 25 },
        ];
        for (const scenario of cases) {
          await page.evaluate(async (scenario) => {
            selected = scenario.selected ? game.units[0].id : null;
            MapCamera.setPercent(scenario.zoom);
            for (let i = 0; i < 18; i++) {
              await new Promise((resolve) => requestAnimationFrame(resolve));
              drawMap(performance.now());
            }
          }, scenario);
          const profileThis =
            args.includes("--profile") &&
            count === sizes.at(-1) &&
            ["selected", "switch-selection", "zoom"].includes(scenario.name);
          if (profileThis) await cdp.send("Profiler.start");
          const result = await page.evaluate(
            async ({ scenario, samples }) => {
              const frame = [],
                intervals = [],
                interactions = [];
              let last = null;
              const selectable = game.units.filter(
                (unit) => unit.team === 0 && !unit.facility && Rules.onMap(unit),
              );
              for (let i = 0; i < samples; i++) {
                const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
                if (last !== null) intervals.push(timestamp - last);
                last = timestamp;
                const start = performance.now();
                if (scenario.switching && selectable.length) {
                  select(selectable[i % selectable.length].id);
                  interactions.push(performance.now() - start);
                }
                if (scenario.zooming)
                  MapCamera.setPercent(2 + 60 * (0.5 + 0.5 * Math.sin(i * 0.15)));
                drawMap(performance.now());
                frame.push(performance.now() - start);
              }
              return {
                frame,
                intervals,
                interactions,
                heap: performance.memory?.usedJSHeapSize,
                sprites: SpriteRenderer.cacheStats(),
                tiles: TileMapRenderer.cacheStats(),
              };
            },
            { scenario, samples },
          );
          let profileFile;
          if (profileThis) {
            const { profile } = await cdp.send("Profiler.stop");
            profileFile =
              output.replace(/\.json$/, "") +
              `-${viewport.width}-${count}-${scenario.name}.cpuprofile`;
            fs.writeFileSync(profileFile, JSON.stringify(profile));
          }
          const row = {
            viewport,
            count,
            scenario: scenario.name,
            coldFrameMs: setup.coldFrameMs,
            frameMs: summary(result.frame),
            intervalMs: summary(result.intervals),
            interactionMs: result.interactions.length ? summary(result.interactions) : null,
            heap: result.heap,
            sprites: result.sprites,
            tiles: result.tiles,
            profileFile,
          };
          report.cases.push(row);
          fs.writeFileSync(output, JSON.stringify(report, null, 2));
          console.log(
            JSON.stringify({
              width: viewport.width,
              count,
              scenario: scenario.name,
              p50: row.frameMs.p50,
              p95: row.frameMs.p95,
              interval95: row.intervalMs.p95,
            }),
          );
        }
      }
      await page.close();
    }
    report.finished = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (report.errors.length) throw Error(report.errors.join("\n"));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
