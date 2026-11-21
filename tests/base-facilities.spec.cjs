const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('facility cards, slot capacity and locked upgrade dialog '+width,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:960});await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>I18n.setLanguage('zh'));
 await page.locator('#shellHangar').click();await page.locator('#shellFacilities').click();
 await expect(page.locator('#baseFacilitiesScreen')).toBeVisible();await expect(page.locator('#facilityCards .facility-card')).toHaveCount(8);
 await expect(page.locator('#facilityCards [data-facility]')).toHaveCount(5);
 await expect(page.locator('#facilitySummary')).toContainText('单位 16 格 · 舰船 3 格');
 const before=await page.evaluate(()=>JSON.stringify(Economy.snapshot()));
 await page.locator('[data-facility-upgrade=factory]').click();await expect(page.locator('#facilityDialogBody')).toContainText('开发中');
 await expect(page.locator('.facility-cost dd')).toHaveText(['开发中','-','-']);await expect(page.locator('#confirmFacilityUpgrade')).toBeDisabled();
 await page.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify(Economy.snapshot()))).toBe(before);
 await page.locator('[data-facility-info=giantFactory]').click();await expect(page.locator('.facility-unlock')).toHaveCount(5);await expect(page.locator('.facility-unlock').last()).toContainText('15');await page.locator('#closeFacilityDialog').click();
 await page.screenshot({path:`tmp/verification/screenshots/facility-cards-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
});
test('standalone save editor loads facility-aware storage',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.resolve('admin/save-editor.html')).href);
 await expect(page.locator('#openSave')).toHaveCount(1);await expect(page.locator('#status')).toBeVisible();expect(errors).toEqual([]);
});
