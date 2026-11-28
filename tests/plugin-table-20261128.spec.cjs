const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`T1 plugin purchases and persistence at ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Parts Test');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  I18n.setLanguage('zh');Economy.meetLiaison('anaheim');
  Economy.creditActivity({id:'parts-test',matchId:'parts-test',money:200000,supplies:0,inventory:{RGM_79:1}});Economy.receiveDeliveries();
  const p=ProfileSave.encodeData();p.economy.merchantAffinities.anaheim=800;
  p.economy.contactTasks=ContactTasks.tasks.filter(t=>t.contactId==='anaheim'&&t.number<=6).map(t=>({id:t.id,status:'claimed',progress:t.required}));
  ProfileSave.importData(p);
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();
 await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();
 const terminal=page.locator('#merchantTerminal');await terminal.getByRole('button',{name:'购买',exact:true}).click();
 await expect(terminal.locator('[data-plugin-id="ambac"]')).toHaveCount(0);
 await expect(terminal.locator('[data-plugin-id="anti_beam_coating"]')).toHaveCount(0);
 for(const id of ['artillery_sight','caseless_ammo','ms_spares','special_explosives','motion_memory']){
  const card=terminal.locator(`[data-plugin-id="${id}"]`);await expect(card).toBeVisible();await expect(card.locator('img')).toHaveJSProperty('complete',true);
  await expect(card.locator('button')).toBeEnabled();
 }
 await terminal.locator('[data-plugin-id="ms_spares"] button').click();
 expect(await page.evaluate(()=>Economy.pluginQuantity('ms_spares'))).toBe(1);
 await page.evaluate(()=>{const u=Economy.snapshot().storage.units[0];Economy.setStoredPlugin(u.id,0,'ms_spares');});
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>Economy.snapshot().storage.units[0].plugins[0])).toBe('ms_spares');
 expect(errors).toEqual([]);
 await page.screenshot({path:`tmp/verification/screenshots/plugin-table-${width}.png`});
});
