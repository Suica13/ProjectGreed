const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const P = require("../shared/pilots.js");
const content = path.resolve("build/app-client/content");
let server, url;
test.skip(!fs.existsSync(path.join(content, "manifest.json")), "Run npm run app:prepare first");
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.resolve(content, "." + new URL(req.url, "http://local").pathname);
    if (!file.startsWith(content + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const mime = {
      ".js": "application/javascript",
      ".json": "application/json",
      ".html": "text/html",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ogg": "audio/ogg",
      ".mp3": "audio/mpeg",
    };
    const stream = fs.createReadStream(file);
    stream.on("error", () => {
      res.writeHead(404);
      res.end();
    });
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    stream.pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/client.html`;
});
test.afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});
for (const width of [1440, 390])
  test(`packaged app loads external assets, native bridge and exports at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const pilots = Array.from({ length: 12 }, (_, i) =>
      P.createCustom("custom-native-" + i, "Native " + i, undefined, "PMC"),
    );
    await page.addInitScript((pilots) => {
      let state = {
        ok: true,
        revision: 0,
        values: { "projectgreed.custom-pilots.v3.shared": JSON.stringify({ pilots, awards: [] }) },
      };
      window.nativeExports = [];
      window.ProjectGreedAndroid = {
        read: () => JSON.stringify(state),
        commit: (payload) => {
          const next = JSON.parse(payload);
          if (next.revision !== state.revision)
            return JSON.stringify({ ok: false, error: "Stale" });
          state = { ok: true, revision: state.revision + 1, values: next.values };
          return JSON.stringify({ ok: true, revision: state.revision });
        },
        exportFile: (name, mime, data) => window.nativeExports.push({ name, mime, data }),
        exit: () => (window.nativeExited = true),
      };
    }, pilots);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      MenuShell.go("pilots");
    });
    await expect(page.locator("#customPilotList .custom-pilot-card")).toHaveCount(12);
    const overlap = await page.locator("#customPilotList").evaluate((el) => {
      const cards = [...el.children].map((c) => c.getBoundingClientRect());
      return cards.some((a, i) =>
        cards
          .slice(i + 1)
          .some((b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom),
      );
    });
    expect(overlap).toBe(false);
    await page.locator("#pilotRosterSearch").fill("Native 11");
    await expect(page.locator("#customPilotList .custom-pilot-card")).toHaveCount(1);
    await page.evaluate(() => MenuShell.go("production"));
    await page.locator("#productionSearch").fill("Medea");
    await expect(page.locator("#productionList .production-unit")).toHaveCount(2);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#productionList .production-unit-portrait img")].every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    );
    await page.locator("#shellSettings").click();
    await page.locator("#exportProfileSave").click();
    await page.waitForFunction(() => nativeExports.length === 1);
    const exported = await page.evaluate(() => nativeExports[0]);
    expect(JSON.parse(Buffer.from(exported.data, "base64").toString("utf8")).format).toBe(
      "ProjectGreed-profile",
    );
    await page.locator("#checkProfileStorage").click();
    await expect(page.locator("#profileStorageDiagnostic")).toContainText("应用文件存档写入正常");
    await page.locator("#exportStorageDiagnostic").click();
    await page.waitForFunction(() => nativeExports.length === 2);
    const report = await page.evaluate(() => nativeExports[1]);
    expect(JSON.parse(Buffer.from(report.data, "base64").toString("utf8")).backend).toBe(
      "native-file",
    );
    expect(errors).toEqual([]);
  });
