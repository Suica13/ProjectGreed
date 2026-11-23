const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
test("MS command becomes visible and effective at 101 leadership in the standalone browser",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator("#profileCompanyName").fill("Command PMC");
  await page.locator("#profileOnboardingConfirm").click();
  const result=await page.evaluate(async()=>{
    Net.leave();session++;
    const entry={unitId:"RGM_79",kitId:"machine_gun"};
    game=Rules.create(false,1,[[entry,entry],[entry]],false,{fogMode:"disabled",costLimit:99999,unitCostLimit:99999});
    game.tiles.forEach(row=>row.fill("plain"));game.deployment=null;
    game.units.forEach((u,i)=>Object.assign(u,{x:5+i,y:5,pilot:{stats:{shooting:100,melee:100,defense:100,speed:100,accuracy:100,reaction:100,leadership:100,awakening:0}}}));
    const [unit,ally]=game.units;
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
    phase="idle";pending=moving=battleView=null;mode="select";selected=unit.id;
    const inactive=Rules.commandCells(game,unit).length;
    unit.pilot.stats.leadership=101;
    setPageView("game");update();MapCamera.focus(6,5);drawMap(performance.now());
    return {inactive,active:Rules.commandCells(game,unit).length,
      effects:Rules.commandEffects(game,ally),ship:!!Rules.modelOf(unit).ship};
  });
  expect(result.inactive).toBe(0);expect(result.active).toBeGreaterThan(0);
  expect(result.ship).toBe(false);expect(Object.values(result.effects)).toContain(.1);
  await page.screenshot({path:"tmp/verification/screenshots/ms-command-range.png"});
  expect(errors).toEqual([]);
});
