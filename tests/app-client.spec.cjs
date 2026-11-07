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
      ".css": "text/css",
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
const installNativeBridge = (pilots) => {
  let state = {
    ok: true,
    revision: 0,
    values: { "projectgreed.custom-pilots.v3.shared": JSON.stringify({ pilots, awards: [] }) },
  };
  window.nativeExports = [];
  window.nativeScenes = [];
  window.folderChoices = 0;
  window.ProjectGreedAndroid = {
    sceneChanged: (scene, ready) => window.nativeScenes.push({ scene, ready }),
    chooseStorageFolder: () => window.folderChoices++,
    read: () => JSON.stringify(state),
    commit: (payload) => {
      const next = JSON.parse(payload);
      if (next.revision !== state.revision) return JSON.stringify({ ok: false, error: "Stale" });
      state = { ok: true, revision: state.revision + 1, values: next.values };
      return JSON.stringify({ ok: true, revision: state.revision });
    },
    exportFile: (name, mime, data) => window.nativeExports.push({ name, mime, data }),
    exit: () => (window.nativeExited = true),
  };
};
for (const width of [1440, 390])
  test(`packaged app loads external assets, native bridge and exports at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const pilots = Array.from({ length: 12 }, (_, i) =>
      P.createCustom("custom-native-" + i, "Native " + i, undefined, "PMC"),
    );
    await page.addInitScript(installNativeBridge, pilots);
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
    await expect(page.locator("#nativeSaveFolder")).toBeEnabled();
    await page.locator("#nativeSaveFolder").click();
    expect(await page.evaluate(() => folderChoices)).toBe(1);
    expect(await page.evaluate(() => nativeScenes.some((s) => s.scene === "menu" && s.ready))).toBe(
      true,
    );
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

test("Android app rotates battle viewport without clipping and restores menu orientation policy", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  try {
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(installNativeBridge, []);
    await page.goto(url);
    await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
    await expect
      .poll(() => page.evaluate(() => nativeScenes.at(-1)))
      .toEqual({ scene: "menu", ready: true });
    await page.evaluate(async () => {
      await SpriteRenderer.load();
      Net.leave();
      TurnFlow.reset();
      const entry = { unitId: "Type61", kitId: "standard" };
      game = Rules.create(false, 1, [[entry], [entry]], false, {
        costLimit: 99999,
        unitCostLimit: 10000,
      });
      selected = pending = battleView = moving = null;
      mode = "select";
      phase = "idle";
      setPageView("game");
      update();
      drawMap(performance.now());
    });
    await expect
      .poll(() => page.evaluate(() => nativeScenes.at(-1)))
      .toEqual({ scene: "game", ready: true });
    const units = await page.evaluate(() => JSON.stringify(game.units));
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 915, height: 412 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.classList.contains("phone-landscape")),
        )
        .toBe(viewport.width > viewport.height);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const r = document.body.getBoundingClientRect(),
              v = visualViewport;
            return (
              r.left >= v.offsetLeft - 3 &&
              r.top >= v.offsetTop - 3 &&
              r.right <= v.offsetLeft + v.width + 3 &&
              r.bottom <= v.offsetTop + v.height + 3
            );
          }),
        )
        .toBe(true);
      expect(await page.evaluate(() => JSON.stringify(game.units))).toBe(units);
    }
    await expect(page.locator("#nativeSaveFolder")).toBeDisabled();
    await page.evaluate(() => setPageView("menu"));
    await expect
      .poll(() => page.evaluate(() => nativeScenes.at(-1)))
      .toEqual({ scene: "menu", ready: true });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const unsupported of [false, true])
  test(`Android capability preflight ${unsupported ? "reports missing features" : "accepts pre-120 version text"} before profile access`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 8.0) AppleWebKit/537.36 Chrome/109.0.0.0 Mobile Safari/537.36",
    });
    try {
      const page = await context.newPage(),
        requests = [],
        errors = [];
      page.on("request", (req) => requests.push(req.url()));
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((unsupported) => {
        window.ProjectGreedAndroid = {
          compatibilityResult: (result) => {
            window.compatibilityReport = JSON.parse(result);
          },
          read: () => {
            throw Error("Profile must not be read by preflight");
          },
          commit: () => {
            throw Error("Profile must not be changed by preflight");
          },
        };
        if (unsupported) Object.defineProperty(window, "ResizeObserver", { value: undefined });
      }, unsupported);
      await page.goto(url.replace("client.html", "compatibility.html"));
      await page.waitForFunction(() => Array.isArray(window.compatibilityReport));
      const report = await page.evaluate(() => compatibilityReport);
      if (unsupported) {
        expect(report).toHaveLength(1);
        expect(report[0]).toContain("ResizeObserver");
        await expect(page.locator("#compatibilityStatus")).toContainText("ResizeObserver");
      } else expect(report).toEqual([]);
      expect(requests.some((url) => /app-runtime|scripts\/client-/.test(url))).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
