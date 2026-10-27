const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
test("host adds and removes AI, prepares and deploys without a second human client", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:" + address.port);
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("BROWSERAI");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await expect(page.locator("#addAI1")).toBeVisible();
    await expect(page.locator("#addAI0")).toHaveCount(0);
    await page.locator("#addAI1").click();
    await expect(page.locator("#removeAI1")).toBeVisible();
    await expect(page.locator('.spawn-slot[data-seat="1"]')).toContainText("AI 2");
    await page.locator("#removeAI1").click();
    await expect(page.locator("#addAI1")).toBeVisible();
    await page.locator("#addAI1").click();
    await expect(page.locator("#removeAI1")).toBeVisible();
    await page.screenshot({ path: ".openai/online-ai-room.png" });
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#deploymentPanel")).toBeVisible();
    expect(await page.evaluate(() => game.deployment)).toEqual([false, true]);
    expect(await page.evaluate(() => game.units.filter((u) => u.ownerSeat === 1).length)).toBe(12);
    await page.locator("#confirmDeployment").click();
    await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    expect(await page.evaluate(() => Net.canAct())).toBe(true);
    await page.evaluate(() => {
      setPageView("room");
      RoomPanel.render(Net.snapshot);
    });
    await expect(page.locator("#addAI1, #removeAI1")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => Net.leave()).catch(() => {});
    await app.close();
  }
});
