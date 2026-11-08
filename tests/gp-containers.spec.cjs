const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
for (const nuclear of [false,true]) test(`GP03D ${nuclear ? "nuclear" : "AMS"} cargo deploys, opens and fires on the map`, async ({ page }) => {
  test.setTimeout(60000);
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result=await page.evaluate(async nuclear=>{
    Net.leave(); session++; MapCombat.reset();
    const key="EF_GP_03D_MSL_"+(nuclear?"ASP":"AMS");
    game=Rules.create(false,417,[[{unitId:"RX_78GP03D",kitId:"standard"}],
      [{unitId:"RGM_79",kitId:"machine_gun"},{unitId:"RGM_79",kitId:"machine_gun"}]],false,
      {fogMode:"disabled",costLimit:99999,unitCostLimit:99999});
    game.tiles.forEach(row=>row.fill("plain")); game.deployment=null;
    const [a,b,c]=game.units;
    Object.assign(a,{x:4,y:6,hp:1000000,en:5000,shield:0});
    Object.assign(b,{x:10,y:6,hp:1000000,shield:0});
    Object.assign(c,{x:10,y:6,hp:1000000,shield:0,squadId:"cargo-target"});
    b.squadId="cargo-target";
    const weapon=Rules.modelOf(a).weapons.find(w=>w.id===key), cargo=weapon.projectile.container;
    const intent={attacker:a.id,target:b.id,weapon:key,weapons:[key],targetSquad:[b.id,c.id],
      ...(nuclear?{cellBlast:true,impactCell:{x:10,y:6},blastId:"cargo-nuke"}:{})};
    let id=0;
    const battles=Rules.resolveAutomatic({game,matchId:"cargo-ui"},[{intent,response:"defend"}],()=>"cargo-"+(++id));
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:game.units}));
    phase="idle";battleView=pending=moving=null;setPageView("game");update();byId("quick").checked=false;
    MapCombat.reset();MapCombat.seed(battles);
    battleView={battles,index:0,completed:false};phase="battle";
    MapCombat.begin(battleView,()=>0);const zero=performance.now(),rate=MovementTiming.combatRate(false,false);
    MapCombat.update(zero);
    const canvas=document.createElement("canvas");canvas.width=2400;canvas.height=1600;
    canvas.id="cargoFixture";canvas.style.cssText="position:fixed;inset:0;z-index:999999;background:#17212b;width:1200px;height:800px";
    document.body.append(canvas);const ctx=canvas.getContext("2d"),seen=[];
    const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{seen.push(args[0]);draw(...args);};
    const geometry={ox:0,oy:0,tile:Rules.mapCellPixels};
    MapCombat.update(zero+0.2*1000/rate);MapCombat.draw(ctx,geometry);
    const closed=seen.includes(SpriteRenderer.images[cargo.closedAsset]);seen.length=0;ctx.clearRect(0,0,2400,1600);
    const first=MapCombat.frames.flatMap(frame=>frame.plan.shots.map(shot=>({frame,shot})))
      .sort((a,b)=>a.shot.at-b.shot.at)[0];
    MapCombat.update(zero+(first.shot.at+0.2)*1000/rate);MapCombat.draw(ctx,geometry);
    return {closed,open:seen.includes(SpriteRenderer.images[cargo.openAsset]),
      missile:seen.includes(SpriteRenderer.images[weapon.projectile.asset]),
      curves:MapCombat.frames.every(f=>f.plan.shots.every(s=>!!s.control)),
      cargoLanes:MapCombat.frames.filter(f=>!f.event.containerFollowup).length,
      nuclearLanes:nuclear?MapCombat.frames.filter(f=>!f.event.nuclearFollowup).length:0,
      debug:{loaded:!!SpriteRenderer.images[weapon.projectile.asset],at:first.shot.at,visibleUntil:first.shot.visibleUntil,
        flight:first.shot.flight,time:first.frame.time,origin:first.shot.origin,destination:first.shot.destination,
        seen:seen.length,shots:MapCombat.frames.map(f=>[f.time,f.plan.shots.length])}};
  },nuclear);
  expect(result.closed).toBe(true);expect(result.open).toBe(true);expect(result.missile,JSON.stringify(result.debug)).toBe(true);
  expect(result.curves).toBe(true);expect(result.cargoLanes).toBe(1);
  if(nuclear)expect(result.nuclearLanes).toBe(3);
  await page.locator("#cargoFixture").screenshot({path:`tmp/verification/screenshots/gp03-cargo-${nuclear?"nuclear":"ams"}.png`});
  expect(errors).toEqual([]);
});

test("GP02A exposes an enabled nuclear skill and enters nuclear targeting", async ({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(()=>{
    Net.leave();session++;const model=Object.values(Rules.models).find(m=>m.prefabId==="RX_78GP02A");
    game=Rules.create(false,71,[[{unitId:model.prefabId,kitId:model.kitId}],
      [{unitId:"RGM_79",kitId:"machine_gun"}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:"disabled"});
    game.deployment=null;game.tiles.forEach(row=>row.fill("plain"));
    const [a,b]=game.units;Object.assign(a,{x:3,y:5});Object.assign(b,{x:7,y:5});
    selected=a.id;phase="idle";battleView=pending=moving=null;mode="select";
    const list=document.createElement("div");list.id="nukeSkillFixture";
    list.style.cssText="position:fixed;inset:0 auto auto 0;width:500px;background:#17212b;z-index:999999";
    document.body.append(list);SkillControls.render(list,a,true);
  });
  const use=page.locator('#nukeSkillFixture [data-weapon-skill="EF_RX_78GP02A_Bombing_Nuke"]');
  await expect(use).toBeEnabled();await use.click();
  expect(await page.evaluate(()=>({mode,weaponId}))).toEqual({mode:"target",weaponId:"EF_RX_78GP02A_Bombing_Nuke"});
  expect(errors).toEqual([]);
});
