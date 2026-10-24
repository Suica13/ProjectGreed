const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("all ten maps can be selected in an offline room with descriptions and a new 3v3 map enters deployment", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomMapSelect option")).toHaveCount(14);
  const maps = await page.evaluate(() =>
    Object.values(Rules.catalog.maps)
      .filter((m) => m.appearance && m.id !== "forest_front_5v5")
      .map((m) => ({ id: m.id, description: m.description })),
  );
  for (const map of maps) {
    await page.locator("#roomMapSelect").selectOption(map.id);
    await waitForRoomSettings(page);
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe(map.id);
    await expect(page.locator("#roomMapInfo")).toContainText(map.description);
  }
  await page.locator("#roomMapSelect").selectOption("new_york_crossfire_3v3");
  await waitForRoomSettings(page);
  for (const seat of [2, 3, 4, 5]) await page.locator("#addAI" + seat).click();
  await page.locator("#toggleReady").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#confirmDeployment")).toBeVisible();
  expect(await page.evaluate(() => game.mapId)).toBe("new_york_crossfire_3v3");
  expect(await page.evaluate(() => [Rules.mapWidth(game), Rules.mapHeight(game)])).toEqual([
    26, 38,
  ]);
  await expect(page.locator(".roster-owner")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => new Set(game.units.map((u) => u.x + "," + u.y)).size === game.units.length,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".openai/new-city-3v3.png" });
  expect(errors).toEqual([]);
});

test("new map themes render in battle and an overview shows all ten different layouts", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await openPresentationFixture(page, false);
  for (const id of ["arctic_base_1v1", "open_dunes_1v1", "marsh_islands_1v1"]) {
    await page.evaluate((id) => {
      const map = Rules.getMap(id),
        entry = { unitId: "RGM_79", kitId: "machine_gun" };
      game = Rules.create(
        false,
        1,
        map.spawns.map(() => [entry]),
        true,
        { mapId: id },
      );
      phase = "deployment";
      MapCamera.reset();
      update();
      drawMap(1000);
    }, id);
  }
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.id = "mapPackOverview";
    Object.assign(panel.style, {
      position: "fixed",
      inset: "0",
      zIndex: "20000",
      background: "#0b1821",
      padding: "18px",
      display: "grid",
      gridTemplateColumns: "repeat(5,1fr)",
      gap: "12px",
      color: "white",
      font: "14px sans-serif",
    });
    for (const map of Object.values(Rules.catalog.maps).filter(
      (m) => m.appearance && m.id !== "forest_front_5v5",
    )) {
      const card = document.createElement("section"),
        title = document.createElement("h3"),
        canvas = document.createElement("canvas"),
        caption = document.createElement("p");
      title.textContent = map.name;
      title.style.fontSize = "16px";
      caption.textContent = map.description;
      caption.style.fontSize = "12px";
      canvas.width = 260;
      canvas.height = 380;
      canvas.style.width = "100%";
      canvas.style.height = "350px";
      canvas.style.objectFit = "contain";
      const ctx = canvas.getContext("2d"),
        cell = Math.min(260 / map.width, 380 / map.height),
        oy = (380 - map.height * cell) / 2;
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          ctx.fillStyle = Rules.terrainStyle(map.id, map.tiles[y][x]).color;
          ctx.fillRect(x * cell, oy + y * cell, cell, cell);
        }
      for (const spawn of map.spawns) {
        ctx.strokeStyle = spawn.team ? "#ff9480" : "#70dbff";
        ctx.lineWidth = 2;
        ctx.strokeRect((spawn.x - 1) * cell, oy + (spawn.y - 1) * cell, 3 * cell, 3 * cell);
      }
      card.append(title, canvas, caption);
      panel.append(card);
    }
    document.body.append(panel);
  });
  await page.screenshot({ path: ".openai/map-pack-overview.png" });
  expect(errors).toEqual([]);
});
