const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("FPS uses real frame intervals, includes stalls and survives ping refreshes", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    BattleHUD.resetFps();
    BattleHUD.recordFrame(0);
    for (let i = 1; i <= 10; i++) BattleHUD.recordFrame(i * 50);
    const steady = byId("hudPing").textContent;
    BattleHUD.recordFrame(1000);
    const stalled = byId("hudPing").textContent;
    BattleHUD.refreshRoomStatus();
    const refreshed = byId("hudPing").textContent;
    document.dispatchEvent(new Event("visibilitychange"));
    const reset = byId("hudPing").textContent;
    BattleHUD.recordFrame(10000);
    for (let i = 1; i <= 30; i++) BattleHUD.recordFrame(10000 + (i * 1000) / 60);
    return { steady, stalled, refreshed, reset, resumed: byId("hudPing").textContent };
  });
  expect(result.steady).toMatch(/ \/ FPS 20$/);
  expect(result.stalled).toMatch(/ \/ FPS 2$/);
  expect(result.refreshed).toBe(result.stalled);
  expect(result.reset).toMatch(/ \/ FPS —$/);
  expect(result.resumed).toMatch(/ \/ FPS 60$/);
});

for (const width of [320, 390])
  test(`PING and FPS remain fully visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const result = await page.evaluate(() => {
      Net.local = false;
      Net.pingMs = 123;
      setPageView("game");
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      BattleHUD.resetFps();
      BattleHUD.recordFrame(0);
      for (let i = 1; i <= 60; i++) BattleHUD.recordFrame((i * 500) / 60);
      const node = byId("hudPing");
      return { text: node.textContent, width: node.clientWidth, content: node.scrollWidth };
    });
    expect(result.text).toBe("PING 123 ms / FPS 120");
    expect(result.width).toBeGreaterThan(0);
    expect(result.content).toBeLessThanOrEqual(result.width);
  });
