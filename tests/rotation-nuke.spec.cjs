const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('ship rotation exposes confirm/cancel and nuclear area damage renders a single launch',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(async()=>{
  I18n.setLanguage('zh');Net.leave();TurnFlow.reset();session++;MapCombat.reset();AttackControls.reset();
  const e={unitId:'RGM_79',kitId:'machine_gun'};
  game=Rules.create(false,73,[[e],[e,e]],false,{costLimit:99999,unitCostLimit:99999});
  game.tiles.forEach(r=>r.fill('plain'));game.fogMode='disabled';
  const [u,b,c]=game.units;u.model='SalamisClass__standard';Object.assign(u,{x:10,y:10,angle:0,hp:Rules.modelOf(u).hp,en:Rules.modelOf(u).en});Object.assign(b,{x:20,y:20});Object.assign(c,{x:22,y:20});
  await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
  selected=u.id;weaponId=pending=battleView=moving=null;mode='select';phase='idle';setPageView('game');update();MapCamera.focus(10,10);
 });
 await page.locator('[data-ship-turn="1"]').click();
 await expect(page.locator('#hudConfirmMove')).toBeVisible();
 expect(await page.evaluate(()=>game.units[0].angle)).toBe(0);
 await page.locator('#hudCancelAction').click();
 expect(await page.evaluate(()=>!!game.units[0].pendingMove)).toBe(false);
 await page.locator('[data-ship-turn="1"]').click();
 await page.locator('#hudConfirmMove').click();
 expect(await page.evaluate(()=>game.units[0].angle)).toBe(90);
 const result=await page.evaluate(async()=>{
  const [a,b,c]=game.units;a.model='MS_06C__standard';a.hp=100000;a.en=350;
  await SpriteRenderer.ensureModels([a.model]);
  const w=Rules.modelOf(a).weapons.find(w=>w.special?.type==='nuke');
  const battles=[b,c].map((u,i)=>({id:'blast'+i,a:a.id,b:u.id,actors:[structuredClone(a),structuredClone(u)],before:{[a.id]:a.hp,[u.id]:u.hp},events:[{from:a.id,to:u.id,weapon:w.id,impactCell:{x:20,y:20},hit:true,before:100000,after:70000,energySpent:i?0:350}]}));
  MapCombat.reset();MapCombat.seed(battles);battleView={battles};MapCombat.begin(battleView,()=>0);MapCombat.update(performance.now());
  const frames=MapCombat.frames;
  return {count:frames.length,visible:frames.filter(f=>!f.event.nuclearFollowup).length,shots:frames[0].plan.shots.length,points:frames.map(f=>f.plan.blastPoint),silent:frames[1].plan.cues.length};
 });
 expect(result.count).toBe(2);expect(result.visible).toBe(1);expect(result.shots).toBe(1);expect(result.points[0]).toEqual(result.points[1]);expect(result.silent).toBe(0);expect(errors).toEqual([]);
});
test('deployment forms load their art, show transform commands, and disable movement',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const results=await page.evaluate(async()=>{
  Net.leave();TurnFlow.reset();session++;MapCombat.reset();AttackControls.reset();
  const e={unitId:'RGM_79',kitId:'machine_gun'};const results=[];
  for(const prefab of ART.prefabs.filter(p=>!p.formOnly&&p.skills?.some(s=>s.deploymentMode))){
   game=Rules.create(false,73,[[{unitId:prefab.id,kitId:prefab.weaponKits[0].id}],[e]],false,{costLimit:99999,unitCostLimit:99999});game.tiles.forEach(r=>r.fill('plain'));game.fogMode='disabled';
   const u=game.units[0];Object.assign(u,{x:10,y:10});Object.assign(game.units[1],{x:25,y:20});Rules.useSkill(game,u,'EnterDeployMode',u.x,u.y);Rules.end(game);Rules.end(game);
   await SpriteRenderer.ensureModels(game.units.map(u=>u.model));selected=u.id;weaponId=pending=battleView=moving=null;mode='select';phase='idle';setPageView('game');update();MapCamera.focus(10,10);drawMap(performance.now());
   results.push({id:prefab.id,move:Rules.modelOf(u,game).move,canExit:Rules.canUseSkill(game,u,'ExitDeployMode')});
  }return results;
 });expect(results).toHaveLength(9);expect(results.every(r=>r.move===0&&r.canExit)).toBe(true);expect(errors).toEqual([]);
});
