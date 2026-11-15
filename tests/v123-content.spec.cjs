const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`0079 scenario, centered objectives and reinforcement shooting at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      const factory = createRoomEngine;
      createRoomEngine = (options) =>
        (window.contentEngine = factory({ ...options, aiDelayMs: 999999 }));
      const start = SkillEffects.start;
      SkillEffects.start = (e) => {
        start(e);
        if (e.scripted) window.scriptPose = SkillEffects.pose({ id: e.unitId }, performance.now());
      };
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await page.locator("#offlineRoomMode").selectOption("mission");
    await page.locator("#confirmOfflineMode").click();
    await page.waitForFunction(() => !Net.awaiting && Net.snapshot?.settings.mode === "mission");
    await page.evaluate(() =>
      Net.request("configure_room", { ...Net.snapshot.settings, mapId: "mission_efsf_side7" }),
    );
    await page.waitForFunction(
      () => !Net.awaiting && Net.snapshot.settings.mapId === "mission_efsf_side7",
    );
    await page.evaluate(() =>
      Net.request("start_game", { formation: [{ unitId: "Medea", kitId: "standard" }] }),
    );
    await page.locator("#confirmFinalFormation").click();
    await page.waitForFunction(() => !Net.awaiting && Net.snapshot.phase === "deployment");
    await page.evaluate(() => Net.request("auto_place_deployment"));
    await page.waitForFunction(() => !Net.awaiting);
    await page.evaluate(() => Net.request("confirm_deployment"));
    await expect(page.locator("#missionDialogue")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const a = byId("missionObjectives").getBoundingClientRect(),
        b = byId("mapWrap").getBoundingClientRect();
      return { delta: Math.abs(a.x + a.width / 2 - b.x - b.width / 2), top: a.y - b.y };
    });
    expect(geometry.delta).toBeLessThan(2);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeLessThan(width < 700 ? 65 : 20);
    await page.locator("#missionDialogue button").click();
    await expect(page.locator("#missionDialogue")).toBeHidden();
    await page.evaluate(() => {
      const room = [...contentEngine.rooms.values()][0];
      room.game.round = 3;
      room.revision++;
      contentEngine.broadcast(room);
    });
    await expect(page.locator("#missionDialogue")).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!window.scriptPose)).toBeTruthy();
    const result = await page.evaluate(() => ({
      clip: scriptPose.clip,
      hits: Net.snapshot.game.mission.cinematic.hits.length,
      dead: Net.snapshot.game.units
        .filter((u) => ["enemy-0", "enemy-1"].includes(u.missionActor))
        .every((u) => u.hp === 0),
    }));
    expect(result.clip).toBeTruthy();
    expect(result.hits).toBe(2);
    expect(result.dead).toBeTruthy();
    await page.screenshot({ path: `tmp/verification/screenshots/v123-mission-${width}.png` });
    expect(errors).toEqual([]);
  });
test("victory labels describe player outcome and use only the final turn", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    Net.active = false;
    Net.seat = 0;
    game = Rules.create(
      false,
      1,
      [[{ unitId: "Type61", kitId: "standard" }], [{ unitId: "Type61", kitId: "standard" }]],
      false,
      { mapId: "frontier_1v1", mode: "quick" },
    );
    game.round = 11;
    game.winner = 0;
    MapEffects.reset();
    showVictory();
    const victory = byId("victoryTitle").textContent,
      note = byId("victoryNote").textContent;
    game.winner = 1;
    showVictory();
    const defeat = byId("victoryTitle").textContent;
    I18n.setLanguage("en");
    return { victory, note, defeat, english: I18n.text("战斗于第11回合结束") };
  });
  expect(result).toEqual({
    victory: "胜利",
    note: "战斗于第11回合结束",
    defeat: "失败",
    english: "Battle ended on turn 11",
  });
});
test("new maps render their biome atlas with connected shores and space clearings", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1320, height: 1000 });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    const ids = [
      "battlefield_asteroid_corridor",
      "battlefield_ship_graveyard",
      "battlefield_lunar_orbit",
      "battlefield_mangrove_delta",
      "battlefield_frozen_basin",
      "jungle_delta_3v3",
      "glacier_gates_3v3",
      "desert_relay_3v3",
      "urban_floodplain_3v3",
      "orbital_arc_3v3",
    ];
    const gallery = document.createElement("div");
    gallery.id = "map-gallery";
    gallery.style.cssText =
      "position:absolute;left:0;top:0;z-index:99999;display:grid;grid-template-columns:640px 640px;background:#101822;gap:12px;padding:8px";
    document.body.append(gallery);
    const loaded = new Map();
    for (const id of ids) {
      const map = Rules.getMap(id);
      for (const set of map.tileMap.tilesets)
        if (!loaded.has(set.image)) {
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = TileMapView.resolveSource(set.image);
          });
          loaded.set(set.image, image);
        }
    }
    for (const id of ids) {
      const map = Rules.getMap(id),
        canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 466;
      gallery.append(canvas);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#101822";
      ctx.fillRect(0, 0, 640, 466);
      ctx.fillStyle = "#edf5ff";
      ctx.font = "16px sans-serif";
      ctx.fillText(map.name, 8, 20);
      const painter = TileMapView.create({ loadImage: (src) => loaded.get(src) }),
        cell = Math.min(640 / map.width, 440 / map.height);
      for (const placement of ["below", "above"])
        painter.draw(ctx, map.tileMap, placement, {
          ox: 0,
          oy: 26,
          cellWidth: cell,
          cellHeight: cell,
          width: 640,
          height: 466,
        });
      for (const p of map.battlefield?.points || []) {
        ctx.strokeStyle = "#ffdb73";
        ctx.strokeRect(p.x * cell, 26 + p.y * cell, cell, cell);
      }
    }
    return { images: loaded.size, canvases: gallery.children.length };
  });
  expect(result.canvases).toBe(10);
  expect(result.images).toBeGreaterThanOrEqual(5);
  await page
    .locator("#map-gallery")
    .screenshot({ path: "tmp/verification/screenshots/v123-map-gallery.png" });
});
