"use strict";
// Run on a desktop session (Linux CI: xvfb-run -a npm run test:desktop).
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "projectgreed-desktop-"));
  let instance;
  const executablePath = process.env.DESKTOP_EXECUTABLE;
  const launch = () =>
    electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ["."])],
      env: { ...process.env, PROJECTGREED_TEST_PROFILE: profile },
      timeout: 60000,
    });
  try {
    instance = await launch();
    let page = await instance.firstWindow();
    await page.waitForSelector("#exportProfileSave", { state: "attached", timeout: 60000 });
    assert.equal(await page.evaluate(() => typeof require), "undefined");
    const prefs = await instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    await page.evaluate(() => localStorage.setItem("desktop-smoke", "persistent"));
    await instance.close();
    instance = await launch();
    page = await instance.firstWindow();
    await page.waitForSelector("#exportProfileSave", { state: "attached", timeout: 60000 });
    assert.equal(await page.evaluate(() => localStorage.getItem("desktop-smoke")), "persistent");
    console.log(
      "PASS: bundled client initialized, renderer isolated, save storage survives restart.",
    );
  } finally {
    if (instance) await instance.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
