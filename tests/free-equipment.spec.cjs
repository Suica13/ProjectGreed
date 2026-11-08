const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const tree=require('../shared/development-tree.json');
for(const width of [1600,390])test('free kit selection, chassis-only production and licensed preview action at '+width,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({tree})=>{
  localStorage.setItem('projectgreed.combatFaction','PMC');
  localStorage.setItem('projectgreed.economy.v1',JSON.stringify({schemaVersion:3,money:1000000,supplies:1000000,
   licenses:{RGM_79:true},inventory:{RGM_79:2},kits:{RGM_79__beam_spray:99}}));
  localStorage.setItem('projectgreed.developmentProgress.v1',JSON.stringify({points:{EFSF:100000,ZEON:100000},claimed:{},
   researched:Object.fromEntries(Object.entries(tree).map(([f,nodes])=>[f,nodes.map(n=>n.id)]))}));
 },{tree});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>ProductionUI.openUnit('RGM_79'));
 await expect(page.locator('#productionScreen')).toBeVisible();
 expect(await page.locator('#buyProductionKit').count()).toBe(0);
 const before=await page.evaluate(()=>({money:Economy.snapshot().money,quote:Economy.productionOffer('RGM_79','bazooka')}));
 await page.locator('#productionKit').selectOption('bazooka');
 expect(await page.evaluate(()=>Economy.snapshot().money)).toBe(before.money);
 await expect(page.locator('#productionPrice')).not.toContainText('套件费');
 await page.locator('#produceUnit').click();
 expect(await page.evaluate(()=>Economy.quantity('RGM_79'))).toBe(3);
 expect(await page.evaluate(()=>Economy.snapshot().money)).toBe(before.money-before.quote.money);
 await page.evaluate(()=>Formation.previewUnit('RGM_79'));
 await expect(page.locator('#producePreviewUnit')).toHaveText('生产');
 expect(await page.locator('#buyPreviewKit').count()).toBe(0);
 await page.locator('#formationDetailKit').selectOption('machine_gun');
 await page.locator('#producePreviewUnit').click();
 expect(await page.evaluate(()=>Economy.quantity('RGM_79'))).toBe(4);
 expect(await page.evaluate(()=>Object.keys(Economy.snapshot().kits).length)).toBe(0);
 await page.screenshot({path:`tmp/verification/screenshots/free-equipment-${width}.png`});
 expect(errors).toEqual([]);
});

test('activity rewards offer chassis counts without independent kit controls',async({page})=>{
 const {createServer}=require('../server');
 const app=createServer({host:'127.0.0.1',port:0}),address=await app.listen();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(`http://127.0.0.1:${address.port}/admin/activities.html`);
  await expect(page.locator('#addChassisStock')).toBeEnabled();
  expect(await page.locator('#addKitStock').count()).toBe(0);
  await page.locator('#title').fill('Free equipment migration');
  await page.locator('#addChassisStock').click();
  await page.locator('#rewardUnitSearch').fill('MS_06F');
  await page.locator('#rewardUnitList [data-unit-id="MS_06F"]').click();
  expect(await page.locator('#rewardBaseKit').count()).toBe(0);
  await page.locator('#rewardChassisCount').fill('3');
  await page.locator('#confirmRewardConfig').click();
  await page.locator('#publish').click();
  await expect(page.locator('#status')).toContainText('活动已发布');
  const event=app.activities.adminSnapshot().activities.at(-1);
  expect(event.rewards.inventory.MS_06F).toBe(3);expect(event.rewards.kits).toBeUndefined();
  expect(errors).toEqual([]);
 } finally {await app.close();}
});
