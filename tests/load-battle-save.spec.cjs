const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1280, 390])
  test(`saved-match warning and file loading at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    if (width < 700) await page.getByRole("button", { name: "\u623f\u95f4\u8bbe\u7f6e", exact: true }).click();
    await page.locator("#roomLoadSave").click();
    const dialog = page.locator("#loadBattleSaveDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("存档对局无收益，无单位损失");
    const geometry = await dialog.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const notice = node.querySelector("p").getBoundingClientRect();
      const button = node.querySelector("#chooseBattleSave").getBoundingClientRect();
      return { x: box.x, right: box.right, bottom: box.bottom,
        centerOffset: Math.abs(button.x + button.width / 2 - (box.x + box.width / 2)),
        ordered: notice.bottom <= button.top };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.bottom).toBeLessThanOrEqual(900);
    expect(geometry.centerOffset).toBeLessThan(2);
    expect(geometry.ordered).toBe(true);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const data = await page.evaluate(() => {
      const settings = Net.snapshot.settings;
      const count = Rules.getMap(settings.mapId).spawns.length;
      const armies = Array.from({ length: count }, () => [{ unitId: "Type61", kitId: "standard" }]);
      const game = Rules.create(false, 1, armies, false, settings);
      return JSON.stringify(MatchRecords.createSave(Rules, { game, settings, seats: Array(count).fill(null) }));
    });
    const inventory = await page.evaluate(() => Economy.snapshot());
    await page.locator("#roomLoadSave").click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#chooseBattleSave").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "test.save.greed", mimeType: "application/json", buffer: Buffer.from(data) });
    await page.waitForFunction(() => !!Net.snapshot?.loadedSave && !Net.awaiting);
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => Economy.snapshot())).toEqual(inventory);
    expect(errors).toEqual([]);
  });
