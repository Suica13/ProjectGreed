const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("Minovsky cells render as static low-cost mosaic blocks", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  const result = await page.evaluate(async () => {
    await SpriteRenderer.load();
    Net.leave();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, {
      costLimit: 99999,
      unitCostLimit: 10000,
    });
    game.tiles.forEach((row) => row.fill("plain"));
    Object.assign(game.units[0], { x: 3, y: 3 });
    Object.assign(game.units[1], { x: 35, y: 25 });
    game.minovskyFields = [{ id: "visual", x: 20, y: 15, radius: 3, expiresRound: game.round + 2 }];
    game.intel = null;
    selected = weaponId = pending = battleView = moving = null;
    mode = "select";
    phase = "idle";
    setPageView("game");
    MapCamera.focus(20, 15, { preserveZoom: true });
    const sample = (time, x, y) => {
      drawMap(time);
      const canvas = byId("map"),
        dpr = window.devicePixelRatio || 1;
      const px = (mapGeo.ox + (x + 0.5) * mapGeo.tile) * dpr,
        py = (mapGeo.oy + (y + 0.5) * mapGeo.tile) * dpr;
      return [...canvas.getContext("2d").getImageData(px, py, 1, 1).data];
    };
    const first = sample(0, 20, 15);
    return {
      count: Number(byId("map").dataset.minovskyCells),
      first,
      later: sample(999999, 20, 15),
      outside: sample(999999, 24, 15),
    };
  });
  expect(result.count).toBeGreaterThan(20);
  expect(result.first).toEqual(result.later);
  expect(result.first).not.toEqual(result.outside);
});
