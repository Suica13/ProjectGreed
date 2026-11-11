"use strict";
// Real desktop Firefox + exact Android HTTP bridge/store. Does not simulate Android GPU/SAF.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { firefox } = require("playwright");
const root = path.resolve(__dirname, "..");
const config = require("../apps/toolchain.local.json");
const evidence = fs.mkdtempSync(path.join(root, "tmp/verification/native/gecko-"));
const classes = path.join(evidence, "classes");
fs.mkdirSync(classes);
const jsonRoot = path.join(
  process.env.USERPROFILE,
  ".gradle/caches/modules-2/files-2.1/org.json/json/20240303",
);
const jsonJar = fs
  .readdirSync(jsonRoot)
  .flatMap((dir) =>
    fs.readdirSync(path.join(jsonRoot, dir)).map((file) => path.join(jsonRoot, dir, file)),
  )
  .find((file) => file.endsWith(".jar"));
assert(jsonJar, "Build Android unit tests to resolve org.json");
const androidJar = path.join(config.androidSdk, "platforms/android-37.0/android.jar");
const classpath = [classes, jsonJar, androidJar].join(path.delimiter);
const java = path.join(config.javaHome, "bin/java.exe");
execFileSync(
  path.join(config.javaHome, "bin/javac.exe"),
  [
    "-encoding",
    "UTF-8",
    "-cp",
    classpath,
    "-d",
    classes,
    "apps/android/app/src/main/java/io/projectgreed/apptest2/NativeAssetServer.java",
    "apps/android/app/src/main/java/io/projectgreed/apptest2/NativeStore.java",
    "apps/android/app/src/main/java/io/projectgreed/apptest2/SnapshotFiles.java",
    "tests/GeckoBridgeHarness.java",
  ],
  { cwd: root, windowsHide: true },
);
let native, browser, app;
const waiters = new Map();
async function boot() {
  native = spawn(
    java,
    [
      "-cp",
      classpath,
      "io.projectgreed.apptest2.GeckoBridgeHarness",
      path.join(root, "build/app-client/content"),
      path.join(evidence, "profile"),
    ],
    { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] },
  );
  let buffer = "";
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("Native bridge startup timeout")), 10000);
    native.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(Error("Native bridge exited " + code));
    });
    native.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.startsWith("http:")) {
          clearTimeout(timeout);
          resolve(line);
        } else if (waiters.has(line)) {
          waiters.get(line)();
          waiters.delete(line);
        }
      }
    });
  });
}
async function command(text) {
  await new Promise((resolve) => {
    waiters.set("ACK:" + text, resolve);
    native.stdin.write(text + "\n");
  });
}
async function stop() {
  if (native) {
    native.stdin.end();
    await once(native, "exit");
    native = null;
  }
}
(async () => {
  let url = await boot();
  browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Android 11; Mobile; rv:159.0) Gecko/159.0 Firefox/159.0",
    hasTouch: true,
    locale: "zh-CN",
  });
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url.replace(/client\.html$/, "compatibility.html"));
  await page.waitForFunction(() =>
    document.getElementById("compatibilityStatus")?.textContent.includes("检查通过"),
  );
  await page.goto(url);
  await page.waitForFunction(
    () => typeof assetsReady !== "undefined" && assetsReady,
    {},
    { timeout: 60000 },
  );
  assert.equal(await page.evaluate(() => AppRuntime.native), true);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.evaluate(() =>
    localStorage.setItem("projectgreed.gecko.large", "x".repeat(6 * 1024 * 1024)),
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("projectgreed.gecko.large").length),
    6 * 1024 * 1024,
  );
  await command("fail");
  assert.equal(
    await page.evaluate(() => {
      try {
        localStorage.setItem("projectgreed.gecko.large", "wrong");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("projectgreed.gecko.large").length),
    6 * 1024 * 1024,
  );
  await command("recover");
  await page.evaluate(() => MenuShell.go("pilots"));
  await page.locator("#createCustomPilot").click();
  await page.locator("#createPilotConfirm").click();
  assert.equal(await page.evaluate(() => ProfileSave.exportData().pilots.PMC.pilots.length), 1);
  await page.evaluate(() => ProductionUI.openUnit("Type61"));
  const before = await page.evaluate(() => Economy.quantity("Type61"));
  await page.locator("#produceUnit").click();
  assert.equal(await page.evaluate(() => Economy.quantity("Type61")), before + 1);
  await page.screenshot({ path: path.join(evidence, "phone-production.png") });
  await command("freeze");
  await page.waitForFunction(() => document.documentElement.inert);
  await command("thaw");
  await page.waitForFunction(() => !document.documentElement.inert);
  await page.evaluate(() => {
    window.bridgeBackground = 0;
    addEventListener("app-background", () => bridgeBackground++);
  });
  await command("background");
  await page.waitForFunction(() => bridgeBackground === 1);
  await command("foreground");
  const snapshot = await page.evaluate(() => Economy.snapshot());
  await page.close();
  await stop();
  url = await boot();
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url);
  await page.waitForFunction(
    () => typeof assetsReady !== "undefined" && assetsReady,
    {},
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("projectgreed.gecko.large").length),
    6 * 1024 * 1024,
  );
  assert.deepEqual(await page.evaluate(() => Economy.snapshot()), snapshot);
  assert.equal(await page.evaluate(() => ProfileSave.exportData().pilots.PMC.pilots.length), 1);
  app = require("../server.js").createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  await page.evaluate((url) => {
    Net.serverURL = url;
    Net.room = "GECKOTEST";
    Net.connect("create", true);
  }, `ws://127.0.0.1:${address.port}/ws`);
  await page.waitForFunction(() => Net.active && !Net.local && Net.snapshot);
  assert.equal(await page.evaluate(() => Net.snapshot.members.length), 1);
  await page.evaluate(() => {
    Net.leave();
    Formation.current = () => [{ unitId: "Medea", kitId: "standard" }];
    byId("offlineRoomMode").value = "quick";
    LocalRoom.open();
  });
  await page.waitForFunction(() => Net.local && Net.snapshot?.members?.length === 2);
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#deploymentAuto").click();
  await page.locator("#confirmDeployment").click();
  await page.waitForFunction(
    () => game && document.body.dataset.page === "game" && game.units.some((u) => Rules.onMap(u)),
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    MapCamera.setPercent(50);
    const u = game.units.find((u) => Rules.onMap(u));
    MapCamera.focus(u.x, u.y, { preserveZoom: true });
    drawMap(performance.now());
  });
  assert(
    await page.evaluate(() => byId("map").getContext("2d").getImageData(0, 0, 1, 1).data[3] > 0),
  );
  await page.screenshot({ path: path.join(evidence, "landscape-battle.png") });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        passed: true,
        engine: await browser.version(),
        checks: [
          "native bridge and capability probe",
          "6MiB Unicode-compatible snapshot",
          "failed commit rollback",
          "pilot recruitment",
          "production",
          "push events",
          "restart persistence",
          "unchanged server WebSocket",
          "offline engine and deployment",
          "portrait and landscape battle Canvas rendering",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Desktop Gecko bridge smoke passed: " + evidence);
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (native) await stop();
    if (app) await app.close();
  });
