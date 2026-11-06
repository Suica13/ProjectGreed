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
      game.units[0].pilot = PilotSystem.createCustom("custom-map-label", "MapPilotOne");
      setPageView("game");
      const output = [];
      for (const extent of [64, 128]) {
        game.tiles = Array.from({ length: extent }, () => Array(extent).fill("plain"));
        Object.assign(game.units[0], { x: Math.floor(extent / 2), y: Math.floor(extent / 2) });
        MapCamera.reset();
        const pixelsPerZoom = mapGeo.tile / MapCamera.zoom;
        const limit = (Rules.mapCellPixels / 2) / pixelsPerZoom;
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
      expect(row.tile).toBeCloseTo(80 * 1.01, 2);
      expect(row.pilot).toBe(true);
      expect(row.unit).toBe(false);
    }
    expect(results[0].zoom).toBeLessThan(results[1].zoom);
  });

test("minimum zoom symbols outline occupied cells and overlay a pilot portrait on the unit icon",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await page.waitForFunction(()=>typeof assetsReady!=="undefined"&&assetsReady);
 await page.evaluate(()=>{
 Net.leave();game=Rules.create(false,1,[[{unitId:"RGM_79",kitId:"machine_gun"}],[{unitId:"Type61",kitId:"standard"}]],false,{costLimit:99999,unitCostLimit:99999});game.units[0].model="SalamisClass__standard";
 game.units[0].pilot=PilotSystem.createCustom("custom-symbol","Symbol pilot");
 phase="idle";mode="select";selected=null;weaponId=null;moving=null;battleView=null;
 setPageView("game");MapCamera.setZoom(.01);MapCamera.setZoom(.01);drawMap(performance.now());
 });
 await expect(page.locator("#map")).toHaveAttribute("data-unit-thumbnails","true");
 await expect.poll(()=>page.evaluate(()=>{
 const canvas=document.createElement("canvas");canvas.width=300;canvas.height=300;const ctx=canvas.getContext("2d");
 let strokes=0,images=0,fills=0;
 const stroke=ctx.strokeRect.bind(ctx),image=ctx.drawImage.bind(ctx),fill=ctx.fillRect.bind(ctx);
 ctx.strokeRect=(...args)=>{strokes++;stroke(...args)};ctx.drawImage=(...args)=>{images++;image(...args)};ctx.fillRect=(...args)=>{fills++;fill(...args)};
 const unit=game.units[0];UnitIdentity.drawMapSymbol(ctx,unit,{x:150,y:150},10);
 return {outline:strokes>=Rules.cells(unit).length,images:images>=2,noBlockFill:fills<=1};
 })).toEqual({outline:true,images:true,noBlockFill:true});
 await page.screenshot({path:"tmp/map-minimum-unit-symbols.png"});
});
