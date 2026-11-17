const { test, expect } = require("@playwright/test"),
  path = require("path"),
  { pathToFileURL } = require("url");
for (const width of [1440, 390])
  test("dominion room and production/research dialogs at " + width + "px", async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      const factory = createRoomEngine;
      createRoomEngine = (options) =>
        (window.dominionEngine = factory({ ...options, aiDelayMs: 999999 }));
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await page.locator("#offlineRoomMode").selectOption("dominion");
    await page.locator("#confirmOfflineMode").click();
    await expect.poll(() => page.evaluate(() => Net.snapshot?.settings.mode)).toBe("dominion");
    if (width < 700) await page.locator('[data-room-tab="settings"]').click();
    await expect(page.locator("#dominionRoomOptions")).toBeVisible();
    await expect(page.locator("#dominionEra")).toHaveValue("UC_0079_T1");
    await expect(page.locator("#roomFormationRules")).toBeHidden();
    await page.screenshot({ path: `tmp/verification/screenshots/dominion-room-${width}.png` });
    if (width < 700) await page.locator("#closeRoomSettingsSheet").click();
    const before = await page.evaluate(() => ({
      economy: Economy.snapshot(),
      progress: Development.exportProgress(),
    }));
    await page.locator("#startRoomGame").click();
    await expect.poll(() => page.evaluate(() => Net.snapshot?.phase)).toBe("idle");
    await expect(page.locator("#dominionToolbar")).toBeVisible();
    await page.evaluate(() => MapCamera.fit());
    await page.screenshot({ path: `tmp/verification/screenshots/dominion-map-${width}.png` });
    await page.evaluate(() => {
      const u = game.units.find((u) => u.ownerSeat === Net.seat && u.facility?.type === "factory");
      MapCamera.focus(u.x, u.y);
      DominionUI.click({ x: u.x, y: u.y });
    });
    await expect(page.locator("#dominionDialog")).toBeVisible();
    await expect(page.locator("#dominionDialog .dominion-row")).not.toHaveCount(0);
    await page.screenshot({ path: `tmp/verification/screenshots/dominion-factory-${width}.png` });
    await page.locator("#dominionDialog .dominion-row button").first().click();
    await expect
      .poll(() =>
        page.evaluate(() => game.units.some((u) => u.ownerSeat === Net.seat && u.dominionOrder)),
      )
      .toBe(true);
    await expect(page.locator("#hudMatchIncome")).not.toHaveText("");
    await page.evaluate(() => {
      document.querySelector("#dominionDialog").close();
      const u = game.units.find((u) => u.ownerSeat === Net.seat && u.facility?.type === "research");
      DominionUI.click({ x: u.x, y: u.y });
    });
    await expect(page.locator("#dominionDialog .dominion-row")).not.toHaveCount(0);
    await page.screenshot({ path: `tmp/verification/screenshots/dominion-research-${width}.png` });
    expect(
      await page.evaluate(() => ({
        economy: Economy.snapshot(),
        progress: Development.exportProgress(),
      })),
    ).toEqual(before);
    expect(errors).toEqual([]);
  });
