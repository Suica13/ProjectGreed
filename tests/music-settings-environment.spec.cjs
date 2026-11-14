const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

for (const width of [1440, 390]) {
  test(`music controls stay in audio settings across menu and battle at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await expect(page.locator("#musicPlayer")).toBeHidden();
    await page.locator("#shellSettings").click();
    await page.locator('[data-settings-tab="audio"]').click();
    await expect(page.locator("#settings-page-audio #musicPlayer")).toBeVisible();
    const index = await page.evaluate(() => MusicPlayer.index);
    await page.locator("#musicNext").click();
    expect(await page.evaluate(() => MusicPlayer.index)).not.toBe(index);
    await page.locator("#volume-music").fill("30");
      expect(await page.evaluate(() => MusicPlayer.audio.volume / ART.music.volume)).toBeCloseTo(0.3);
    const bounds = await page.locator("#musicPlayer").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.locator("#closeClientSettings").click();
    await page.locator("#shellHangar").click();
    await expect(page.locator("#musicPlayer")).toBeHidden();
    await page.evaluate(() => {
      const entry = { unitId: "Medea", kitId: "standard" };
      game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
      phase = "idle";
      setPageView("game");
      update();
    });
    await expect(page.locator("#musicPlayer")).toBeHidden();
    expect(await page.locator("#musicPlayer").evaluate((el) => el.parentElement.id)).toBe(
      "settings-page-audio",
    );
    await page.locator("#openClientSettings").click();
    await page.locator('[data-settings-tab="audio"]').click();
    await expect(page.locator("#musicTitle")).toBeVisible();
    await expect(page.locator("#musicNext")).toBeVisible();
    await page.screenshot({ path: `tmp/verification/screenshots/music-settings-${width}.png` });
  });

  test(`hangar has no map restriction until joining a room at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.addInitScript(() => {
      const units = [
        { unitId: "ColumbusClass", kitId: "standard" },
        { unitId: "RB_79", kitId: "standard", preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
      ];
      localStorage.setItem("projectgreed.language", "zh");
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({
            schemaVersion: 3,
          money: 10000,
          supplies: 20000,
          licenses: { ColumbusClass: true, RB_79: true },
          inventory: { ColumbusClass: 5, RB_79: 5 },
        }),
      );
      localStorage.setItem(
        "slg-formations-v1.PMC",
        JSON.stringify({ version: 3, squads: [{ name: "Space Fleet", units }] }),
      );
    });
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#shellHangar").click();
    await expect(page.locator("#formationName")).toHaveValue("Space Fleet");
    await expect(page.locator("#formationUnits .disabled-panel")).toHaveCount(0);
    await page.evaluate(() => LocalRoom.open());
    await page.locator("#roomFormation").click();
    await expect(
      page.locator('#formationUnits [data-formation-index="0"] .disabled-panel'),
    ).toHaveCount(1);
    await page.evaluate(() =>
      Net.request("configure_room", { ...Net.snapshot.settings, mapId: "asteroid_crossing_1v1", technologyLimitMode:"custom",technologyLimit:999999 }),
    );
    await page.waitForFunction(() => Net.snapshot.settings.mapId === "asteroid_crossing_1v1");
    await expect(page.locator("#formationUnits .disabled-panel")).toHaveCount(0);
    await page.evaluate(() => Net.leave());
    await page.locator("#shellHangar").click();
    await expect(page.locator("#formationUnits .disabled-panel")).toHaveCount(0);
  });
}
