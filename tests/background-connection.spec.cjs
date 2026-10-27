const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");

test("switching apps and freezing background rendering preserves the connection and synchronizes on return", async ({
  page,
  context,
}) => {
  const app = createServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatMs: 50,
    heartbeatTimeoutMs: 1500,
  });
  const address = await app.listen();
  const other = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let cdp;
  try {
    await page.goto("http://127.0.0.1:" + address.port);
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("BACKGROUND");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    const room = app.rooms.get("BACKGROUND"),
      id = room.hostId,
      socket = room.members.get(id).ws;
    const revision = room.revision;
    cdp = await context.newCDPSession(page);
    await other.goto("about:blank");
    await other.bringToFront();
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await other.waitForTimeout(650);
    expect(room.members.get(id).ws).toBe(socket);
    expect(socket.readyState).toBe(1);
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
    await page.bringToFront();
    await expect(page.locator("#disconnectDialog")).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [Net.memberId, Net.socket.readyState, Net.connecting]))
      .toEqual([id, 1, false]);
    expect(room.revision).toBe(revision);
    expect(room.members.get(id).ws).toBe(socket);
    expect(errors).toEqual([]);
  } finally {
    if (cdp) await cdp.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
    await other.close();
    await page.goto("about:blank");
    await app.close();
  }
});
