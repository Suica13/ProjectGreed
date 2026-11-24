const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
test('CE liaison cards restore claimed affinity and retain it after saving and reloading',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('CE Affinity');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  const s=Economy.snapshot();s.contactTasks=[{id:'efsf-11',status:'claimed'},{id:'omni-1',status:'claimed'},{id:'omni-2',status:'claimed'},{id:'zaft-1',status:'claimed'}];
  s.merchantAffinities={...s.merchantAffinities,omni:0,zaft:0};localStorage.setItem('projectgreed.economy.v1',SaveCodec.stringify(s));
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>I18n.setLanguage('zh'));await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();
 await expect(page.locator('[data-merchant-id="omni"] .merchant-information')).toContainText('200.0');
 await expect(page.locator('[data-merchant-id="zaft"] .merchant-information')).toContainText('100.0');
 expect(await page.evaluate(()=>SaveCodec.parse(localStorage.getItem('projectgreed.economy.v1')).merchantAffinities.omni)).toBe(200);
 await page.evaluate(()=>Economy.creditActivity({id:'ce-affinity-save',matchId:'ce-affinity-save',money:25,supplies:0,inventory:{}}));
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>[Economy.merchantAffinity('omni'),Economy.merchantAffinity('zaft')])).toEqual([200,100]);
});
