const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  fs = require("node:fs/promises");
const M = require("../shared/map-document.js");
const editorURL = pathToFileURL(path.resolve("public/map-editor.html")).href;
async function field(page, id, value) {
  await page.locator("#" + id).fill(String(value));
  await page.locator("#" + id).press("Tab");
}
async function point(page, x, y) {
  return page.evaluate(
    ({ x, y }) => {
      const c = MapEditor.camera,
        d = MapEditor.document,
        box = document.getElementById("mapCanvas").getBoundingClientRect();
      return {
        x: box.x + c.x + (x + 0.5) * d.tileWidth * c.zoom,
        y: box.y + c.y + (y + 0.5) * d.tileHeight * c.zoom,
      };
    },
    { x, y },
  );
}
async function paint(page, x, y) {
  const p = await point(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function rectangle(page, x0, y0, x1, y1) {
  const a = await point(page, x0, y0),
    b = await point(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
async function upload(page, button, file) {
  const choosing = page.waitForEvent("filechooser");
  await page.locator("#" + button).click();
  await (await choosing).setFiles(file);
}
test("standalone editor paints an atlas, nine-slice and random rules, embeds images and round-trips both export formats", async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(editorURL);
  await page.waitForFunction(() => typeof MapEditor !== "undefined");
  await field(page, "mapId", "browser_authored");
  await field(page, "mapName", "浏览器测试地图");
  await field(page, "tileWidth", 16);
  await field(page, "tileHeight", 24);
  await page.locator("#fit").click();
  await page.locator('[data-tab="tiles"]').click();
  await field(page, "atlasTileWidth", 16);
  await field(page, "atlasTileHeight", 24);
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 72;
    const ctx = c.getContext("2d");
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgb(${30 + i * 23},${60 + i * 10},${200 - i * 12})`;
      ctx.fillRect((i % 3) * 16, Math.floor(i / 3) * 24, 16, 24);
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  const image = { name: "atlas.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
  await upload(page, "addAtlas", image);
  await expect.poll(() => page.evaluate(() => MapEditor.document.tilesets.length)).toBe(1);
  await page.locator("#tileEnvironment").selectOption("space");
  await page.locator("#tileTerrain").selectOption("snow");
  await page.locator("#tileDynamic").check();
  await paint(page, 18, 8);
  expect(await page.evaluate(() => MapEditor.exportMap().cellEnvironments[8][18])).toBe("space");
  await page.locator("#addLayer").click();
  await field(page, "layerName", "遮挡装饰");
  await page.locator("#layerPlacement").selectOption("above");
  await page.locator("#layerDecorative").check();
  await page.locator('[data-tab="rules"]').click();
  await page.locator("#newNine").click();
  await rectangle(page, 20, 10, 24, 14);
  const nine = await page.evaluate(() => {
    const d = MapEditor.document,
      r = d.rules[0],
      l = MapEditor.activeLayer;
    return {
      topLeft: l.data[10 * d.width + 20] === r.tiles[0],
      bottomRight: l.data[14 * d.width + 24] === r.tiles[8],
      centre: l.data[12 * d.width + 22] === r.tiles[4],
    };
  });
  expect(nine).toEqual({ topLeft: true, bottomRight: true, centre: true });
  await page.locator("#newRandom").click();
  await page.locator('[data-tab="tiles"]').click();
  await page.locator("#tilesetList").selectOption("builtin");
  await page.locator('[data-tile="terrain_desert"]').click({ modifiers: ["Control"] });
  await rectangle(page, 26, 10, 29, 14);
  expect(await page.evaluate(() => MapEditor.document.rules.at(-1).variants.length)).toBe(2);
  // Copy, delete, paste and undo operate on the current layer without altering other layers.
  await page.locator('[data-tool="select"]').click();
  await rectangle(page, 20, 10, 21, 11);
  await page.locator("#copy").click();
  await page.locator("#deleteSelection").click();
  expect(
    await page.evaluate(() => MapEditor.activeLayer.data[10 * MapEditor.document.width + 20]),
  ).toBeNull();
  await page.locator("#undo").click();
  await page.locator("#paste").click();
  await paint(page, 30, 16);
  expect(
    await page.evaluate(() => MapEditor.activeLayer.data[16 * MapEditor.document.width + 30]),
  ).not.toBeNull();
  // A full image becomes a separate embedded decoration layer.
  await upload(page, "addImage", image);
  await expect.poll(() => page.evaluate(() => MapEditor.document.layers.length)).toBe(3);
  await page.screenshot({ path: ".openai/map-editor-desktop.png" });
  expect(
    await page.evaluate(() => MapEditor.activeLayer.image.src.startsWith("data:image/png;base64,")),
  ).toBe(true);
  const projectDownload = page.waitForEvent("download");
  await page.locator("#exportProject").click();
  const project = JSON.parse(await fs.readFile(await (await projectDownload).path(), "utf8"));
  expect(project.tilesets[0].image).toContain(png);
  expect(project.layers[2].image.src).toContain(png);
  expect(project.tiles.some((t) => t.dynamic)).toBe(true);
  const gameDownload = page.waitForEvent("download");
  await page.locator("#exportGame").click();
  const map = JSON.parse(await fs.readFile(await (await gameDownload).path(), "utf8"));
  expect(map.tiles[8][18]).toBe("snow");
  expect(map.tileMap.rules).toHaveLength(2);
  const context = await browser.newContext(),
    other = await context.newPage();
  try {
    await other.goto(editorURL);
    await upload(other, "importMap", {
      name: "map.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(map)),
    });
    await expect.poll(() => other.evaluate(() => MapEditor.document.id)).toBe("browser_authored");
    expect(await other.evaluate(() => JSON.stringify(MapEditor.document))).toBe(
      JSON.stringify(project),
    );
    await upload(other, "importMap", {
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"broken"}'),
    });
    await expect(other.locator("#editorDialog")).toBeVisible();
    expect(await other.evaluate(() => MapEditor.document.id)).toBe("browser_authored");
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
test("editor tools remain usable on mobile and deployment/spawn drawing validates before export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(editorURL);
  await page.waitForFunction(() => typeof MapEditor !== "undefined");
  await page.locator("#fit").click();
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#placeSpawn").click();
  await paint(page, 4, 12);
  expect(await page.evaluate(() => MapEditor.document.spawns[0].x)).toBe(4);
  await page.locator("#drawDeployment").click();
  await rectangle(page, 0, 4, 9, 20);
  expect(await page.evaluate(() => MapEditor.document.deploymentAreas[0])).toEqual({
    x: 0,
    y: 4,
    width: 10,
    height: 17,
  });
  await page.locator("#undo").click();
  expect(await page.evaluate(() => MapEditor.document.deploymentAreas[0].height)).toBe(32);
  await page.locator("#redo").click();
  expect(await page.evaluate(() => MapEditor.document.deploymentAreas[0].height)).toBe(17);
  await page.locator("#validateMap").click();
  await expect(page.locator("#validation")).toContainText("可导出");
  await page.screenshot({ path: ".openai/map-editor-mobile.png" });
});
test("battle draws authored terrain, ground units, over-ground layers, then aircraft", async ({
  page,
}) => {
  const d = M.create({ id: "render_editor_map" });
  const above = M.layer(d, "Canopy");
  above.placement = "above";
  above.decorative = true;
  above.data[12 * d.width + 20] = "terrain_forest";
  d.layers.push(above);
  d.layers[0].data[12 * d.width + 22] = "terrain_snow";
  const map = M.compile(d),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const trace = await page.evaluate(async (map) => {
    Net.leave();
    MapCombat.reset();
    TurnFlow.reset();
    Rules.catalog.maps[map.id] = map;
    game = Rules.create(
      false,
      123,
      [[{ unitId: "Type61", kitId: "standard" }], [{ unitId: "FF_X7", kitId: "standard" }]],
      false,
      { mapId: map.id, costLimit: 99999, unitCostLimit: 99999 },
    );
    Object.assign(game.units[0], { x: 20, y: 12 });
    Object.assign(game.units[1], { x: 22, y: 12 });
    game.fogMode = "disabled";
    await SpriteRenderer.ensureModels(game.units.map((u) => u.model));
    phase = "idle";
    selected = null;
    battleView = moving = pending = null;
    mode = "select";
    setPageView("game");
    update();
    MapCamera.fit();
    const calls = [],
      oldTile = TileMapRenderer.draw,
      oldUnit = SpriteRenderer.draw;
    TileMapRenderer.draw = (...args) => {
      calls.push(args[2]);
      return oldTile(...args);
    };
    SpriteRenderer.draw = (...args) => {
      calls.push(args[1]);
      return oldUnit(...args);
    };
    try {
      drawMap(performance.now());
      return calls;
    } finally {
      TileMapRenderer.draw = oldTile;
      SpriteRenderer.draw = oldUnit;
    }
  }, map);
  expect(trace.indexOf("below")).toBeLessThan(trace.indexOf("Type61__standard"));
  expect(trace.indexOf("Type61__standard")).toBeLessThan(trace.indexOf("above"));
  expect(trace.indexOf("above")).toBeLessThan(trace.indexOf("FF_X7__standard"));
  expect(errors).toEqual([]);
});
