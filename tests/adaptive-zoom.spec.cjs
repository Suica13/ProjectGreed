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
          targetTile: Math.max(box.width / 8, box.height / 4),
          percent: MapCamera.zoomPercent,
          cell: cellAt({ clientX: box.left + point.x, clientY: box.top + point.y }),
          x: u.x,
          y: u.y,
        });
      }
      return rows;
    });
    for (const r of results) {
      expect(r.tile).toBeCloseTo(r.targetTile, 4);
      expect(r.percent).toBe(100);
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
    await expect(page.locator("#mapZoomLabel")).toHaveText("1%");
    expect(errors).toEqual([]);
  });
}

for (const input of ["mouse", "touch"]) {
  test(`map pans at every zoom with ${input} without issuing clicks`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
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
      moving = battleView = null;
      setPageView("game");
      window.panClicks = 0;
      byId("map").addEventListener("click", () => window.panClicks++);
    });
    const session = input === "touch" ? await page.context().newCDPSession(page) : null;
    for (const level of ["minimum", "fit", "normal", "maximum"]) {
      const before = await page.evaluate((level) => {
        MapCamera.reset();
        if (level === "minimum") { MapCamera.fit(); MapCamera.setZoom(0); }
        if (level === "fit") MapCamera.fit();
        if (level === "maximum") MapCamera.setZoom(1e6);
        const box = byId("map").getBoundingClientRect();
        return { ox: mapGeo.ox, oy: mapGeo.oy, x: box.left + box.width / 2, y: box.top + box.height / 2 };
      }, level);
      if (session) {
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: before.x, y: before.y }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: before.x + 30, y: before.y + 20 }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(before.x, before.y);
        await page.mouse.down();
        await page.mouse.move(before.x + 30, before.y + 20, { steps: 4 });
        await page.mouse.up();
      }
      const after = await page.evaluate(() => ({ ox: mapGeo.ox, oy: mapGeo.oy, clicks: window.panClicks }));
      expect(after.ox - before.ox, level).toBeCloseTo(30, 0);
      expect(after.oy - before.oy, level).toBeCloseTo(20, 0);
      expect(after.clicks).toBe(0);
    }
    await session?.detach();
  });
}

test("same-frame percent changes share viewport bounds while updating the zoom controls",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);await page.waitForFunction(()=>assetsReady);
 const rows=await page.evaluate(()=>{
   Net.leave();const e={unitId:"Type61",kitId:"standard"};game=Rules.create(false,1,[[e],[e]],false);
   phase="idle";mode="select";selected=null;moving=battleView=null;setPageView("game");MapCamera.fit();
   const canvas=byId("map"),read=canvas.getBoundingClientRect.bind(canvas);let count=0;
   canvas.getBoundingClientRect=()=>{count++;return read();};
   MapCamera.beginFrame();
   try {return [25,50,100,0].map(percent=>{const before=count;MapCamera.setPercent(percent);return {percent,reads:count-before,label:byId("mapZoomLabel").textContent};});}
   finally {canvas.getBoundingClientRect=read;}
 });
 expect(rows.reduce((sum,row)=>sum+row.reads,0)).toBe(1);
 for(const row of rows){expect(row.reads).toBeLessThanOrEqual(1);expect(row.label).toBe(row.percent+"%");}
});
