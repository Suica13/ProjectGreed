const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const editorURL = pathToFileURL(path.resolve("public/map-editor.html")).href;

for (const [locale, language, button] of [
  ["en-US", "en", "Export project"],
  ["ja-JP", "ja", "プロジェクトを書き出す"],
  ["zh-TW", "zh-CN", "导出工程"],
  ["fr-FR", "en", "Export project"],
]) {
  test(`map editor follows system locale ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage();
      await page.goto(editorURL);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.locator("#editorLanguage")).toHaveValue("auto");
      await expect(page.locator("#exportProject")).toHaveText(button);
    } finally {
      await context.close();
    }
  });
}

test("switching languages preserves map data, localizes new messages and remembers preference", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(editorURL);
  await page.locator("#mapName").fill("删除");
  await page.locator("#mapName").press("Tab");
  await page.locator("#layerName").fill("地图");
  await page.locator("#layerName").press("Tab");
  const before = await page.evaluate(() => JSON.stringify(MapEditor.document));
  await page.locator("#editorLanguage").selectOption("en");
  await expect(page.locator("#exportProject")).toHaveText("Export project");
  await expect(page.locator("#status")).toHaveText("Map updated");
  await expect(page.locator("#defaultTerrain option:checked")).toHaveText("Plain");
  await expect(page.locator("#spawnSeat option:checked")).toContainText("Team 1 / Player 1");
  await expect(page.locator("#mapName")).toHaveValue("删除");
  await expect(page.locator("#layerName")).toHaveValue("地图");
  await expect(page.locator("#layerList")).toContainText("地图");
  await expect(page.locator("#layerList")).toContainText("Visible");
  await page.locator("#validateMap").click();
  await expect(page.locator("#validation")).not.toContainText("玩家");
  await page.locator('[data-tab="units"]').click();
  await page.locator("#generateUnits").click();
  await expect(page.locator("#dialogTitle")).toHaveText("Action failed");
  await expect(page.locator("#dialogMessage")).toHaveText("Enter unit configuration");
  await page.locator("#dialogActions button").click();
  await page.locator("#help").click();
  await expect(page.locator("#dialogMessage")).toContainText("1. In Map");
  await expect(page.locator("#dialogMessage")).toContainText("8. The game supports 2 teams");
  await page.locator("#dialogActions button").click();
  await page.locator('[data-tab="map"]').click();
  await page.locator("#editorLanguage").selectOption("ja");
  await expect(page.locator("#exportProject")).toHaveText("プロジェクトを書き出す");
  expect(await page.evaluate(() => JSON.stringify(MapEditor.document))).toBe(before);
  await page.locator("#editorLanguage").selectOption("zh");
  await expect(page.locator("#exportProject")).toHaveText("导出工程");
  expect(await page.evaluate(() => JSON.stringify(MapEditor.document))).toBe(before);
  await page.locator("#editorLanguage").selectOption("ja");
  // Avoid the unsaved-map unload prompt; document preservation was checked above.
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#editorLanguage")).toHaveValue("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.locator("#editorLanguage").selectOption("auto");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.reload();
  await expect(page.locator("#editorLanguage")).toHaveValue("auto");
  expect(errors).toEqual([]);
});

test("system changes apply only in automatic mode, and storage is optional", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage disabled");
      },
    });
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["fr-FR", "ja-JP"],
    });
  });
  await page.goto(editorURL);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-GB"] });
    window.dispatchEvent(new Event("languagechange"));
  });
  await expect(page.locator("#exportProject")).toHaveText("Export project");
  await page.locator("#editorLanguage").selectOption("zh");
  await page.evaluate(() => window.dispatchEvent(new Event("languagechange")));
  await expect(page.locator("#exportProject")).toHaveText("导出工程");
  await page.locator("#editorLanguage").selectOption("auto");
  await expect(page.locator("#exportProject")).toHaveText("Export project");
});
