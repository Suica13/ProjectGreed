const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1600, 390])
  test("battlefield room, PMC deployment and reinforcement HUD / " + width, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate(() => {
      const original = createRoomEngine;
      createRoomEngine = (options) =>
        (window.bfEngine = original({ ...options, aiDelayMs: 999999 }));
      Formation.current = () => [{ unitId: "Type61", kitId: "standard" }];
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("battlefield");
    await page.locator("#createOfflineRoom").click();
    if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await expect(page.locator("#battlefieldRoomOptions")).toBeVisible();
    if (width === 390) await page.locator("#closeRoomSettingsSheet").click();
    expect(await page.evaluate(() => Net.snapshot.you.seat)).toBe(2);
    expect(await page.locator("#removeSeatAI0, #removeSeatAI1").count()).toBe(0);
    await page.locator("#startRoomGame").click();
    await expect(page.locator("#confirmFinalFormation")).toBeVisible();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#confirmDeployment")).toBeVisible();
    await page.locator("#confirmDeployment").click();
    await expect(page.locator("#battlefieldStatus")).toBeVisible();
    await expect(page.locator("#battlefieldRounds")).toHaveText("0/100");
    await expect(page.locator(".battlefield-strength-text").first()).toHaveText("20,000/20,000");
    await page.evaluate(() => {
      const room = [...bfEngine.rooms.values()][0];
      room.game.round = 6;
      Rules.battlefieldMode.advance(Rules, room.game);
      room.revision++;
      bfEngine.broadcast(room);
    });
    await expect(page.locator("#battlefieldRounds")).toHaveText("5/100");
    await expect.poll(() => page.evaluate(() => !BattleAssets.loading)).toBe(true);
    const info = await page.evaluate(() => ({
      wave: game.battlefield.wave,
      team: Net.snapshot.you.seat % 2,
      arrivals: game.units.filter(
        (unit) => unit.airdropRound === 6 && unit.team === Net.snapshot.you.seat % 2,
      ).length,
      facilities: game.units.filter(
        (unit) => unit.facility && unit.team === Net.snapshot.you.seat % 2,
      ).length,
      awards: Net.snapshot.economyAwards || [],
    }));
    expect(info.wave).toBe(1);
    expect(info.arrivals).toBeGreaterThan(0);
    expect(info.facilities).toBe(6);
    expect(info.awards).toEqual([]);
    const box = await page.locator("#battlefieldStatus").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: "build/battlefield-" + width + ".png" });
    expect(errors).toEqual([]);
  });
