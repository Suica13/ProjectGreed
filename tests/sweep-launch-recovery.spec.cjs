const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
for(const width of [1440,390])test(`sweep confirmation recovers from launch failure and retries a late-era low-budget node at ${width}px`,async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{
    const factory=createRoomEngine;
    createRoomEngine=options=>(window.sweepLaunchEngine=factory({...options,aiDelayMs:999999,rules:{...Rules,create(...args){
      if(window.failSweepCreation)throw Error("injected sweep launch failure");return Rules.create(...args);
    }}}));
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("sweep");
  await page.locator("#createOfflineRoom").click();
  if(width===390)await page.getByRole("button",{name:"房间设置",exact:true}).click();
  await page.locator("#sweepEra").selectOption("0079T2");
  await page.locator("#sweepFaction").selectOption("ZEON");
  if(width===390)await page.locator("#roomSettingsSheet").getByRole("button",{name:"关闭",exact:true}).click();
  await page.evaluate(()=>Net.request("start_game",{formation:[{unitId:"Medea",kitId:"standard"}]}));
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#sweepMission")).toBeVisible();
  await page.locator('[data-sweep-node="0:1"]').click();
  await page.evaluate(()=>window.failSweepCreation=true);
  await page.locator("#sweepConfirm").click();
  await expect.poll(()=>page.evaluate(()=>Array.from(sweepLaunchEngine.rooms.values())[0].phase)).toBe("sweep_map");
  expect(await page.evaluate(()=>Array.from(sweepLaunchEngine.rooms.values())[0].sweep.selected)).toBe("0:1");
  await expect(page.locator("#sweepConfirm")).toBeEnabled();
  await page.evaluate(()=>window.failSweepCreation=false);
  await page.locator("#sweepConfirm").click();
  await expect(page.locator("#sweepMission")).toBeHidden();
  await expect(page.locator("#deploymentRoster")).toBeVisible();
  expect(await page.evaluate(()=>Array.from(sweepLaunchEngine.rooms.values())[0].game.units.some(u=>u.team===1))).toBe(true);
  expect(errors).toEqual([]);
});
