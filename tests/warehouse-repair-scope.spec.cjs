const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('repair page scope and condition buttons respect current unit state '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const fixture=await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'repair-scope',matchId:'repair-scope',money:100000,supplies:100000,inventory:{RGM_79:9}});const items=Economy.snapshot().storage.units;
  Economy.creditAward({id:'scope-loss',matchId:'scope-loss',money:0,supplies:0,stockLost:{inventory:{RGM_79:1}},stockLostItems:[{stockId:items[0].id,unitId:'RGM_79'}],stockStates:[{stockId:items[8].id,unitId:'RGM_79',kitId:items[8].kitId,hp:100,en:0}]});return {before:Economy.snapshot(),offPage:items[8].id,first:items[0].id};});
 await page.locator('#shellHangar').click();
 const environments=await page.locator('#warehouseBays [data-slot="1"] .warehouse-environment').evaluateAll(nodes=>nodes.map(node=>({key:node.dataset.environment,text:node.textContent,active:node.classList.contains('is-active')})));
 expect(environments.map(tag=>tag.text)).toEqual(['地面','宇宙']);
 const colors=await page.locator('#warehouseBays [data-slot="1"] .warehouse-environment').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color));expect(colors).toEqual(['rgb(255, 207, 145)','rgb(223, 197, 255)']);
 const expected=await page.evaluate(()=>{const item=Economy.snapshot().storage.units.find(item=>item.slot===1),model=UnitModels[item.unitId+'__'+item.kitId];return ['ground','space'].map(key=>(model.adaptability?.[key]??0)>90);});expect(environments.map(tag=>tag.active)).toEqual(expected);
 await page.locator('#warehouseBays [data-slot="1"] .warehouse-condition').click();await expect(page.locator('#gameDialog')).toContainText('状态良好，无需修复');expect(await page.locator('#gameDialog').getByRole('button',{name:'修复',exact:true}).count()).toBe(0);await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();
 await page.locator('#warehouseRepairAll').click();await page.locator('#gameDialog').getByRole('button',{name:'本页',exact:true}).click();await expect(page.locator('#gameDialog')).toContainText('1台');await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.locator('#warehouseBays [data-slot="0"] .warehouse-condition')).toHaveText('状态良好');
 expect(await page.evaluate(id=>Economy.snapshot().storage.units.find(item=>item.id===id).hp,fixture.offPage)).toBe(100);
 const supplies=await page.evaluate(()=>Economy.snapshot().supplies);await page.locator('#warehouseNext').click();await expect(page.locator('#warehouseBays [data-slot="8"] .warehouse-condition')).toHaveText('需要修理');
 await page.locator('#warehouseBays [data-slot="8"] .warehouse-condition').click();await expect(page.locator('#gameDialog')).toContainText('消耗物资 0');await page.locator('#gameDialog').getByRole('button',{name:'修复',exact:true}).click();
 await expect(page.locator('#warehouseRepairAll')).toBeDisabled();expect(await page.evaluate(()=>Economy.snapshot().supplies)).toBe(supplies);expect(await page.evaluate(()=>Economy.repairQuote().items.length)).toBe(0);expect(errors).toEqual([]);
});
