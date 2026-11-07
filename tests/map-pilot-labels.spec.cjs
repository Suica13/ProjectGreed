const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1600, 390])
  test(`map names show pilots from the 50 percent normalized zoom stop (${width})`, async ({
    page,
  }) => {
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
      game.units[0].pilot = PilotSystem.createCustom("custom-map-label", "MapPilotOne");
      setPageView("game");
      const output = [];
      for (const extent of [64, 128]) {
        game.tiles = Array.from({ length: extent }, () => Array(extent).fill("plain"));
        Object.assign(game.units[0], { x: Math.floor(extent / 2), y: Math.floor(extent / 2) });
        MapCamera.reset();
        MapCamera.setPercent(49.99);
        const hidden = MapCamera.pilotLabels;
        const hiddenPercent = MapCamera.zoomPercent;
        MapCamera.setPercent(50);
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
          hiddenPercent,
          percent: MapCamera.zoomPercent,
          label: byId("mapZoomLabel").textContent,
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
      expect(row.hiddenPercent).toBeCloseTo(49.99, 3);
      expect(row.percent).toBeCloseTo(50, 5);
      expect(row.label).toBe("50%");
      expect(row.pilot).toBe(true);
      expect(row.unit).toBe(false);
    }
    expect(results[0].tile).toBeGreaterThan(0);
  });

test("minimum zoom symbols outline occupied cells and overlay a pilot portrait on the unit icon", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
  await page.evaluate(() => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [[{ unitId: "RGM_79", kitId: "machine_gun" }], [{ unitId: "Type61", kitId: "standard" }]],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    game.units[0].model = "SalamisClass__standard";
    game.units[0].pilot = PilotSystem.createCustom("custom-symbol", "Symbol pilot");
    phase = "idle";
    mode = "select";
    selected = null;
    weaponId = null;
    moving = null;
    battleView = null;
    setPageView("game");
    MapCamera.setZoom(0.01);
    MapCamera.setZoom(0.01);
    drawMap(performance.now());
  });
  await expect(page.locator("#map")).toHaveAttribute("data-unit-thumbnails", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 300;
        canvas.height = 300;
        const ctx = canvas.getContext("2d");
        let strokes = 0,
          images = 0,
          fills = 0;
        const stroke = ctx.strokeRect.bind(ctx),
          image = ctx.drawImage.bind(ctx),
          fill = ctx.fillRect.bind(ctx);
        ctx.strokeRect = (...args) => {
          strokes++;
          stroke(...args);
        };
        ctx.drawImage = (...args) => {
          images++;
          image(...args);
        };
        ctx.fillRect = (...args) => {
          fills++;
          fill(...args);
        };
        const unit = game.units[0];
        UnitIdentity.drawMapSymbol(ctx, unit, { x: 150, y: 150 }, 10);
        return {
          outline: strokes >= Rules.cells(unit).length,
          images: images >= 2,
          noBlockFill: fills <= 1,
        };
      }),
    )
    .toEqual({ outline: true, images: true, noBlockFill: true });
  await page.screenshot({ path: "tmp/map-minimum-unit-symbols.png" });
});

test("bubbles and pilot labels share the exact 50 percent threshold", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const rows = await page.evaluate(() => {
    Net.leave();
    const e = { unitId: "Type61", kitId: "standard" };
    game = Rules.create(false, 1, [[e], [e]], false);
    phase = "idle";
    mode = "select";
    selected = null;
    moving = battleView = null;
    setPageView("game");
    const unit = game.units[0],
      canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    const poses = new Map([[unit.id, { u: unit, pos: { x: 150, y: 150 } }]]),
      rows = [];
    dialogueBubbles.clear();
    dialogueBubbles.set(unit.id, { text: "Test speech", pilotName: "Test pilot", until: 0 });
    for (const percent of [0, 49.99, 50, 100]) {
      MapCamera.setPercent(percent);
      const text = [];
      ctx.fillText = (value) => text.push(value);
      drawDialogueBubbles(ctx, poses, { visibleIds: [] }, 400, 300, performance.now());
      rows.push({ percent, labels: MapCamera.pilotLabels, text });
    }
    return rows;
  });
  for (const row of rows) {
    expect(row.labels).toBe(row.percent >= 50);
    expect(row.text).toEqual(row.percent >= 50 ? ["Test pilot:", "Test speech"] : []);
  }
});

test("cached TileMap chunks preserve layered colors without transparent seams during fractional zoom", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const doc = {
      width: 32,
      height: 32,
      tilesets: [],
      tiles: [
        { id: "a", color: "#f04030" },
        { id: "b", color: "#3080e0" },
      ],
      layers: [
        {
          type: "tile",
          placement: "below",
          visible: true,
          opacity: 1,
          data: Array.from({ length: 1024 }, (_, i) => (i % 2 ? "a" : "b")),
        },
        {
          type: "tile",
          placement: "below",
          visible: true,
          opacity: 0.3,
          data: Array(1024).fill("a"),
        },
      ],
    };
    const create = () => {
      const c = document.createElement("canvas");
      c.width = 360;
      c.height = 300;
      return c.getContext("2d");
    };
    const direct = create(),
      cached = create(),
      geometry = { tile: 7.3, ox: -15.5, oy: -12.3 };
    TileMapView.create().draw(direct, doc, "below", {
      ...geometry,
      cellWidth: geometry.tile,
      cellHeight: geometry.tile,
      width: 360,
      height: 300,
    });
    TileMapRenderer.draw(
      cached,
      { id: "chunk-pixel-check", tileMap: doc },
      "below",
      geometry,
      360,
      300,
    );
    let differences = 0,
      seams = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const px = Math.floor(geometry.ox + (x + 0.5) * geometry.tile),
          py = Math.floor(geometry.oy + (y + 0.5) * geometry.tile);
        if (px < 0 || py < 0) continue;
        const a = direct.getImageData(px, py, 1, 1).data,
          b = cached.getImageData(px, py, 1, 1).data;
        if (a.some((value, i) => Math.abs(value - b[i]) > 2)) differences++;
      }
    const a = direct.getImageData(0, 0, 360, 300).data,
      b = cached.getImageData(0, 0, 360, 300).data;
    for (let i = 3; i < a.length; i += 4) if (a[i] === 255 && b[i] === 0) seams++;
    return { differences, seams };
  });
  expect(result).toEqual({ differences: 0, seams: 0 });
});

test("more than 128 pilot portraits reuse small thumbnails without repeated image loads", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    const source = document.createElement("canvas");
    source.width = source.height = 256;
    const pilots = Array.from({ length: 130 }, (_, i) => {
      const ctx = source.getContext("2d");
      ctx.fillStyle = `hsl(${i * 2.7},80%,50%)`;
      ctx.fillRect(0, 0, 256, 256);
      return { uploadedPortrait: source.toDataURL("image/jpeg", 0.7) };
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    const ctx = canvas.getContext("2d"),
      draw = ctx.drawImage.bind(ctx),
      ImageClass = Image;
    let loads = 0,
      small = 0,
      large = 0;
    globalThis.Image = function (...args) {
      loads++;
      return new ImageClass(...args);
    };
    ctx.drawImage = (image, ...args) => {
      if (image instanceof HTMLCanvasElement && image.width === 64 && image.height === 64) small++;
      else large++;
      return draw(image, ...args);
    };
    window.portraitProbe = {
      draw() {
        small = 0;
        for (const p of pilots) UnitIdentity.drawPilotPortrait(ctx, p, 0, 0, 18);
        return small;
      },
      stats: () => ({ loads, large }),
      restore: () => (globalThis.Image = ImageClass),
    };
  });
  try {
    await expect.poll(() => page.evaluate(() => portraitProbe.draw())).toBe(130);
    const result = await page.evaluate(() => {
      for (let i = 0; i < 20; i++) portraitProbe.draw();
      return portraitProbe.stats();
    });
    expect(result).toEqual({ loads: 130, large: 0 });
  } finally {
    await page.evaluate(() => portraitProbe.restore());
  }
});
