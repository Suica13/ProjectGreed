const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('pilot help describes the revised gains and weapon cards show effective mobility rounds',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const result=await page.evaluate(()=>{
  byId('openPilotAttributeHelp').click();
  const help=byId('pilotAttributeHelp').textContent;
  const e={unitId:'RGM_79',kitId:'machine_gun'};
  game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
  const u=game.units[0],model=Rules.models[u.model];
  Rules.models['mobility-preview-test']={...model,speed:160};u.model='mobility-preview-test';
  u.pilot={stats:{...Rules.pilots.baseStats(),speed:200}};
  const w=Rules.modelOf(u).weapons[0];
  const card=WeaponInfo.card(w,null,{unit:u});
  return {help,rounds:Rules.attackRounds(game,u,w),card:card.textContent};
 });
 await expect(page.locator('#pilotAttributeHelp')).toBeVisible();
 expect(result.help).toContain('131.25%');expect(result.help).toContain('162.5%');
 expect(result.help).toContain('10个百分点');expect(result.help).not.toContain('AP倍率');
 expect(result.rounds).toBe(4);expect(result.card).toMatch(/攻击轮数\s*4/);
});
