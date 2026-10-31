const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const pilotRatio of [false,true]) test(`client 6-AP attack queue with ${pilotRatio ? "proportional pilot mobility" : "native AP"}`, async ({page}) => {
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  const info=await page.evaluate((pilotRatio)=>{
    Net.leave();
    const pilot=Rules.pilots.custom({...Rules.pilots.createCustom("custom-browser-ratio","Ratio"),level:10,stats:{...Rules.pilots.baseStats(),speed:150}});
    const entry=pilotRatio ? {unitId:"RGM_79",kitId:"machine_gun",customPilot:pilot} : {unitId:"RX_78NT_1",kitId:"kit_1"};
    game=Rules.create(false,1,[[entry],
      [{unitId:"RGM_79",kitId:"machine_gun"}]],false,{costLimit:99999,unitCostLimit:99999});
    game.tiles.forEach(row=>row.fill("plain"));
    const [a,b]=game.units;Object.assign(a,{x:10,y:10});Object.assign(b,{x:12,y:10,hp:1000000,shield:0});
    phase="idle";mode="select";selected=null;TurnFlow.reset();game.fogMode="disabled";AttackControls.reset();setPageView("game");select(a.id);
    const overview=document.querySelector('[data-hud-pane="overview"] .stats')?.textContent;
    AttackControls.choose(a,b);
    return {overview,ap:a.actionPoints};
  },pilotRatio);
  expect(info.ap).toBe(6);
  if(pilotRatio) expect(info.overview).toContain("7.5");
  const rifle=page.locator(`[data-queue-weapon="${pilotRatio ? "EF_90mmMG" : "EF_RX_78NT_1_BR"}"]`);
  await rifle.click();await rifle.click();await rifle.click();
  await expect(rifle).toBeDisabled();
  await expect(page.locator("#attackQueueBudget")).toContainText(/0\s*\/\s*6/);
  expect(await page.evaluate(()=>AttackControls.draft(game.units[0]).weapons.length)).toBe(3);
  expect(errors).toEqual([]);
});
