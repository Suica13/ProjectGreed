const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
const {createServer}=require('../server.js');
test('licensed undeveloped units have no research warning in squad, picker or production',async({page})=>{
 const c=require('../shared/production-catalog.json'),kit=c.defaultKits.RX_78_2;
 await page.addInitScript(kit=>{
  localStorage.setItem('projectgreed.combatFaction','PMC');
  localStorage.setItem('projectgreed.economy.v1',JSON.stringify({schemaVersion:2,money:5000,supplies:10000,licenses:{RX_78_2:true},claimed:{}}));
  localStorage.setItem('slg-formations-v1.PMC',JSON.stringify({version:3,squads:[{name:'Licensed',units:[{unitId:'RX_78_2',kitId:kit}]}]}));
 },kit);
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>Development.allows('PMC','RX_78_2'))).toBe(false);
 expect(await page.evaluate(()=>Economy.hasLicense('RX_78_2'))).toBe(true);
 await page.locator('#shellHangar').click();
 await expect(page.locator('.formation-row')).toHaveCount(1);
 await expect(page.locator('.formation-row .unit-undeveloped')).toHaveCount(0);
 await page.locator('#openFormationPicker').click();await page.locator('#formationSearch').fill('RX_78_2');
 await expect(page.locator('[data-unit-id="RX_78_2"] .unit-undeveloped')).toHaveCount(0);
 await page.locator('#closeFormationPicker').click();
 await page.evaluate(()=>ProductionUI.openUnit('RX_78_2'));
 await expect(page.locator('#productionList [data-unit-id="RX_78_2"] .unit-portrait-status')).toHaveCount(0);
 await expect(page.locator('#produceUnit')).toBeDisabled();
});
test('development and license rewards grant independently and retain separate progress',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(()=>{
  const award=(id,more)=>({id,matchId:'split-mail',money:0,supplies:0,...more});
  Development.receiveActivity(award('research-only',{unlockUnits:['RX_78_2']}));
  Development.receiveActivity(award('license-only',{licenses:{MS_14A:true}}));
  return {developed:Development.allows('PMC','RX_78_2'),researchLicense:Economy.hasLicense('RX_78_2'),licensed:Economy.hasLicense('MS_14A'),licenseResearch:Development.allows('PMC','MS_14A')};
 });
 expect(result).toEqual({developed:true,researchLicense:false,licensed:true,licenseResearch:false});
});
test('admin publishes separate reward types and can cancel or clear all activities',async({page})=>{
 const app=createServer({host:'127.0.0.1',port:0}),addr=await app.listen();
 try{
  await page.goto(`http://127.0.0.1:${addr.port}/admin/activities.html`);
  await expect(page.locator('#activities button')).toHaveCount(5);
  await page.locator('#clearAllActivities').click();await page.locator('#cancelDelete').click();
  expect(app.activities.adminSnapshot().activities.length).toBe(5);
  await page.locator('#newActivity').click();await page.locator('#title').fill('Separate rewards');await page.locator('#body').fill('Test');
  await page.locator('#addUnit').click();await page.locator('#licenseRewards select').selectOption('MS_14A');
  await page.locator('#addUnlock').click();await page.locator('#unlocks select').selectOption('RX_78_2');
  await page.locator('#publish').click();
  await expect.poll(()=>app.activities.adminSnapshot().activities.length).toBe(6);
  const reward=app.activities.adminSnapshot().activities.at(-1).rewards;
  expect(reward.licenses).toEqual({MS_14A:true});expect(reward.unlockUnits).toEqual(['RX_78_2']);
  await page.locator('#clearAllActivities').click();await page.locator('#confirmDelete').click();
  await expect(page.locator('#activities button')).toHaveCount(0);
  expect(app.activities.adminSnapshot().activities).toEqual([]);
 }finally{await app.close();}
});
