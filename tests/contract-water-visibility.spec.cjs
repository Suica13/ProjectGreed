const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("contract shoreline renders water distinctly from adjacent grass", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    const tiles = Array.from({length:12}, (_,y) => Array.from({length:18}, (_,x) =>
      x < 6 + Math.floor(y / 3) ? "water" : x > 14 ? "forest" : "plain"));
    const doc = ContractMode.visualMap(Rules.catalog, {
      mapId:"great_plains_5v5",environment:"ground",tiles,spawns:[],deploymentAreas:[],
    }).tileMap;
    const painter = TileMapView.create();
    await Promise.all(doc.tilesets.map(set => new Promise((resolve,reject) => {
      let tries=0;
      const check=()=>painter.image(set.image) ? resolve() : ++tries > 300 ? reject(Error("atlas timeout")) : setTimeout(check,20);
      check();
    })));
    const canvas=document.createElement("canvas");
    canvas.id="contractWaterPreview";
    canvas.width=864; canvas.height=576;
    canvas.style.cssText="position:fixed;inset:0;z-index:999999;background:#101c2b";
    document.body.append(canvas);
    const ctx=canvas.getContext("2d");
    painter.draw(ctx,doc,"below",{ox:0,oy:0,cellWidth:48,cellHeight:48,width:864,height:576});
    let water=0,land=0;
    tiles.forEach((row,y)=>row.forEach((kind,x)=>{
      const [r,g,b]=ctx.getImageData(x*48+24,y*48+24,1,1).data;
      if(kind==="water") {
        if(!(b>g && b>r)) throw Error(`water looks like land at ${x},${y}: ${r},${g},${b}`);
        water++;
      } else if(kind==="plain") {
        if(!(g>b)) throw Error("grass looks like water");
        land++;
      }
    }));
    return {water,land};
  });
  expect(result.water).toBeGreaterThan(50);
  expect(result.land).toBeGreaterThan(50);
  await page.locator("#contractWaterPreview").screenshot({path:"tmp/verification/screenshots/contract-water-preview.png"});
});
