const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("phone landscape uses a centred desktop viewport and survives orientation changes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await expect(page.locator("html")).toHaveClass(/phone-landscape/);
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      body: document.body.getBoundingClientRect().toJSON(),
      scale: visualViewport.scale,
    }));
    expect(geometry.body.width).toBe(1600);
    expect(geometry.body.height).toBe(900);
    expect(geometry.width).toBeGreaterThanOrEqual(1600);
    expect(geometry.body.x).toBeGreaterThan(0);
    expect(Math.abs(geometry.body.x * 2 + 1600 - geometry.width)).toBeLessThan(3);
    await page.locator("#shellSettings").click();
    await page.screenshot({ path: ".openai/phone-landscape-settings.png" });
    await page.locator("#closeClientSettings").click();
    await page.evaluate(async () => {
      await SpriteRenderer.load();
      Net.leave();
      TurnFlow.reset();
      const entry = { unitId: "Type61", kitId: "standard" };
      game = Rules.create(false, 1, [[entry], [entry]], false, {
        costLimit: 99999,
        unitCostLimit: 10000,
      });
      game.tiles.forEach((row) => row.fill("plain"));
      game.fogMode = "disabled";
      Object.assign(game.units[0], { x: 10, y: 10 });
      Object.assign(game.units[1], { x: 15, y: 10 });
      selected = pending = battleView = moving = null;
      mode = "select";
      phase = "idle";
      setPageView("game");
      MapCamera.focus(12, 10, { preserveZoom: true });
      update();
      drawMap(performance.now());
    });
    const point = await page.evaluate(() => {
      drawMap(performance.now());
      const r = byId("map").getBoundingClientRect();
      return {
        x: r.left + mapGeo.ox + 10.5 * mapGeo.tile,
        y: r.top + mapGeo.oy + 10.5 * mapGeo.tile,
      };
    });
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => page.evaluate(() => selected)).toBe("0-0");
    await page.locator('[data-unit-command="info"]').click();
    await expect(page.locator("#hudUnitPanel")).toBeVisible();
    await page.screenshot({ path: ".openai/phone-landscape-battle.png" });
    expect(errors).toEqual([]);
    const match = await page.evaluate(() => game);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).not.toHaveClass(/phone-landscape/);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(390);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("html")).toHaveClass(/phone-landscape/);
    expect(await page.evaluate(() => game)).toEqual(match);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(page.locator("html")).toHaveClass(/phone-landscape/);
    expect(await page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(900);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("desktop layout retains native viewport sizing", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await expect(page.locator("html")).not.toHaveClass(/phone-landscape/);
  expect(await page.evaluate(() => document.querySelector('meta[name="viewport"]').content)).toBe(
    "width=device-width,initial-scale=1",
  );
  expect(await page.locator("#menuShell").boundingBox()).toMatchObject({ width: 1600 });
});
