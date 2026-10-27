const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
for (const width of [1280, 390])
  test(`lobby disconnect aligns opposite create and closes the server connection at ${width}px`, async ({
    page,
  }) => {
    const app = createServer({ host: "127.0.0.1", port: 0 });
    const address = await app.listen();
    let closed = false;
    page.on("websocket", (socket) => {
      if (socket.url() === "ws://127.0.0.1:" + address.port + "/ws")
        socket.on("close", () => (closed = true));
    });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("http://127.0.0.1:" + address.port);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => I18n.setLanguage("en"));
      await page.locator("#openSkirmish").click();
      await page.locator("#openRooms").click();
      await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
      await page.locator("#connectServer").click();
      await expect(page.locator("#lobby")).toBeVisible();
      await expect(page.locator("#disconnectLobby")).toHaveText("Disconnect");
      const r = await page.evaluate(() => {
        const a = byId("createRoom").getBoundingClientRect(),
          b = byId("disconnectLobby").getBoundingClientRect(),
          f = document.querySelector("#lobby .lobby-actions").getBoundingClientRect();
        return {
          createY: a.y,
          disconnectY: b.y,
          createRight: a.right,
          disconnectLeft: b.left,
          right: b.right,
          footerRight: f.right,
        };
      });
      expect(Math.abs(r.createY - r.disconnectY)).toBeLessThan(1);
      expect(r.disconnectLeft).toBeGreaterThan(r.createRight);
      expect(Math.abs(r.right - r.footerRight)).toBeLessThan(2);
      await page.locator("#disconnectLobby").click();
      await expect(page.locator("#lobby")).toBeHidden();
      await expect(page.locator("#openSkirmish")).toBeVisible();
      expect(
        await page.evaluate(() => ({
          endpoint: Lobby.endpoint(),
          net: Net.active,
          view: pageView,
        })),
      ).toEqual({ endpoint: null, net: false, view: "menu" });
      await expect.poll(() => closed).toBe(true);
      expect(app.rooms.size).toBe(0);
    } finally {
      await app.close();
    }
  });
