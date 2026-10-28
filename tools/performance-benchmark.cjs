"use strict";
// Local repeatable measurements; not WAN latency or a concurrent load test.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { performance } = require("node:perf_hooks"),
  { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test"),
  { createServer } = require("../server.js");
async function main() {
  const root = path.resolve(__dirname, ".."),
    output = process.argv[2] || ".openai/performance.json";
  const app = createServer({ host: "127.0.0.1", port: 0 });
  let browser;

  const result = {
    node: process.version,
    htmlBytes: fs.statSync(path.join(root, "public/client.html")).size,
  };
  try {
    browser = await chromium.launch({
      channel: process.env.SLG_BROWSER || (process.platform === "win32" ? "msedge" : "chromium"),
    });
    const address = await app.listen();
    result.httpDocumentBytes = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/",
          method: "HEAD",
          headers: { "Accept-Encoding": "identity" },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(Number(response.headers["content-length"])));
        },
      );
      request.on("error", reject);
      request.end();
    });
    result.http = [];
    for (let i = 0; i < 3; i++) {
      const at = performance.now();
      result.http.push(
        await new Promise((resolve, reject) =>
          http
            .get(
              {
                hostname: "127.0.0.1",
                port: address.port,
                path: "/",
                headers: { "Accept-Encoding": "gzip" },
              },
              (res) => {
                let bytes = 0;
                res.on("data", (chunk) => (bytes += chunk.length));
                res.on("end", () =>
                  resolve({
                    bytes,
                    ms: performance.now() - at,
                    encoding: res.headers["content-encoding"] || "identity",
                  }),
                );
              },
            )
            .on("error", reject),
        ),
      );
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    result.startupMs = [];
    for (let i = 0; i < 3; i++) {
      const at = performance.now();
      await page.goto(pathToFileURL(path.join(root, "public/client.html")).href);
      await page.waitForFunction(() => assetsReady);
      result.startupMs.push(performance.now() - at);
    }
    result.client = await page.evaluate(() => ({
      textures: Object.keys(SpriteRenderer.images).length,
      imageObjects: new Set(Object.values(SpriteRenderer.images)).size,
      heapBytes: performance.memory?.usedJSHeapSize,
    }));
    await page.evaluate(() =>
      SpriteRenderer.ensureAssets(
        SpriteRenderer.battleKeys({ game: { units: [{ model: "Type61__standard" }] } }),
      ),
    );
    result.draw = await page.evaluate(() => {
      const entry = { unitId: "Type61", kitId: "standard" };
      game = Rules.create(
        false,
        7319,
        [
          Array.from({ length: 12 }, () => ({ ...entry })),
          Array.from({ length: 12 }, () => ({ ...entry })),
        ],
        false,
        { costLimit: 99999, unitLimit: 72, fogMode: "disabled" },
      );
      phase = "idle";
      selected = game.units[0].id;
      setPageView("game");
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      const times = [];
      for (let i = 0; i < 70; i++) {
        const at = performance.now();
        drawMap(at + i * 16);
        if (i >= 10) times.push(performance.now() - at);
      }
      times.sort((a, b) => a - b);
      return {
        units: game.units.length,
        samples: times.length,
        p50Ms: times[Math.floor(times.length * 0.5)],
        p95Ms: times[Math.floor(times.length * 0.95)],
      };
    });
    result.errors = errors;
    fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
    fs.writeFileSync(path.resolve(root, output), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser?.close();
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
