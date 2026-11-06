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
    phase="idle";battleView=pending=moving=null;setPageView("game");update();byId("quick").checked=false;
    const weapon=Rules.modelOf(a).weapons.find(w=>w.id==="ZN_BeamBazooka");
    const event={from:a.id,to:b.id,weapon:weapon.id,hit:true,damage:100,before:b.hp,after:b.hp-100,
      crossfire:true,timelineStart:0,fireAt:0,impactAt:0.5,
      strikes:weapon.attack.strikes.map((s,i)=>({...s,hit:true,damage:100,executed:i===0}))};
    const battle={a:a.id,b:b.id,actors:structuredClone([a,b]),events:[event],before:{[a.id]:a.hp,[b.id]:b.hp},crossfire:true,timelineStart:0};
    MapCombat.reset();MapCombat.seed([battle]);battleView={battles:[battle],index:0,completed:false};phase="battle";MapCombat.begin(battleView,()=>0);
    const zero=performance.now(),rate=MovementTiming.combatRate(false,false);MapCombat.update(zero);
    const canvas=document.createElement("canvas");canvas.width=1600;canvas.height=1000;const context=canvas.getContext("2d"),drawn=[];
    context.drawImage=(image)=>drawn.push(image);
    const geom={ox:0,oy:0,tile:Rules.mapCellPixels};
    const plan=MapCombat.frames[0].plan,shot=plan.shots[0];MapCombat.update(zero+(shot.at+shot.flight/2)*1000/rate);MapCombat.draw(context,geom);
    const bullet=drawn.includes(SpriteRenderer.images[weapon.projectile.asset]);drawn.length=0;
    MapCombat.update(zero+(plan.contacts[0].at+0.05)*1000/rate);MapCombat.draw(context,geom);
    return {bullet,layers:weapon.hitEffects.map(id=>drawn.includes(SpriteRenderer.images[ART.effects[id].asset])),
      speed:weapon.projectile.speed,override:MapCombat.frames[0].source.projectileForwardOffset??null};
  });
  expect(result.bullet).toBe(true);expect(result.layers).toEqual([true,true]);
  expect(result.speed).toBe(5.5);expect(result.override).toBeNull();expect(errors).toEqual([]);
});


for (const [unitId, weaponId] of [
  ["MA_08", "ZN_MA_08_BeamCannon"],
  ["AMX_002", "ZN_AMX_002_BeamCannon"],
]) {
  test(`${unitId} heavy beam cannon reaches its target at the corrected speed`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    const result = await page.evaluate(async ({ unitId, weaponId }) => {
      Net.leave(); session++;
      const model = Object.values(Rules.models).find(model =>
        model.prefabId === unitId && model.weapons.some(weapon => weapon.id === weaponId));
      game = Rules.create(false, 1, [
        [{ unitId, kitId: model.kitId }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ], false, { fogMode: "disabled", costLimit: 99999, unitCostLimit: 10000 });
      game.tiles.forEach(row => row.fill("plain")); game.deployment = null;
      const [a, b] = game.units;
      Object.assign(a, { x: 5, y: 5, hp: 100000, en: 10000 });
      Object.assign(b, { x: 8, y: 5, hp: 100000, en: 10000 });
      await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({ units: game.units }));
      phase = "idle"; battleView = pending = moving = null; setPageView("game"); update(); byId("quick").checked = false;
      const weapon = Rules.modelOf(a).weapons.find(weapon => weapon.id === weaponId);
      const flight = AutomaticFire.flight(Rules, a, b, weapon);
      const event = { from: a.id, to: b.id, weapon: weapon.id, hit: true,
        damage: 100, before: b.hp, after: b.hp - 100, crossfire: true,
        timelineStart: 0, fireAt: 0, impactAt: flight,
        strikes: weapon.attack.strikes.map((strike, index) => ({
          ...strike, hit: true, damage: 100, executed: index === 0,
        })),
      };
      const battle = { a: a.id, b: b.id, actors: structuredClone([a, b]),
        events: [event], before: { [a.id]: a.hp, [b.id]: b.hp }, crossfire: true, timelineStart: 0 };
      MapCombat.reset(); MapCombat.seed([battle]);
      battleView = { battles: [battle], index: 0, completed: false }; phase = "battle";
      MapCombat.begin(battleView, () => 0);
      const zero = performance.now(), rate = MovementTiming.combatRate(false, false);
      MapCombat.update(zero);
      const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 1000; const context = canvas.getContext("2d"), drawn = [];
      context.drawImage = image => drawn.push(image);
      const geometry = { ox: 0, oy: 0, tile: Rules.mapCellPixels };
      const plan = MapCombat.frames[0].plan, shot = plan.shots[0]; MapCombat.update(zero + (shot.at + shot.flight / 2) * 1000 / rate); MapCombat.draw(context, geometry);
      const flying = drawn.includes(SpriteRenderer.images[weapon.projectile.asset]);
      drawn.length = 0;
      MapCombat.update(zero + (plan.contacts[0].at + 0.05) * 1000 / rate); MapCombat.draw(context, geometry);
      const effects = weapon.hitEffects || [weapon.hitEffect]; const impacted = effects.some(id => drawn.includes(SpriteRenderer.images[ART.effects[id].asset]));
      return { speed: weapon.projectile.speed, flight, flying, impacted };
    }, { unitId, weaponId });
    expect(result.speed).toBe(5.5);
    expect(result.flight).toBeLessThan(1);
    expect(result.flying).toBe(true);
    expect(result.impacted).toBe(true);
    expect(errors).toEqual([]);
  });
}
