const {test,expect}=require('@playwright/test');
const {createServer}=require('../server');
for(const width of [1440,390])test(`rental activity setup and locked preset equipment at ${width}px`,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});
 const app=createServer({port:0}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(base+'/admin/activities.html');await expect(page.locator('#activities button').first()).toBeVisible();
  await page.locator('#title').fill('Rental test');await page.locator('#addRentalStock').click();
  await page.locator('#rewardUnitSearch').fill('RGM_79');await page.locator('#rewardUnitList [data-unit-id="RGM_79"]').click();
  await expect(page.locator('#rentalConfig')).toBeVisible();await page.locator('#rewardChassisCount').fill('1');await page.locator('#rewardRentalUses').fill('3');
  await page.locator('#rewardRentalKit').selectOption('beam_spray');await page.locator('#rewardRentalPlugins select').first().selectOption('frame');
  await page.locator('#confirmRewardConfig').click();await expect(page.locator('#rentalRewards')).toContainText('剩余次数:3次');
  await page.locator('#publish').click();await expect(page.locator('#status')).toContainText('活动已发布');
  const event=app.activities.adminSnapshot().activities.at(-1);expect(event.rewards.rentals[0]).toMatchObject({unitId:'RGM_79',kitId:'beam_spray',count:1,uses:3,plugins:['frame',null,null,null]});
  await page.reload();await page.locator('#activities button').filter({hasText:'Rental test'}).click();
  await expect(page.locator('#rentalRewards')).toContainText('剩余次数:3次');
  await page.locator('#rentalRewards button').filter({hasText:'编辑'}).click();await expect(page.locator('#rewardRentalUses')).toHaveValue('3');await expect(page.locator('#rewardRentalPlugins select').first()).toHaveValue('frame');
  await page.goto(base);await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('Rental PMC');await page.locator('#profileOnboardingConfirm').click();
  const id=await page.evaluate(rewards=>{
    I18n.setLanguage('zh');Economy.creditActivity({id:'rental-test',matchId:'rental-test',...rewards});
    const item=Economy.snapshot().storage.units.find(item=>item.rentalUses);WarehouseUI.open();WarehouseUI.openItem(item.id);return item.id;
  },event.rewards);
  await expect(page.locator('#warehouseDialog .warehouse-condition')).toHaveText('剩余次数:3次');
  await expect(page.locator('#warehouseAssignPilot')).toBeEnabled();await expect(page.locator('#warehouseSellUnit')).toBeDisabled();
  expect(await page.locator('#warehouseDialog [data-plugin-slot]').evaluateAll(nodes=>nodes.length===4&&nodes.every(node=>node.disabled))).toBe(true);
  await page.locator('#warehouseClose').click();
  await page.evaluate(id=>{
    Economy.setStoredPilot(id,'rental-pilot');
    const item=Economy.snapshot().storage.units.find(item=>item.id===id);
    Economy.creditAward({id:'rental-battle',matchId:'rental-battle',kind:'result',money:0,supplies:0,settledStockIds:[id],stockStates:[{stockId:id,unitId:item.unitId,kitId:item.kitId,hp:1,en:0,brokenParts:{head:true}}]});
    WarehouseUI.openItem(id);
  },id);
  await expect(page.locator('#warehouseDialog .warehouse-condition')).toHaveText('剩余次数:2次');
  expect(await page.evaluate(id=>{const item=Economy.snapshot().storage.units.find(item=>item.id===id);return {hp:item.hp,en:item.en,broken:item.brokenParts,quote:Economy.repairQuote([id]).items.length};},id)).toMatchObject({broken:{},quote:0});
  await page.locator('#warehouseClose').click();await page.reload();await page.waitForFunction(()=>assetsReady);
  await page.evaluate(id=>{WarehouseUI.open();WarehouseUI.openItem(id);},id);await expect(page.locator('#warehouseDialog .warehouse-condition')).toHaveText('剩余次数:2次');
  expect(errors).toEqual([]);
 }finally{await app.close();}
});
