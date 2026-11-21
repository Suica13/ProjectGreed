const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('base physical warehouse at '+width,async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:960});
 await page.addInitScript(()=>{if(localStorage.getItem('projectgreed.economy.v1')===null)localStorage.setItem('projectgreed.economy.v1',JSON.stringify({schemaVersion:3,money:1000000,supplies:1000000,licenses:{Type61:true},inventory:{Type61:77},kits:{}}));});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>I18n.setLanguage('zh'));
 expect(await page.evaluate(()=>Economy.snapshot().schemaVersion)).toBe(4);
 expect(await page.evaluate(()=>Economy.quantity('Type61'))).toBe(0);
 await expect(page.locator('#shellHangar span')).toHaveText('基地');
 await page.locator('#shellHangar').click();
 await expect(page.locator('#warehouseScreen')).toBeVisible();
 await expect(page.locator('.warehouse-camera,.bay-rack')).toHaveCount(0);
 const scene=await page.locator('#warehouseScreen').boundingBox(),rail=await page.locator('#shellSidebar').boundingBox();
 if(width>720)expect(scene.x).toBeGreaterThanOrEqual(rail.x+rail.width);
 else expect(scene.y).toBeGreaterThanOrEqual(rail.y+rail.height-1);
 await expect(page.locator('.warehouse-bay')).toHaveCount(8);
 await expect(page.locator('#warehousePage')).toHaveText('1 / 3 页');
 await page.locator('#warehouseShips').click();
 await expect(page.locator('.warehouse-bay')).toHaveCount(8);
 await expect(page.locator('#warehouseCapacity')).toHaveText('战舰库存 0 / 9');
 await page.locator('#warehouseUnits').click();
 await expect(page.locator('.warehouse-sidebar')).toHaveCount(0);
 await page.locator('.warehouse-bay').nth(5).click();
 await expect(page.locator('#warehouseDialog')).toBeVisible();
 await expect(page.locator('#warehouseMoveHere')).toBeDisabled();
 await page.locator('#warehouseProduceNew').click();
 await expect(page.locator('#productionScreen')).toBeVisible();
 await page.locator('#productionSearch').fill('Type61');
 await expect(page.locator('#produceUnit')).toBeEnabled();
 await page.locator('#produceUnit').click();
 await page.locator('#productionReturnWarehouse').click();
 await expect(page.locator('#warehouseDialog')).not.toBeVisible();
 expect(await page.evaluate(()=>Economy.snapshot().storage.units[0].slot)).toBe(5);
 await expect(page.locator('.warehouse-bay[data-slot="5"] .warehouse-card-icon')).toBeVisible();
 await page.evaluate(()=>Economy.creditActivity({id:'bay-fixture',matchId:'bay-fixture',money:0,supplies:0,inventory:{RGM_79:3,MS_06F:2,Medea:1}}));
 await expect(page.locator('.warehouse-card-icon')).toHaveCount(6);
 await page.evaluate(()=>{
   const items=Economy.snapshot().storage.units,damaged=items.find(item=>item.unitId==='Type61'),lost=items.find(item=>item.unitId==='RGM_79'),
     model=UnitModels[damaged.unitId+'__'+damaged.kitId];
   Economy.creditAward({id:'card-damage',matchId:'card-test',money:0,supplies:0,
     stockLost:{inventory:{RGM_79:1}},stockLostItems:[{stockId:lost.id,unitId:lost.unitId}],
     stockStates:[{stockId:damaged.id,unitId:damaged.unitId,kitId:damaged.kitId,hp:model.hp/2,en:0,brokenParts:{leftArm:true}}]});
 });
 await expect(page.locator('.warehouse-condition.destroyed')).toHaveText('完全损毁');
 await expect(page.locator('.warehouse-condition.damaged')).toHaveText('需要修理');
 await expect(page.locator('.warehouse-bay[data-slot="5"] [role=meter][aria-label=EN]')).toHaveAttribute('aria-valuenow','0');
 await page.locator('.warehouse-bay[data-slot="5"]').click();
 await expect(page.locator('#warehouseDialog select')).toBeVisible();
 await page.locator('#warehouseClose').click();
 await page.locator('#warehouseYard').evaluate(node=>node.scrollTop=0);
 if(width>1000){
   const yard=await page.locator('#warehouseYard').boundingBox(),last=await page.locator('.warehouse-bay').last().boundingBox();
   expect(last.y+last.height).toBeLessThanOrEqual(yard.y+yard.height);
 }
 await page.screenshot({path:`tmp/verification/screenshots/base-warehouse-${width}.png`});
 const card=page.locator('.warehouse-bay').filter({has:page.locator('.warehouse-card-icon')}).first();
 await expect(card.locator('.warehouse-card-heading .cost')).toContainText('COST');
 const heading=card.locator('.warehouse-card-heading');
 const number=await heading.locator('.bay-number').boundingBox(),name=await heading.locator('.bay-unit-name').boundingBox();
 expect(Math.abs(number.y-name.y)).toBeLessThan(2);
 expect(await heading.locator('.bay-number').evaluate(n=>getComputedStyle(n).fontSize))
   .toBe(await heading.locator('.cost').evaluate(n=>getComputedStyle(n).fontSize));
 await expect(card.locator('.warehouse-card-tags > .era-tag')).toBeVisible();
 await expect(card.locator('[role=meter]')).toHaveCount(2);
 await expect(page.locator('.warehouse-condition.healthy').first()).toHaveText('状态良好');
 await page.evaluate(()=>{
   const prefab=Rules.catalog.prefabs.filter(p=>{
     const model=UnitModels[p.id+'__'+Economy.defaultKit(p.id)];
     return model&&!model.formOnly&&!model.facility&&!model.wip&&Warehouse.category(model)==='units';
   }).sort((a,b)=>b.name.length-a.name.length)[0];
   Economy.creditActivity({id:'long-name-fixture',matchId:'long-name-fixture',money:0,supplies:0,inventory:{[prefab.id]:1}});
 });
 await expect(page.locator('.bay-unit-name.is-scrolling').first()).toBeVisible();
 await expect(card.locator('.warehouse-card-pilot img')).toBeVisible();
 const moved=await page.evaluate(()=>{
   const item=Economy.snapshot().storage.units.find(item=>item.unitId==='Type61');
   Economy.moveStoredUnit(item.id,8);return item;
 });
 await page.locator('.warehouse-bay[data-slot="5"]').click();
 await page.locator('#warehouseMoveHere').click();
 await page.locator('#warehouseMovePage').selectOption('1');
 await expect(page.locator('.warehouse-move-choice')).toHaveCount(1);
 await page.locator('.warehouse-move-choice').click();
 expect(await page.evaluate(id=>Economy.snapshot().storage.units.find(item=>item.id===id),moved.id)).toEqual(moved);
 await expect(page.locator('.warehouse-bay[data-slot="5"] .warehouse-card-icon')).toBeVisible();
 await page.locator('#warehouseShips').click();
 await expect(page.locator('.warehouse-card-icon')).toHaveCount(1);
 await page.locator('#warehouseNext').click();
 await expect(page.locator('.warehouse-bay')).toHaveCount(1);
 await expect(page.locator('#warehousePage')).toContainText('2 / 2');
 await page.locator('#warehousePrevious').click();
 await page.screenshot({path:`tmp/verification/screenshots/base-dock-${width}.png`});
 await page.locator('#shellProduction').click();
 await expect(page.locator('#productionScreen')).toBeVisible();
 expect(await page.locator('option[value=campaign],option[value=dominion]').count()).toBe(0);
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(()=>Economy.quantity('Type61'))).toBe(1);
 expect(await page.evaluate(()=>Economy.snapshot().storage.ships.length)).toBe(1);
 expect(errors).toEqual([]);
});
