const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");

for(const width of [1440,390])for(const kind of ["mortar","snipe"])
test(`${kind} selects a target, cancels without cost and submits once on confirmation at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator("#profileCompanyName").fill("Skill PMC");
  await page.locator("#profileOnboardingConfirm").click();
  const id=await page.evaluate(async kind=>{
    Net.leave();session++;
    const model=Object.values(Rules.models).find(model=>model.prefabId===(kind==="mortar"?"RX_77_2":"RGM_79_G_SP")&&
      model.weapons.some(weapon=>kind==="mortar"?weapon.category==="mortar":weapon.special?.type===kind));
    game=Rules.create(false,1,[[{unitId:model.prefabId,kitId:model.kitId}],[{unitId:"RGM_79",kitId:"machine_gun"}]],false,{fogMode:"disabled"});
    game.tiles.forEach(row=>row.fill("plain"));game.deployment=null;
    game.units.forEach((unit,index)=>Object.assign(unit,{x:5+index*4,y:5,hp:1000000,en:100000}));
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
    phase="idle";pending=moving=battleView=null;selected=game.units[0].id;mode="select";
    Net.active=true;Net.seat=0;Net.socket={readyState:WebSocket.OPEN};Net.awaiting=false;
    Net.snapshot={started:true,phase:"idle",settings:Rules.defaultRoomSettings(),members:[{seat:0,connected:true},{seat:1,connected:true}],
      connected:[true,true],delegatedSeats:[],turnDone:[false,false],game};
    window.skillRequests=[];Net.request=(action,fields)=>skillRequests.push({action,fields});
    window.skillSounds=[];
    const play=GameAudio.play;
    GameAudio.play=(sound,...args)=>{skillSounds.push(sound);return play(sound,...args);};
    window.skillBefore=game.units[0].en;
    setPageView("game");update();BattleHUD.setTab("skills");
    return Rules.modelOf(game.units[0]).weapons.find(weapon=>kind==="mortar"?weapon.category==="mortar":weapon.special?.type===kind).id;
  },kind);
  const start=()=>page.locator(`[data-weapon-skill="${id}"]`).click();
  const aim=async()=>{
    const point=await page.evaluate(()=>{
      MapCamera.focus(9,5);drawMap(performance.now());
      const point=mapPosition(9,5),canvas=byId("map"),bounds=canvas.getBoundingClientRect();
      return {x:point.x*bounds.width/canvas.width,y:point.y*bounds.height/canvas.height};
    });
    await page.locator("#map").click({position:point,force:true});
  };
  await start();
  const confirm=page.locator("#hudConfirmSkill");
  await expect(confirm).toBeVisible();await expect(confirm).toBeDisabled();
  await aim();await expect(confirm).toBeEnabled();
  expect(await page.evaluate(()=>skillSounds.includes("lockonSound"))).toBe(true);
  const locked=await page.evaluate(()=>({
    targetId:SkillControls.confirmation(getUnit(selected)).draft.targetId,
    cell:SkillControls.targetCell(getUnit(selected)),
  }));
  // Move away from the clicked enemy, then leave the map for the confirmation panel.
  const mapBox=await page.locator("#map").boundingBox();
  await page.mouse.move(mapBox.x+20,mapBox.y+20);
  await confirm.hover();
  expect(await page.evaluate(()=>({
    targetId:SkillControls.confirmation(getUnit(selected)).draft.targetId,
    cell:SkillControls.targetCell(getUnit(selected)),
  }))).toEqual(locked);
  expect(await page.evaluate(()=>skillRequests.length)).toBe(0);
  const box=await confirm.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  await page.locator("#hudCancelAction").click();
  expect(await page.evaluate(()=>({en:game.units[0].en,before:skillBefore,requests:skillRequests.length,mode})))
    .toMatchObject({requests:0,mode:"select"});
  expect(await page.evaluate(()=>game.units[0].en===skillBefore)).toBe(true);
  await start();await aim();await confirm.click();
  const requests=await page.evaluate(()=>skillRequests);
  expect(requests).toHaveLength(1);expect(requests[0].action).toBe("attack");
  expect(requests[0].fields.weaponId).toBe(id);expect(requests[0].fields.single).toBe(true);
  expect(requests[0].fields.targetId).toBe("1-0");
  expect(requests[0].fields.aimCell).toEqual({x:9,y:5});
  await expect(confirm).toBeHidden();expect(await page.evaluate(()=>mode)).toBe("select");
  expect(errors).toEqual([]);
});

test("a targeted recon skill spends EN only after its confirmation button is pressed",async({page})=>{
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator("#profileCompanyName").fill("Recon PMC");
  await page.locator("#profileOnboardingConfirm").click();
  const result=await page.evaluate(async()=>{
    Net.leave();session++;
    const model=Object.values(Rules.models).find(model=>model.prefabId==="MS_06E");
    game=Rules.create(false,1,[[{unitId:model.prefabId,kitId:model.kitId}],[{unitId:"RGM_79",kitId:"machine_gun"}]],false,{fogMode:"disabled"});
    game.tiles.forEach(row=>row.fill("plain"));game.deployment=null;
    const actor=game.units[0];Object.assign(actor,{x:5,y:5});
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
    phase="idle";pending=moving=battleView=null;selected=actor.id;mode="select";
    setPageView("game");update();BattleHUD.setTab("skills");
    const skill=Rules.unitSkills(actor).find(skill=>skill.id==="Common_CameraGun");
    const before=actor.en;
    document.querySelector('[data-unit-skill="Common_CameraGun"]').click();
    const cell=Rules.skillTargets(game,actor,skill.id)[0];
    SkillControls.click(cell,actor);
    const preview=actor.en,ready=!byId("hudConfirmSkill").disabled;
    byId("hudConfirmSkill").click();
    return {before,preview,after:actor.en,cost:skill.enCost,ready,mode};
  });
  expect(result.ready).toBe(true);expect(result.preview).toBe(result.before);
  expect(result.after).toBe(result.before-result.cost);expect(result.mode).toBe("select");
});
