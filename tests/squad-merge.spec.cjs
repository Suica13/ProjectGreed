const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
for (const width of [1440,390]) for (const sharedId of [false,true])
  test(`two-unit map click merges with a single unit at ${width}px (historical shared ID: ${sharedId})`,async({page})=>{
    test.setTimeout(60000);await page.setViewportSize({width,height:960});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(()=>assetsReady);
    await page.evaluate(async(sharedId)=>{
      I18n.setLanguage("zh");Net.leave();session++;
      const entry={unitId:"RGM_79",kitId:"machine_gun"};
      game=Rules.create(false,1,[[entry],[entry]],false,{fogMode:"disabled"});
      game.tiles.forEach(row=>row.fill("plain"));const source=game.units[0],enemy=game.units[1];
      game.units=[0,1,2].map(index=>({...structuredClone(source),id:"merge-"+index,x:index===2?6:5,y:5,
        ...(index<2||sharedId?{squadId:"separated",squadSlot:index}:{})}));
      Object.assign(enemy,{x:12,y:12});game.units.push(enemy);game.deployment=null;
      phase="idle";pending=moving=battleView=null;selected="merge-0";mode="select";squadSingleMove=false;
      await SpriteRenderer.ensureModels(game.units.map(unit=>unit.model));
      setPageView("game");MapCamera.focus(5.5,5);update();
    },sharedId);
    await page.locator('[data-unit-command="move"]').click();
    expect(await page.evaluate(()=>mapRanges(getUnit(selected),true,null).moveCells.get(Rules.key(6,5))?.squadTarget)).toBe("merge-2");
    const click=async()=>{
      const point=await page.evaluate(()=>{const p=mapPosition(6,5),canvas=byId("map"),r=canvas.getBoundingClientRect();return {x:p.x*r.width/canvas.width,y:p.y*r.height/canvas.height};});
      await page.locator("#map").click({position:point});
      await expect(page.locator("#hudConfirmMove")).toBeVisible();
      await expect(page.locator("#hudConfirmMove")).toBeEnabled();
      expect(await page.evaluate(()=>selected)).toBe("merge-0");
    };
    await click();await page.evaluate(()=>finishMovement(false));
    expect(await page.evaluate(()=>getUnit("merge-0").x)).toBe(5);
    await page.locator('[data-unit-command="move"]').click();await click();
    await expect(page.locator("#hudConfirmMove")).toBeEnabled();await page.locator("#hudConfirmMove").click();
    expect(await page.evaluate(()=>Rules.squadMembers(game,getUnit("merge-2")).map(u=>u.id).sort())).toEqual(["merge-0","merge-1","merge-2"]);
    expect(await page.evaluate(()=>game.units.filter(u=>u.id.startsWith("merge-")).every(u=>u.x===6&&u.y===5&&!u.pendingMove))).toBe(true);
    expect(errors).toEqual([]);
  });
