const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('squad descriptions, depot rental removal and talent reroll UI '+width,async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('小队 PMC');await page.locator('#profileOnboardingConfirm').click();
 const initial=await page.evaluate(()=>{
  I18n.setLanguage('zh');Economy.creditActivity({id:'service-ui',matchId:'service-ui',money:100000,supplies:100000,inventory:{RGM_79:3}});
  const profile=ProfileSave.encodeData();profile.economy.contactTasks=[{id:'anaheim-11',status:'claimed',progress:1}];
  profile.economy.storage.deliveries[0].rentalUses=5;profile.economy.storage.deliveries[1].rentalUses=3;
  ProfileSave.importData(profile);
  const pilot=PilotSystem.custom({...PilotSystem.createCustom('custom-service-ui','天赋测试'),level:4});
  localStorage.setItem('projectgreed.custom-pilots.v3.shared',JSON.stringify({pilots:[pilot],awards:[]}));
  return {supplies:Economy.snapshot().supplies,talents:pilot.talents};
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);await page.locator('#shellHangar').click();
 await expect(page.locator('#warehouseSquadBonuses')).toBeVisible();
 const layout=await page.locator('#warehouseSquadBonuses').evaluate(node=>{const r=node.getBoundingClientRect(),n=byId('warehouseNext').getBoundingClientRect();return {right:r.right,after:r.x>=n.right,scroll:document.documentElement.scrollWidth};});
 expect(layout.right).toBeLessThanOrEqual(width);expect(layout.after).toBe(true);expect(layout.scroll).toBeLessThanOrEqual(width);
 await page.locator('#warehouseSquadBonuses').click();await expect(page.locator('.warehouse-bonus-row')).toHaveCount(6);await expect(page.locator('#warehouseDialogBody')).toContainText('主射击武器');await page.locator('#warehouseClose').click();
 await page.locator('#warehouseDeliveries').click();await page.locator('#warehouseDiscardRentals').click();await expect(page.locator('#gameDialog')).toContainText('2台');await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.locator('.warehouse-delivery-card')).toHaveCount(1);await expect(page.locator('#warehouseDiscardRentals')).toBeDisabled();await page.locator('#warehouseClose').click();
 await page.locator('#shellPilots').click();await page.locator('.dorm-card[data-pilot-id="custom-service-ui"]').click();
 await expect(page.locator('#resetPilotTalents')).toBeEnabled();await expect(page.locator('#resetPilotTalents')).toContainText('4000');
 const bounds=await page.locator('#resetPilotTalents').evaluate(node=>({top:node.getBoundingClientRect().top,bottom:byId('resetPilotTraining').getBoundingClientRect().bottom}));expect(bounds.top).toBeGreaterThanOrEqual(bounds.bottom);
 await page.locator('#resetPilotTalents').click();await page.locator('#gameDialog').getByRole('button',{name:'重置',exact:true}).click();
 expect(await page.evaluate(()=>Economy.snapshot().supplies)).toBe(initial.supplies-4000);
 const pilot=await page.evaluate(()=>JSON.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots[0]);expect(pilot.level).toBe(4);expect(pilot.talents).toHaveLength(1);expect(initial.talents).not.toContain(pilot.talents[0]);
 await page.screenshot({path:`tmp/verification/screenshots/facility-services-${width}.png`});expect(errors).toEqual([]);
});
