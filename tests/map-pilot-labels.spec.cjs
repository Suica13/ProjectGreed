const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1600, 390])
  test(`map names show pilots only at a consistent physical scale (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const results = await page.evaluate(() => {
      Net.leave();
      const e = { unitId: "Type61", kitId: "standard" };
      game = Rules.create(false, 1, [[e], [e]]);
      phase = "idle";
      mode = "select";
      selected = null;
      weaponId = null;
      moving = null;
      battleView = null;
      game.units[0].pilot = { ...game.units[0].pilot, name: "MapPilotOne", custom: false };
      setPageView("game");
      const output = [];
      for (const extent of [12, 64]) {
        game.tiles = Array.from({ length: extent }, () => Array(extent).fill("plain"));
        Object.assign(game.units[0], { x: Math.floor(extent / 2), y: Math.floor(extent / 2) });
        MapCamera.reset();
        const pixelsPerZoom = mapGeo.tile / MapCamera.zoom;
        const limit = 96 / pixelsPerZoom;
        MapCamera.setZoom(limit * 0.99);
        const hidden = MapCamera.pilotLabels;
        MapCamera.setZoom(limit * 1.01);
        MapCamera.focus(game.units[0].x, game.units[0].y, { preserveZoom: true });
        const shown = MapCamera.pilotLabels,
          labels = [];
        const ctx = byId("map").getContext("2d"),
          original = ctx.fillText;
        ctx.fillText = function (text, ...args) {
          labels.push(String(text));
          return original.call(this, text, ...args);
        };
        try {
          drawMap(performance.now());
        } finally {
          ctx.fillText = original;
        }
        output.push({
          extent,
          hidden,
          shown,
          tile: mapGeo.tile,
          zoom: MapCamera.zoom,
          pilot: labels.includes("MapPilotOne"),
          unit: labels.includes(Rules.modelOf(game.units[0]).name),
        });
      }
      return output;
    });
    for (const row of results) {
      expect(row.hidden).toBe(false);
      expect(row.shown).toBe(true);
      expect(row.tile).toBeCloseTo(96 * 1.01, 2);
      expect(row.pilot).toBe(true);
      expect(row.unit).toBe(false);
    }
    expect(results[0].zoom).toBeLessThan(results[1].zoom);
  });
