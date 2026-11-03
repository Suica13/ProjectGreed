const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
test("beam bazooka draws its native bullet and both impact layers on the map", async ({page}) => {
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(async () => {
    Net.leave();session++;
    const modelId=Object.keys(Rules.models).find(id=>Rules.models[id].prefabId==="MS_10" && Rules.models[id].weapons.some(w=>w.id==="ZN_BeamBazooka"));
    const model=Rules.models[modelId],entry={unitId:model.prefabId,kitId:model.kitId};
    game=Rules.create(false,1,[[entry],[{unitId:"RGM_79",kitId:"machine_gun"}]],false,{fogMode:"disabled"});
    game.tiles.forEach(row=>row.fill("plain"));game.deployment=null;
    const [a,b]=game.units;Object.assign(a,{x:5,y:5,hp:100000,en:10000});Object.assign(b,{x:7,y:5,hp:100000,en:10000});
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:game.units}));
    phase="idle";battleView=pending=moving=null;setPageView("game");update();
    const weapon=Rules.modelOf(a).weapons.find(w=>w.id==="ZN_BeamBazooka");
    const event={from:a.id,to:b.id,weapon:weapon.id,hit:true,damage:100,before:b.hp,after:b.hp-100,
      crossfire:true,timelineStart:0,fireAt:0,impactAt:0.5,
      strikes:weapon.attack.strikes.map((s,i)=>({...s,hit:true,damage:100,executed:i===0}))};
    const battle={a:a.id,b:b.id,actors:structuredClone([a,b]),events:[event],before:{[a.id]:a.hp,[b.id]:b.hp},crossfire:true,timelineStart:0};
    MapCombat.reset();MapCombat.seed([battle]);battleView={battles:[battle],index:0,completed:false};phase="battle";MapCombat.begin(battleView,()=>0);
    const zero=performance.now(),rate=MovementTiming.combatRate(false,false);MapCombat.update(zero);
    const context=document.createElement("canvas").getContext("2d"),drawn=[];
    context.drawImage=(image)=>drawn.push(image);
    const geom={ox:0,oy:0,tile:Rules.mapCellPixels};
    MapCombat.update(zero+0.2*1000/rate);MapCombat.draw(context,geom);
    const bullet=drawn.includes(SpriteRenderer.images[weapon.projectile.asset]);drawn.length=0;
    MapCombat.update(zero+0.55*1000/rate);MapCombat.draw(context,geom);
    return {bullet,layers:weapon.hitEffects.map(id=>drawn.includes(SpriteRenderer.images[ART.effects[id].asset])),
      speed:weapon.projectile.speed,override:MapCombat.frames[0].source.projectileForwardOffset??null};
  });
  expect(result.bullet).toBe(true);expect(result.layers).toEqual([true,true]);
  expect(result.speed).toBe(5.5);expect(result.override).toBeNull();expect(errors).toEqual([]);
});
