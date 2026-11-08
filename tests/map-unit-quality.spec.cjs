const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1600, 390])
  test(`map restores native unit rendering from 25% at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const rows = await page.evaluate(async () => {
      Net.leave();
      await SpriteRenderer.load();
      const entry = { unitId: "RGM_79", kitId: "machine_gun" };
      game = Rules.create(false, 1, [[entry], [entry]], false);
      game.tiles.forEach((row) => row.fill("plain"));
      game.fogMode = "disabled";
      Object.assign(game.units[0], { x: 8, y: 8 });
      Object.assign(game.units[1], { x: 10, y: 8 });
      phase = "idle";
      mode = "select";
      selected = weaponId = moving = battleView = null;
      setPageView("game");
      update();
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      ClientSettings.unitShadows = () => false;
      const original = SpriteRenderer.draw,
        originalSymbol = UnitIdentity.drawMapSymbol;
      let calls = [],
        symbols = 0,
        depth = 0;
      SpriteRenderer.draw = (...args) => {
        if (!depth) calls.push({ model: args[1], raster: args.at(-1) });
        depth++;
        try {
          return original(...args);
        } finally {
          depth--;
        }
      };
      UnitIdentity.drawMapSymbol = (...args) => {
        symbols++;
        return originalSymbol(...args);
      };
      try {
        return [0, 5, 5.01, 24.99, 25, 25.01, 50, 100].map((percent) => {
          MapCamera.setPercent(percent);
          MapCamera.focus(9, 8, { preserveZoom: true });
          calls = [];
          symbols = 0;
          drawMap(performance.now());
          return { percent, icons: MapCamera.unitThumbnails, symbols, calls };
        });
      } finally {
        SpriteRenderer.draw = original;
        UnitIdentity.drawMapSymbol = originalSymbol;
      }
    });
    for (const row of rows) {
      expect(row.icons).toBe(row.percent <= 5);
      if (row.percent <= 5) {
        expect(row.symbols).toBeGreaterThan(0);
        expect(row.calls).toEqual([]);
      } else {
        expect(row.symbols).toBe(0);
        expect(row.calls.length).toBeGreaterThan(0);
        expect(row.calls.every((call) => call.raster === (row.percent < 25 ? 2048 : 0))).toBe(true);
      }
    }
  });
