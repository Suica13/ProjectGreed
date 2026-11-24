const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('transform and purge buttons keep movement and attacks available',async({page})=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Form Actions');await page.locator('#profileOnboardingConfirm').click();
 for(const [id,type]of [['GN_003','transform'],['MS_06R_TB','transform'],['FA_78_1_TB','armor_purge']]){
  const selectedSkill=await page.evaluate(async({id,type})=>{
   Net.leave();session++;SkillControls.reset();
   const m=Object.values(Rules.models).find(m=>m.prefabId===id);
   game=Rules.create(false,1,[[{unitId:id,kitId:m.kitId}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999});
   game.deployment=null;game.tiles.forEach(r=>r.fill('plain'));
   Object.assign(game.units[0],{x:8,y:8});Object.assign(game.units[1],{x:9,y:8});
   const skill=Rules.unitSkills(game.units[0]).find(s=>s.type===type);
   await SpriteRenderer.ensureModels([m.id,skill.source.unitId+'__default']);
   selected=game.units[0].id;phase='idle';mode='select';setPageView('game');update();BattleHUD.setTab('skills');
   return {id:skill.id,target:skill.source.unitId};
  },{id,type});
  const button=page.locator(`[data-unit-skill="${selectedSkill.id}"]`);await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>page.evaluate(()=>Rules.modelOf(game.units[0]).prefabId)).toBe(selectedSkill.target);
  expect(await page.evaluate(()=>{
   const u=game.units[0],enemy=game.units[1];return {acted:u.acted,moved:u.moved,canMove:Rules.reachable(game,u).size>1,canAttack:Rules.modelOf(u).weapons.some(w=>Rules.canAttack(game,u,enemy,w))};
  })).toEqual({acted:false,moved:false,canMove:true,canAttack:true});
 }
 expect(errors).toEqual([]);
});
