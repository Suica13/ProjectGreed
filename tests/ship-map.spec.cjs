const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function setup(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [
        [{ unitId: "ChivvayClass", kitId: "standard" }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { mapId: "asteroid_crossing_1v1", costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    Object.assign(game.units[0], { x: 12, y: 10, angle: 90 });
    Object.assign(game.units[1], { x: 25, y: 10 });
    selected = game.units[0].id;
    phase = "idle";
    mode = "move";
    setPageView("game");
    update();
  });
}
test("ship range uses destination cells, caches search and invalidates on board changes", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    mapRangeCache = null;
    let calls = 0;
    const original = Rules.reachable;
    Rules.reachable = (...args) => {
      calls++;
      return original(...args);
    };
    const ship = game.units[0],
      ctx = byId("map").getContext("2d"),
      rect = ctx.fillRect,
      arc = ctx.arc;
    ctx.fillStyle = "#63caff2d";
    const highlightStyle = ctx.fillStyle;
    ctx.fillStyle = "#6ac6f088";
    const dotStyle = ctx.fillStyle;
    let cells = 0,
      dots = 0;
    ctx.fillRect = function (...args) {
      if (this.fillStyle === highlightStyle) cells++;
      return rect.apply(this, args);
    };
    ctx.arc = function (...args) {
      if (this.fillStyle === dotStyle) dots++;
      return arc.apply(this, args);
    };
    try {
      for (let i = 0; i < 20; i++) drawMap(performance.now());
      const repeated = calls;
      const candidate = [...mapRangeCache.moveCells.values()].find((c) => c.path.length === 1),
        size = Rules.dimensions(ship);
      const visible = mapRangeCache.moveHighlights.has(
        Rules.key(
          Math.floor(candidate.x + (size.width - 1) / 2),
          Math.floor(candidate.y + (size.height - 1) / 2),
        ),
      );
      game.units[1].x--;
      drawMap(performance.now());
      const afterOtherMove = calls;
      game.tiles[9][12] = "rock";
      drawMap(performance.now());
      const afterTerrain = calls;
      ship.angle = 0;
      drawMap(performance.now());
      const afterRotation = calls;
      ship.brokenParts = { backpack: true };
      drawMap(performance.now());
      const afterDamage = calls;
      game = JSON.parse(JSON.stringify(game));
      drawMap(performance.now());
      return {
        repeated,
        afterOtherMove,
        afterTerrain,
        afterRotation,
        afterDamage,
        afterSnapshot: calls,
        cells,
        dots,
        visible,
      };
    } finally {
      Rules.reachable = original;
      ctx.fillRect = rect;
      ctx.arc = arc;
    }
  });
  expect(result).toMatchObject({
    repeated: 1,
    afterOtherMove: 2,
    afterTerrain: 3,
    afterRotation: 4,
    afterDamage: 5,
    afterSnapshot: 6,
    dots: 0,
    visible: true,
  });
  expect(result.cells).toBeGreaterThan(0);
});
test("ship deployment reuses one legal footprint area and ships also display E outside playback", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const ship = game.units[0];
    phase = "deployment";
    game.deployment = [false, false];
    mapRangeCache = null;
    let calls = 0;
    const original = Rules.deploymentCells;
    Rules.deploymentCells = (...args) => {
      calls++;
      return original(...args);
    };
    try {
      for (let i = 0; i < 10; i++) drawMap(performance.now());
    } finally {
      Rules.deploymentCells = original;
    }
    const deploymentCalls = calls;
    phase = "idle";
    mode = "select";
    ship.acted = true;
    const gm = game.units[1];
    gm.team = 0;
    gm.acted = true;
    const ctx = byId("map").getContext("2d"),
      originalText = ctx.fillText;
    let markers = 0;
    ctx.fillText = function (text, ...args) {
      if (text === "E" && this.fillStyle === "#efd568") markers++;
      return originalText.call(this, text, ...args);
    };
    try {
      drawMap(performance.now());
      const withGM = markers;
      markers = 0;
      gm.acted = false;
      drawMap(performance.now());
      const onlyShip = markers;
      markers = 0;
      phase = "battle";
      drawMap(performance.now());
      return { deploymentCalls, withGM, onlyShip, duringBattle: markers };
    } finally {
      ctx.fillText = originalText;
    }
  });
  expect(result).toEqual({ deploymentCalls: 1, withGM: 2, onlyShip: 1, duringBattle: 0 });
});
