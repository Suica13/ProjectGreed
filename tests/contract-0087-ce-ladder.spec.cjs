const {test,expect}=require('@playwright/test');
const {createServer}=require('../server');
for(const width of [1440,390])test(`0087 and CE ten-level selection at ${width}px`,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});
 const app=createServer({port:0}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 try{
 await page.goto(base);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Extended ladders');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(base=>{Net.serverURL=base.replace('http:','ws:')+'/ws';Net.room='LADDERS';byId('newRoomMode').value='sweep';Net.connect('create',true);},base);
 await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
 if(width<700)await page.locator('[data-room-tab="settings"]').click();
 await expect(page.locator('#sweepEra option[value="UC_0087_T2"]')).toHaveCount(0);
 await page.locator('#sweepEra').selectOption('UC_0087_T1');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepEra==='UC_0087_T1'&&!Net.awaiting);
 await expect(page.locator('#sweepDifficulty option')).toHaveCount(10);
 await page.locator('#sweepDifficulty').selectOption('10');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepDifficulty===10&&!Net.awaiting);
 await expect(page.locator('#roomUnitLimit')).toHaveValue('5');
 await page.locator('#sweepEnvironment').selectOption('space');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepEnvironment==='space'&&!Net.awaiting);
 await page.locator('#sweepEra').selectOption('CE_0071_T1');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepEra==='CE_0071_T1'&&!Net.awaiting);
 await expect(page.locator('#sweepEnvironment')).toHaveValue('space');
 await expect(page.locator('#sweepDifficulty option')).toHaveCount(10);
 await page.locator('#sweepDifficulty').selectOption('1');
 await page.waitForFunction(()=>Net.snapshot.settings.sweepDifficulty===1&&!Net.awaiting);
 await expect(page.locator('#roomUnitLimit')).toHaveValue('5');
 expect(await page.evaluate(()=>ContactTasks.tasks.filter(t=>['omni','zaft'].includes(t.contactId)).map(t=>t.difficulty))).toEqual([1,1,2,2,3,3,4,4,5,5,1,1,2,2,3,3,4,4,5,5]);
 }finally{await app.close();}
});
