"use strict";
// Run against the packaged EXE, not a browser imitation. Never uses personal app data.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  net = require("node:net");
const { spawn, execFileSync } = require("node:child_process"),
  { once } = require("node:events"),
  { chromium } = require("playwright");
const { createServer } = require("../server.js");
const root = path.resolve(__dirname, ".."),
  version = require("../project.json").version;
const exe = path.join(
  root,
  "build",
  version,
  `ProjectGreed-${version}-windows-x64`,
  "ProjectGreed.exe",
);
fs.mkdirSync(path.join(root, "tmp/verification/native"), { recursive: true });
const evidence = fs.mkdtempSync(path.join(root, "tmp/verification/native", "native-client-"));
const data = path.join(evidence, "data"),
  exportsPath = path.join(evidence, "exports");
let child, browser, page, lock, app;
const errors = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function boot() {
  const port = await freePort();
  child = spawn(
    exe,
    ["--app-test-port", String(port), "--app-test-data", data, "--app-test-export", exportsPath],
    { windowsHide: true, stdio: "ignore" },
  );
  let connected = false;
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        connected = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) throw Error("Native host exited early");
    await delay(100);
  }
  assert.ok(connected, "native debugging endpoint");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  for (let i = 0; i < 100; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes("projectgreed.localhost"));
    if (page) break;
    await delay(100);
  }
  assert.ok(page, "native application page");
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady, null, {
    timeout: 60000,
  });
  await page.evaluate(() => I18n.setLanguage("zh"));
  assert.equal(await page.evaluate(() => AppRuntime.native), true);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  try {
    await page.evaluate(() => chrome.webview.postMessage({ action: "exit" }));
  } catch {}
  await Promise.race([once(child, "exit"), delay(5000)]);
  if (child.exitCode === null) child.kill();
  child = null;
  browser = null;
}
(async () => {
  assert.ok(fs.existsSync(exe), "Build app:windows first");
  const csc = path.join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const checks = path.join(evidence, "native-store-checks.exe");
  execFileSync(
    csc,
    [
      "/nologo",
      "/reference:System.Web.Extensions.dll",
      "/out:" + checks,
      path.join(root, "tests/native-store.windows.cs"),
      path.join(root, "apps/windows/NativeStore.cs"),
    ],
    { stdio: "inherit", windowsHide: true },
  );
  execFileSync(checks, [path.join(evidence, "store-checks")], {
    stdio: "inherit",
    windowsHide: true,
  });
  await boot();
  await page.evaluate(() => MenuShell.go("pilots"));
  await page.locator("#createCustomPilot").click();
  await page.locator("#createPilotConfirm").click();
  assert.equal(await page.evaluate(() => ProfileSave.exportData().pilots.PMC.pilots.length), 1);
  await page.evaluate(() => MenuShell.go("production"));
  await page.locator("#productionSearch").fill("Type61");
  await page.locator('#productionList [data-unit-id="Type61"] .production-unit-portrait').click();
  const beforeProduction = await page.evaluate(() => Economy.quantity("Type61"));
  await page.locator("#produceUnit").click();
  assert.equal(await page.locator("#buyProductionKit").count(), 0);
  const original = await page.evaluate(() => Economy.snapshot());
  assert.equal(original.inventory.Type61, beforeProduction + 1);
  assert.deepEqual(original.kits, {});
  // A real Windows file lock must reject the purchase without changing wallet or stock.
  lock = spawn(checks, ["--lock", path.join(data, "profile.json")], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    lock.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("LOCKED")) resolve();
    });
    lock.on("error", reject);
  });
  const denied = await page.evaluate(() => {
    try {
      Economy.produce("Type61", "standard", "PMC");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(denied, true);
  assert.deepEqual(await page.evaluate(() => Economy.snapshot()), original);
  lock.stdin.end("\n");
  await once(lock, "exit");
  lock = null;
  // The native file backend must save >5 MiB and restore it after a full process restart.
  await page.evaluate(() =>
    localStorage.setItem("projectgreed.native-size-test", "x".repeat(6 * 1024 * 1024)),
  );
  await page.evaluate(() => MenuShell.go("pilots"));
  await page.screenshot({ path: path.join(evidence, "pilots.png") });
  await stop();
  await boot();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("projectgreed.native-size-test").length),
    6 * 1024 * 1024,
  );
  assert.deepEqual(await page.evaluate(() => Economy.snapshot()), original);
  assert.equal(await page.evaluate(() => ProfileSave.exportData().pilots.PMC.pilots.length), 1);
  await page.evaluate(() => localStorage.removeItem("projectgreed.native-size-test"));
  // Native clients expose the on-disk profile and import it directly.
  await page.locator("#shellSettings").click();
  await page.locator('[data-settings-tab="storage"]').click();
  assert.equal(await page.locator("#exportProfileSave").count(), 0);
  assert(await page.locator("#openNativeSaveFolder").isVisible());
  const archive = fs.readFileSync(path.join(data, "profile.json"), "utf8");
  assert.equal(JSON.parse(archive).format, "ProjectGreed-app-store");
  const loaded = page.waitForEvent("load");
  await page.locator("#profileSaveFile").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(archive),
  });
  await loaded;
  await page.waitForFunction(() => assetsReady);
  assert.deepEqual(await page.evaluate(() => Economy.snapshot()), original);
  // Connect to the existing unmodified server implementation on an isolated local port.
  app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  await page.evaluate((url) => {
    Net.serverURL = url;
    Net.room = "APPTEST2";
    Net.connect("create", true);
  }, `ws://127.0.0.1:${address.port}/ws`);
  await page.waitForFunction(() => Net.active && !Net.local && Net.snapshot);
  assert.equal(await page.evaluate(() => Net.snapshot.members.length), 1);
  await page.evaluate(() => {
    Net.leave();
    byId("offlineRoomMode").value = "quick";
    LocalRoom.open();
  });
  await page.waitForFunction(() => Net.local && Net.snapshot?.members?.length === 2);
  await page.evaluate(() => {
    Net.leave();
    MenuShell.go("production");
  });
  await page.locator("#productionSearch").fill("Medea");
  await page.screenshot({ path: path.join(evidence, "production.png") });
  assert.equal(
    await page
      .locator("#productionList .production-unit-portrait img")
      .evaluateAll((images) => images.every((i) => i.complete && i.naturalWidth > 0)),
    true,
  );
  assert.deepEqual(errors, []);
  await stop();
  await app.close();
  app = null;
  fs.writeFileSync(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "native startup",
          "pilot recruitment",
          "production",
          "free equipment and chassis-only production",
          "real locked-file rollback",
          "6 MiB save",
          "full process restart",
          "native save folder and profile import",
          "existing server join",
          "offline engine",
          "asset images",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Native Windows smoke passed; evidence: " + evidence);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (lock) {
      lock.stdin.end("\n");
      lock.kill();
    }
    await stop();
    if (app) await app.close();
  });
