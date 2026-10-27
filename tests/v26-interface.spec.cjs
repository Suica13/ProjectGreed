const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
for (const width of [1280, 390])
  test(`pinch zoom anchors the map without issuing unit actions and sits below phase at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(url);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => {
        I18n.setLanguage("en");
        Net.leave();
        const e = { unitId: "Type61", kitId: "standard" };
        game = Rules.create(false, 1, [[e], [e]], false, {
          costLimit: 99999,
          unitCostLimit: 99999,
        });
        game.tiles.forEach((r) => r.fill("plain"));
        Object.assign(game.units[0], { x: 10, y: 10 });
        Object.assign(game.units[1], { x: 12, y: 10 });
        selected = weaponId = moving = pending = battleView = null;
        phase = "idle";
        mode = "select";
        setPageView("game");
        MapCamera.reset();
        update();
      });
      await expect(page.locator("#endTurn")).toHaveText("End Blue turn (B)");
      const geometry = await page.evaluate(() => {
        const a = document.querySelector(".phase-row").getBoundingClientRect(),
          z = document.querySelector(".map-camera-controls").getBoundingClientRect(),
          m = byId("map").getBoundingClientRect();
        return {
          phaseBottom: a.bottom,
          zoomTop: z.top,
          phaseLeft: a.left,
          zoomLeft: z.left,
          map: { x: m.x, y: m.y, width: m.width, height: m.height },
          units: JSON.stringify(game.units),
          zoom: MapCamera.zoom,
        };
      });
      expect(geometry.zoomTop).toBeGreaterThanOrEqual(geometry.phaseBottom + 3);
      expect(Math.abs(geometry.phaseLeft - geometry.zoomLeft)).toBeLessThan(1);
      const cdp = await context.newCDPSession(page),
        x = geometry.map.x + geometry.map.width / 2,
        y = geometry.map.y + geometry.map.height / 2;
      const touches = (d) => [
        { x: x - d, y, id: 1 },
        { x: x + d, y, id: 2 },
      ];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(30) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(85) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect
        .poll(() => page.evaluate(() => MapCamera.zoom))
        .toBeGreaterThan(geometry.zoom * 1.5);
      expect(await page.evaluate(() => selected)).toBe(null);
      expect(await page.evaluate(() => JSON.stringify(game.units))).toBe(geometry.units);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(85) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(30) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect
        .poll(() => page.evaluate(() => MapCamera.zoom))
        .toBeLessThan(geometry.zoom * 1.5);
      await page.locator("#mapZoomReset").click();
      await expect(page.locator("#mapZoomLabel")).toHaveText(Math.round(geometry.zoom * 100) + "%");
      await page.screenshot({ path: ".openai/pinch-" + width + ".png" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
test("faction menu tracks decode, switching preserves pause, and a new save restores EFSF", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("music-seeded")) {
      localStorage.setItem("music-seeded", "1");
      localStorage.setItem("projectgreed.combatFaction", "PMC");
    }
  });
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  for (const [faction, name, mime] of [
    ["PMC", "SDGO 大厅", "audio/ogg"],
    ["EFSF", "EFSF_PLAN", "audio/mpeg"],
    ["ZEON", "ZEON_PLAN", "audio/mpeg"],
  ]) {
    await page.locator("#menuFactionSelect").selectOption(faction);
    const value = await page.evaluate(async () => {
      MusicPlayer.sync();
      const track = ART.music.tracks[MusicPlayer.index];
      const a = MusicPlayer.audio;
      a.src = track.source;
      await a.play();
      const r = {
        name: track.name,
        file: track.file,
        faction: track.faction,
        source: track.source.slice(0, 30),
        decoded: a.readyState >= 2,
      };
      a.pause();
      return r;
    });
    expect(value.faction).toBe(faction);
    if (faction !== "PMC") expect(value.file).toContain(name);
    expect(value.source).toContain(mime);
    expect(value.decoded).toBe(true);
  }
  await page.locator("#musicToggle").click();
  await expect.poll(() => page.evaluate(() => MusicPlayer.audio.paused)).toBe(false);
  await page.locator("#musicToggle").click();
  await page.locator("#menuFactionSelect").selectOption("PMC");
  expect(await page.evaluate(() => MusicPlayer.audio.paused)).toBe(true);
  await page.locator("#openClientSettings").click();
  await page.locator("#newProfileSave").click();
  await page.locator("#gameDialog .game-dialog-actions button").last().click();
  await page.waitForLoadState("load");
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => PlayerProfile.faction())).toBe("EFSF");
  expect(await page.evaluate(() => ART.music.tracks[MusicPlayer.index].file)).toContain(
    "EFSF_PLAN",
  );
});
for (const lang of ["en", "ja"])
  test(`recent UI flows and faction choices localize in ${lang} without altering saves`, async ({
    page,
  }) => {
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate((l) => I18n.setLanguage(l), lang);
    const scan = async () => {
      await page.waitForTimeout(60);
      return page.evaluate(() => {
        const bad = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          const n = w.currentNode,
            e = n.parentElement;
          if (
            !e ||
            e.closest("script,style,input,textarea,[data-i18n-ignore]") ||
            !e.checkVisibility({ visibilityProperty: true })
          )
            continue;
          const pattern =
            I18n.language === "en" ? /[\u3400-\u9fff]/ : /驾驶|编组|库存|生产|阵营|确认|资金|物资/;
          if (pattern.test(n.nodeValue)) bad.push(n.nodeValue.trim());
        }
        return bad.filter(Boolean);
      });
    };
    expect(await scan()).toEqual([]);
    await page.locator("#openFormation").click();
    expect(await scan()).toEqual([]);
    await page.locator("#formationPilotsTab").click();
    expect(await scan()).toEqual([]);
    await page.locator("#createCustomPilot").click();
    expect(await scan()).toEqual([]);
    await page.locator("#finishCustomPilot").click();
    await page.locator("#formationUnitsTab").click();
    await page.locator("#saveFormation").click();
    await page.locator("#openProduction").click();
    expect(await scan()).toEqual([]);
    await page.locator("#closeProduction").click();
    await page.locator("#openDevelopment").click();
    expect(await scan()).toEqual([]);
  });
