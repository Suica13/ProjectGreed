const {test,expect}=require('@playwright/test');
const {createServer}=require('../server');
test('room exposes one 0079 ladder with N1 through N10 and space access',async({page})=>{
 test.setTimeout(90000);const app=createServer({port:0}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 try{
 await page.goto(base);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Unified 0079');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(base=>{Net.serverURL=base.replace('http:','ws:')+'/ws';Net.room='UNIFIED';byId('newRoomMode').value='sweep';Net.connect('create',true);},base);
 await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
 await expect(page.locator('#sweepEra option[value="UC_0079_T1"]')).toHaveText('0079');
 await expect(page.locator('#sweepEra option[value="UC_0079_T2"]')).toHaveCount(0);
 await expect(page.locator('#sweepDifficulty option')).toHaveCount(10);
 await page.locator('#sweepDifficulty').selectOption('10');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepDifficulty===10&&!Net.awaiting);
 expect(await page.evaluate(()=>Rules.fleetLimit(Net.snapshot.settings))).toBe(5);
 await page.locator('#sweepEnvironment').selectOption('space');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepEnvironment==='space'&&!Net.awaiting);
 await page.locator('#sweepDifficulty').selectOption('1');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepDifficulty===1&&!Net.awaiting);
 expect(await page.evaluate(()=>Rules.fleetLimit(Net.snapshot.settings))).toBe(5);
 }finally{await app.close();}
});
