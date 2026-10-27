const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const size of [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`adaptive zoom keeps units readable and selectable on huge maps at ${size.width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(size);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect.poll(() => page.evaluate(() => assetsReady)).toBe(true);
    await page.evaluate(() => {
      Net.leave();
      game = Rules.create(false, 1, [
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ]);
      phase = "idle";
      mode = "select";
      selected = null;
      weaponId = null;
      moving = null;
      battleView = null;
      setPageView("game");
      MapCamera.reset();
    });
    await page.locator("#map").scrollIntoViewIfNeeded();
    const results = await page.evaluate(() => {
      const rows = [];
      for (const extent of [24, 56, 64]) {
        game.tiles = Array.from({ length: extent }, () => Array(extent).fill("plain"));
        const u = game.units[0];
        Object.assign(u, { x: Math.floor(extent / 2), y: Math.floor(extent / 2) });
        MapCamera.reset();
        const base = mapGeo.tile;
        MapCamera.setZoom(1e6);
        MapCamera.focus(u.x, u.y);
        drawMap(performance.now());
        const point = mapPosition(u.x, u.y),
          box = byId("map").getBoundingClientRect();
        rows.push({
          extent,
          base,
          tile: mapGeo.tile,
          zoom: MapCamera.zoom,
          max: MapCamera.maxZoom,
          cell: cellAt({ clientX: box.left + point.x, clientY: box.top + point.y }),
          x: u.x,
          y: u.y,
        });
      }
      return rows;
    });
    for (const r of results) {
      expect(r.tile).toBeGreaterThanOrEqual(160);
      expect(r.tile).toBeLessThan(160 + r.base * 0.5 + 0.001);
      expect(r.zoom).toBe(r.max);
      expect(r.cell).toMatchObject({ x: r.x, y: r.y });
    }
    expect(results[2].max).toBeGreaterThan(results[0].max);
    expect(results[2].max).toBeGreaterThan(5);
    await expect(page.locator("#mapZoomIn")).toBeDisabled();
    const pos = await page.evaluate(() => {
      const box = byId("map").getBoundingClientRect(),
        p = mapPosition(game.units[0].x, game.units[0].y);
      return { x: box.left + p.x, y: box.top + p.y };
    });
    await page.mouse.click(pos.x, pos.y);
    expect(await page.evaluate(() => selected)).toBe("0-0");
    await page.locator("#mapZoomReset").click();
    const fit = await page.evaluate(() => Math.round(100 / (ART.presentation.mapCellScale || 1)) + "%");
    await expect(page.locator("#mapZoomLabel")).toHaveText(fit);
    expect(errors).toEqual([]);
  });
}
