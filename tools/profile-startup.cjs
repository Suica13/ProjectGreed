"use strict";
// Profiles the built page without changing its shipped code. Local runs are not WAN measurements.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const size = (value) => Buffer.byteLength(JSON.stringify(value));
async function main() {
  let html = read("public/client.html");
  const data = JSON.parse(
    html.match(/<script id="art" type="application\/json">\s*([\s\S]*?)<\/script>/)[1],
  );
  const result = {
    htmlBytes: Buffer.byteLength(html),
    payload: Object.fromEntries(
      ["assetSources", "objectSources", "prefabs", "units", "models", "music"].map((key) => [
        key,
        size(data[key]),
      ]),
    ),
    runs: [],
  };
  const modules = [
    "shared/rules.js",
    "client/i18n.js",
    "client/renderer.js",
    "client/app.js",
    "client/player-profile.js",
    "client/formation.js",
    "client/development.js",
    "client/production.js",
    "client/menu-shell.js",
    "client/replay-player.js",
  ];
  for (const file of modules) {
    const source = read(file).replace(/<\/script/gi, "<\\/script");
    if (!html.includes(source)) throw Error("Built source does not match: " + file);
    html = html.replace(
      source,
      () =>
        `performance.mark(${JSON.stringify(file + ":start")});\n${source}\nperformance.mark(${JSON.stringify(file + ":end")});`,
    );
  }
  const statement =
    'const ART = AssetPool.unpack(JSON.parse(document.getElementById("art").textContent));';
  if (!html.includes(statement)) throw Error("Catalog initialization changed");
  html = html.replace(
    statement,
    () => `performance.mark("parse:start");
const packedCatalog = JSON.parse(document.getElementById("art").textContent);
performance.mark("parse:end"); performance.mark("unpack:start");
const ART = AssetPool.unpack(packedCatalog);
performance.mark("unpack:end");`,
  );
  html = html.replace(
    "I18n.bindCatalog(ART);",
    'performance.mark("bind:start"); I18n.bindCatalog(ART); performance.mark("bind:end");',
  );
  html = html.replace(
    "I18n.start();",
    'performance.mark("i18n:start"); I18n.start(); performance.mark("i18n:end"); performance.mark("scripts:end");',
  );
  html = html.replace(
    "<head>",
    `<head><script>
window.startupLongTasks=[];
new PerformanceObserver(list=>startupLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:"longtask",buffered:true});
window.addEventListener("game-assets-ready",()=>performance.mark("assets:ready"));
</script>`,
  );
  const profileFile = path.join(root, ".openai/startup-profile.html");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(profileFile, html);
  const browser = await chromium.launch({
    channel: process.env.SLG_BROWSER || (process.platform === "win32" ? "msedge" : "chromium"),
  });
  try {
    for (const cpu of [1, 1, 1, 4]) {
      const context = await browser.newContext({
        viewport: cpu === 4 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.goto(pathToFileURL(profileFile).href);
      await page.waitForFunction(() => assetsReady, null, { timeout: 60000 });
      await page.waitForTimeout(200);
      const run = await page.evaluate(() => {
        const marks = Object.fromEntries(
          performance.getEntriesByType("mark").map((entry) => [entry.name, entry.startTime]),
        );
        const stages = {};
        for (const name of Object.keys(marks))
          if (name.endsWith(":start"))
            stages[name.slice(0, -6)] = marks[name.slice(0, -6) + ":end"] - marks[name];
        const images = [...new Set(Object.values(SpriteRenderer.images))];
        const objectStats = (objects) => ({
          logical: objects.length,
          unique: new Set(objects).size,
        });
        return {
          readyMs: marks["assets:ready"],
          scriptsEndMs: marks["scripts:end"],
          stages,
          fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
          longTasks: startupLongTasks,
          heapBytes: performance.memory?.usedJSHeapSize,
          textures: {
            logical: Object.keys(SpriteRenderer.images).length,
            unique: images.length,
            rgbaBytes: images.reduce(
              (n, image) => n + image.naturalWidth * image.naturalHeight * 4,
              0,
            ),
          },
          animations: objectStats(ART.units.flatMap((unit) => Object.values(unit.animations))),
          weapons: objectStats(Object.values(ART.models).flatMap((model) => model.weapons)),
          prefabs: ART.prefabs.length,
          kits: ART.units.length,
          domNodes: document.querySelectorAll("*").length,
        };
      });
      result.runs.push({ cpu, ...run, errors });
      await context.close();
    }
    result.baseline = [];
    for (let sample = 0; sample < 3; sample++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() =>
        window.addEventListener(
          "game-assets-ready",
          () => (window.baselineReadyAt = performance.now()),
        ),
      );
      await page.goto(pathToFileURL(path.join(root, "public/client.html")).href);
      await page.waitForFunction(() => assetsReady);
      result.baseline.push(
        await page.evaluate(() => ({
          readyMs: baselineReadyAt,
          fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
        })),
      );
      await context.close();
    }
    const output = path.resolve(root, process.argv[2] || ".openai/startup-profile.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    fs.unlinkSync(profileFile);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
