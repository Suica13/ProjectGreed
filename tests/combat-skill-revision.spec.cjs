const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
async function open(page){
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await expect(page.locator("#openSkirmish")).toBeEnabled();
 await page.evaluate(async()=>{
  Net.leave();session++;const e={unitId:"RGM_79",kitId:"machine_gun"};
  game=Rules.create(false,1,[[e],[e]],false,{fogMode:"disabled"});game.tiles.forEach(r=>r.fill("plain"));game.deployment=null;
  game.units.forEach((u,i)=>Object.assign(u,{x:5+i,y:5,hp:1000000,en:100000}));
  await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:game.units}));
  phase="idle";pending=moving=battleView=null;selected=game.units[0].id;mode="select";
  setPageView("game");update();
 });
}
test("unit loadout shows every weapon, hides AP, and attack/response share nonduplicate summaries",async({page})=>{
 await open(page);
 const count=await page.evaluate(()=>Rules.modelOf(game.units[0]).weapons.length);
 await expect(page.locator("[data-full-loadout] > .weapon-card")).toHaveCount(count);
 await expect(page.locator(".weapon-ap-cost")).toHaveCount(0);
 await page.evaluate(()=>{AttackControls.choose(game.units[0],game.units[1]);update();BattleHUD.setTab("weapons");});
 const attack=page.locator("#attackEditor .weapon-card").first();
 await expect(attack.locator(".weapon-damage-formula")).toBeVisible();
 await expect(attack.locator(".weapon-rounds")).toHaveCount(1);
 await expect(attack.locator(".weapon-attributes")).toBeVisible();
 await expect(attack.locator(".weapon-name")).not.toContainText("次");
 await page.locator("#confirmAttackQueue").click();
 const response=page.locator("#counterList .weapon-card").first();
 await expect(response.locator(".weapon-damage-formula")).toBeVisible();
 await expect(response.locator(".weapon-rounds")).toHaveCount(1);
 await expect(response.locator(".weapon-ap-cost")).toHaveCount(0);
});
test("mortar skill targets and cancels separately from the ordinary automatic attack",async({page})=>{
 await open(page);
 const id=await page.evaluate(async()=>{
  const a=game.units[0],key=Object.keys(Rules.models).find(id=>Rules.models[id].prefabId==="RX_77_2"&&Rules.models[id].weapons.some(w=>WeaponClasses.classify(w)==="mortar"));
  a.model=key;Object.assign(game.units[1],{x:8,y:5});await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:game.units}));
  update();BattleHUD.setTab("skills");return Rules.modelOf(a).weapons.find(w=>WeaponClasses.classify(w)==="mortar").id;
 });
 await page.locator(`[data-weapon-skill="${id}"]`).click();
 expect(await page.evaluate(()=>mode)).toBe("target");
 await expect(page.locator("#hudCancelAction")).toBeVisible();await page.locator("#hudCancelAction").click();
 expect(await page.evaluate(()=>mode)).toBe("select");
 await page.locator(`[data-weapon-skill="${id}"]`).click();
 const point=await page.evaluate(()=>{
  MapCamera.focus(8,5);drawMap(performance.now());
  const p=mapPosition(8,5),c=byId("map"),r=c.getBoundingClientRect();
  return {x:p.x*r.width/c.width,y:p.y*r.height/c.height};
 });
 await page.locator("#map").click({position:point,force:true});
 expect(await page.evaluate(()=>pending.offensiveSkill)).toBe(true);
 await page.evaluate(()=>{response="defend";counterDraftState=null;commitAttack();});
 expect(await page.evaluate(()=>game.units[0].attackSkillRound===game.round)).toBe(true);
});
test("a firing unit keeps facing its own target during simultaneous incoming fire",async({page})=>{
 await open(page);
 const result=await page.evaluate(()=>{
  const [a,b]=game.units,c={...structuredClone(b),id:"south",x:5,y:6};game.units.push(c);
  const weapon=Rules.modelOf(a).weapons[0];
  const battles=[[a,b,0],[c,a,.1]].map(([from,to,time])=>({a:from.id,b:to.id,actors:structuredClone([from,to]),before:{[from.id]:from.hp,[to.id]:to.hp},crossfire:true,timelineStart:time,
    events:[{from:from.id,to:to.id,weapon:weapon.id,hit:false,damage:0,before:to.hp,after:to.hp,crossfire:true,timelineStart:time,fireAt:time,impactAt:time+1,
      strikes:weapon.attack.strikes.map((s,i)=>({...s,hit:false,damage:0,executed:i===0}))}]}));
  MapCombat.reset();MapCombat.seed(battles);battleView={battles,index:0,completed:false};phase="battle";MapCombat.begin(battleView,()=>0);
  const zero=performance.now(),rate=MovementTiming.combatRate(false,false);MapCombat.update(zero);MapCombat.update(zero+200/rate);
  return {angle:MapCombat.units().find(u=>u.id===a.id).mapPose.angle,source:MapCombat.frames.find(f=>f.event.from===a.id).source.angle};
 });
 expect(result.angle).toBe(90);expect(result.source).toBe(90);
});
