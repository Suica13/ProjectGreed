const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");

test("disconnect modal retries on click, survives failed retries and restores room and battle identity", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const guest = await context.newPage();
  const errors = [];
  for (const p of [page, guest]) p.on("pageerror", (e) => errors.push(e.message));
  async function connect(p) {
    await p.goto("http://127.0.0.1:" + address.port);
    await p.locator("#openSkirmish").click();
    await p.locator("#openRooms").click();
    await p.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await p.locator("#connectServer").click();
    await expect(p.locator("#lobby")).toBeVisible();
  }
  try {
    await connect(page);
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("RETRYROOM");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await connect(guest);
    await guest.locator(".room-card").filter({ hasText: "RETRYROOM" }).getByRole("button").click();
    await guest.locator("#toggleReady").click();
    const identity = await guest.evaluate(() => [Net.memberId, Net.seat, Net.token]);
    await guest.evaluate(() => Net.socket.close());
    const modal = guest.locator("#disconnectDialog"),
      retry = guest.locator("#reconnectRoom");
    await expect(modal).toBeVisible();
    await expect(page.locator("#disconnectDialog")).not.toBeVisible();
    expect(await modal.evaluate((el) => el.matches(":modal"))).toBe(true);
    await guest.waitForTimeout(1200);
    expect(await guest.evaluate(() => Net.socket.readyState)).toBe(3);
    await guest.evaluate(() => I18n.setLanguage("en"));
    await expect(retry).toHaveText("Reconnect");
    let block = true;
    await guest.routeWebSocket("ws://127.0.0.1:" + address.port + "/ws", (ws) => {
      if (block) ws.close();
      else ws.connectToServer();
    });
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(modal).toBeVisible();
    await guest.setViewportSize({ width: 390, height: 844 });
    const box = await modal.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - 422)).toBeLessThan(2);
    await guest.evaluate(() => I18n.setLanguage("ja"));
    await expect(retry).toHaveText("再接続");
    // The live seat token also supports retry if tab storage is unavailable.
    await guest.evaluate(() => sessionStorage.clear());
    block = false;
    await retry.click();
    await expect(modal).not.toBeVisible();
    expect(await guest.evaluate(() => [Net.memberId, Net.seat, Net.token])).toEqual(identity);
    expect(
      await guest.evaluate(() => Net.snapshot.members.find((m) => m.id === Net.memberId).ready),
    ).toBe(true);
    await page.locator("#startRoomGame").click();
    for (const p of [page, guest]) await p.locator("#confirmFinalFormation").click();
    for (const p of [page, guest]) await p.locator("#confirmDeployment").click();
    await expect.poll(() => guest.evaluate(() => phase)).toBe("idle");
    const matchId = await guest.evaluate(() => Net.snapshot.matchId);
    await guest.evaluate(() => Net.socket.close());
    await expect(modal).toBeVisible();
    await retry.click();
    await expect(modal).not.toBeVisible();
    await expect.poll(() => guest.evaluate(() => phase)).toBe("idle");
    expect(await guest.evaluate(() => Net.snapshot.matchId)).toBe(matchId);
    expect(await guest.evaluate(() => [Net.memberId, Net.seat, Net.token])).toEqual(identity);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await page.goto("about:blank");
    await app.close();
  }
});

test("offline rooms never open the disconnect dialog", async ({ page }) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await expect(page.locator("#disconnectDialog")).not.toBeVisible();
});
