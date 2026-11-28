const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`T1 tank loan can be accepted before T2 at ${width}px`,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('试验 PMC');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{I18n.setLanguage('zh');const p=ProfileSave.encodeData();p.economy.merchantIntros.anaheim=true;p.economy.contactTasks=ContactTasks.tasks.filter(t=>t.contactId==='anaheim'&&t.number<=6).map(t=>({id:t.id,status:'claimed',progress:t.required}));ProfileSave.importData(p);});
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();
 const terminal=page.locator('#merchantTerminal');await terminal.getByRole('button',{name:'任务',exact:true}).click();await terminal.locator('[data-task-id="anaheim-8"]').click();
 await expect(terminal).toContainText('强袭型钢坦克');await expect(terminal).toContainText('0079T1');await expect(terminal).toContainText('20台吉翁军MS');
 await expect(page.locator('#contactTaskAction')).toBeEnabled();await page.locator('#contactTaskAction').click();
 await expect.poll(()=>page.evaluate(()=>Economy.snapshot().storage.units.some(u=>u.contactLoan==='anaheim-8'&&u.unitId==='RTX_440'))).toBe(true);
 await page.screenshot({path:`tmp/verification/screenshots/anaheim-trial-${width}.png`});await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>Economy.snapshot().storage.units.filter(u=>u.contactLoan==='anaheim-8').map(u=>u.unitId))).toEqual(['RTX_440']);expect(errors).toEqual([]);
});
