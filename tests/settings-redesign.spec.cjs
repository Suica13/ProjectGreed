const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
for (const width of [1440, 820, 390])
  test("settings sections fit without overlapping on " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(url);
    await page.locator("#shellSettings").click();
    for (const name of ["general", "audio", "storage", "records", "tools"]) {
      await page.locator('[data-settings-tab="' + name + '"]').click();
      await expect(page.locator("#settings-page-" + name)).toBeVisible();
      const boxes = await page
        .locator(
          "#settings-page-" +
            name +
            " button, #settings-page-" +
            name +
            ' input:not([type="file"]), #settings-page-' +
            name +
            " select",
        )
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => n.getClientRects().length)
            .map((n) => {
              const b = n.getBoundingClientRect(),
                d = n.closest("dialog").getBoundingClientRect();
              return {
                left: b.left,
                right: b.right,
                width: b.width,
                outerLeft: d.left,
                outerRight: d.right,
              };
            }),
        );
      for (const b of boxes) {
        expect(b.width).toBeGreaterThan(18);
        expect(b.left).toBeGreaterThanOrEqual(b.outerLeft);
        expect(b.right).toBeLessThanOrEqual(b.outerRight);
      }
      await page.screenshot({
        path: "tmp/verification/screenshots/settings-" + name + "-" + width + ".png",
      });
    }
    await page.locator('[data-settings-tab="storage"]').click();
    await expect(page.locator("#exportProfileSave")).toBeVisible();
    await expect(page.locator("#importProfileSave")).toContainText("导入跨平台");
  });
test("native settings replace export with opening the save folder and accept a native profile", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.nativeFolderOpened = 0;
    window.AppRuntime = {
      native: true,
      ready: true,
      saveDirectory: "C:/Users/Player/AppData/Local/ProjectGreed/AppTest2",
      openSaveFolder: () => window.nativeFolderOpened++,
      replaceItems: (entries) => {
        for (const [k, v] of entries) {
          if (v === null) localStorage.removeItem(k);
          else localStorage.setItem(k, v);
        }
      },
    };
  });
  await page.goto(url);
  await page.locator("#shellSettings").click();
  await page.locator('[data-settings-tab="storage"]').click();
  await expect(page.locator("#exportProfileSave")).toHaveCount(0);
  await page.locator("#openNativeSaveFolder").click();
  expect(await page.evaluate(() => nativeFolderOpened)).toBe(1);
  await expect(page.locator("#importProfileSave")).toHaveText("导入存档");
  const decoded = await page.evaluate(() => {
    const values = Object.fromEntries(
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
    );
    values[Economy.key] = JSON.stringify(Economy.exportProgress());
    values["projectgreed.developmentProgress.v1"] = JSON.stringify(Development.exportProgress());
    const save = ProfileSave.fromNativeSnapshot({
      format: "ProjectGreed-app-store",
      version: 1,
      values,
    });
    return { money: save.economy.money, supplies: save.economy.supplies };
  });
  expect(decoded.money).toBe(10000);
  expect(decoded.supplies).toBe(20000);
});
