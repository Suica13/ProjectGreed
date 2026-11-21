const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('production has permit status only and produces default equipment '+width,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{I18n.setLanguage('zh');Development.allows=()=>false;Economy.creditActivity({id:'production-wallet',matchId:'production-wallet',money:1000000,supplies:1000000,inventory:{}});ProductionUI.openUnit('RX_78_2');});
  await expect(page.locator('#productionKit,#productionBaseKitName,#productionQuantity,#purchaseProductionLicense,#productionLicensePrice')).toHaveCount(0);
  await expect(page.locator('#productionScreen')).not.toContainText('未开发');await expect(page.locator('#productionScreen')).not.toContainText('机体库存');
  await expect(page.locator('#productionList [data-unit-id="RX_78_2"] .unit-portrait-status')).toHaveText('未许可');
  await expect(page.locator('#productionLicenseStatus')).toBeVisible();await expect(page.locator('#produceUnit')).toBeDisabled();
  const before=await page.evaluate(()=>Economy.snapshot());
  const kit=await page.evaluate(()=>{Economy.creditActivity({id:'test-permit',matchId:'test-permit',money:0,supplies:0,licenses:{RX_78_2:true},inventory:{}});ProductionUI.render();return Economy.defaultKit('RX_78_2');});
  await expect(page.locator('#productionLicenseStatus')).toBeHidden();await expect(page.locator('#produceUnit')).toBeEnabled();
  await expect(page.locator('#productionList [data-unit-id="RX_78_2"] .unit-portrait-status')).toHaveCount(0);await page.locator('#produceUnit').click();
  const after=await page.evaluate(()=>Economy.snapshot());expect(after.storage.units.filter(item=>item.unitId==='RX_78_2')).toHaveLength(1);
  expect(after.storage.units.find(item=>item.unitId==='RX_78_2').kitId).toBe(kit);expect(after.money).toBeLessThan(before.money);
  await page.screenshot({path:`tmp/verification/screenshots/production-default-${width}.png`});
  await page.locator('#productionSearch').fill('no-matching-unit');await expect(page.locator('#produceUnit')).toBeDisabled();
  expect(errors).toEqual([]);
});
