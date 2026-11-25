const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('Anaheim tokens show independent locks, prices and persistent purchases '+width,async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('采购 PMC');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{I18n.setLanguage('zh');Economy.meetLiaison('anaheim');Economy.creditActivity({id:'token-ui-money',matchId:'token-ui-money',money:100000,supplies:0,inventory:{}});});
 await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();const terminal=page.locator('#merchantTerminal');
 await terminal.getByRole('button',{name:'任务',exact:true}).click();
 for(const id of ['anaheim-token-0079','anaheim-token-thunderbolt','anaheim-token-celestial']){
  await terminal.locator(`[data-task-id="${id}"]`).click();await expect(page.locator('#contactTaskAction')).toBeEnabled();await expect(terminal).toContainText('N5以上');await expect(terminal).toContainText('武装介入');await expect(terminal).toContainText('0079T1');
 }
 await terminal.getByRole('button',{name:'返回',exact:true}).click();await terminal.getByRole('button',{name:'购买',exact:true}).click();
 await expect(terminal.locator('[data-token-id]')).toHaveCount(3);for(const id of ['0079t1-token','thunderbolt-token','celestial-being-token'])await expect(terminal.locator(`[data-token-id="${id}"] button`)).toBeDisabled();
 await page.evaluate(()=>{Economy.acceptContactTask('anaheim-token-0079');Economy.creditAward({id:'token-ui-proof',matchId:'token-ui-proof',money:0,supplies:0,contactProgress:[{id:'anaheim-token-0079',amount:1}]});Economy.completeContactTask('anaheim-token-0079');});
 const card=terminal.locator('[data-token-id="0079t1-token"]');await expect(card).toContainText('10,000');await expect(card.locator('button')).toBeEnabled();await expect(terminal.locator('[data-token-id="thunderbolt-token"]')).toContainText('30,000');
 const before=await page.evaluate(()=>Economy.snapshot().money);await card.locator('button').click();await expect(card).toContainText('持有 1 枚');expect(await page.evaluate(()=>Economy.snapshot().money)).toBe(before-10000);
 await expect(terminal.locator('[data-token-id="thunderbolt-token"] button')).toBeDisabled();
 expect(await terminal.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:`tmp/verification/screenshots/anaheim-tokens-${width}.png`});
 await page.reload();await page.waitForFunction(()=>assetsReady);expect(await page.evaluate(()=>Economy.snapshot().itemInventory['0079t1-token'])).toBe(1);expect(errors).toEqual([]);
});
