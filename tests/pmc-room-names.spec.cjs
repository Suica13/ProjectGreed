const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
test("PMC rooms show names without faction badges, campaign keeps factions", async ({ page }) => {
  const app = createServer({ port: 0, host: "127.0.0.1" }),
    address = await app.listen();
  try {
    await page.goto("http://127.0.0.1:" + address.port);
    await page.locator("#playerId").fill("Player-ID13");
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("PMC-NAMES");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await expect(page.locator("#roomChatLines")).toContainText("Player-ID13");
    await expect(page.locator("#roomChatLines .faction-badge")).toHaveCount(0);
    await expect(page.locator("#teamSlots .faction-badge")).toHaveCount(0);
    await expect(page.locator(".lineup-header").first()).toHaveText("玩家ID / 空位位置状态");
    expect(
      await page
        .locator(".spawn-slot")
        .first()
        .evaluate((e) => e.children.length),
    ).toBe(3);
    expect(
      await page.evaluate(() => ({
        regular: PlayerProfile.badge({ characterFaction: "PMC" }, "regular") === null,
        quick: PlayerProfile.badge({ characterFaction: "PMC" }, "quick") === null,
        campaign: PlayerProfile.badge({ characterFaction: "EFSF" }, "campaign").classList.contains("faction-efsf"),
      })),
    ).toEqual({ regular: true, quick: true, campaign: true });
  } finally {
    await app.close();
  }
});
