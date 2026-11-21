const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('formation picker sorts physical stock and opens details through portraits '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const stock=await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'picker-order',matchId:'picker-order',money:0,supplies:0,inventory:{RGM_79:1,Type61:1,MS_07B:1}});const first=Economy.snapshot().storage.units[0];Economy.moveStoredUnit(first.id,7);return Economy.snapshot().storage.units.map(item=>({...item,cost:UnitModels[item.unitId+'__'+item.kitId].cost,name:UnitModels[item.unitId+'__'+item.kitId].name}));});
 const physical=stock.slice().sort((a,b)=>a.slot-b.slot),index=new Map(physical.map((item,i)=>[item.id,i]));
 await page.locator('#shellHangar').click();await page.locator('#shellFormation').click();await page.locator('#formationEditorStyle').selectOption('free');await page.locator('#openFormationPicker').click();
 const rows=page.locator('#formationCatalog .catalog-unit');const ids=()=>rows.evaluateAll(nodes=>nodes.map(node=>node.dataset.stockId));
 await expect(page.locator('#formationSort')).toHaveValue('storage');expect(await ids()).toEqual(physical.map(item=>item.id));
 for(const rule of ['cost','name','storage']){
  await page.locator('#formationSort').selectOption(rule);
  const expected=physical.slice();if(rule!=='storage')expected.sort((a,b)=>(rule==='cost'?a.cost-b.cost:a.name.localeCompare(b.name,'zh'))||index.get(a.id)-index.get(b.id));
  expect(await ids()).toEqual(expected.map(item=>item.id));
 }
 expect(await page.locator('#formationCatalog .catalog-detail').count()).toBe(0);
 const selected=rows.nth(1);await selected.locator('.catalog-unit-info').click();const id=await selected.getAttribute('data-stock-id');
 async function checkFrame(locator){const box=await locator.evaluate(node=>{const frame=node.getBoundingClientRect(),image=node.querySelector('img').getBoundingClientRect(),css=getComputedStyle(node);return {left:image.left-frame.left,right:frame.right-image.right,top:image.top-frame.top,bottom:frame.bottom-image.bottom,border:parseFloat(css.borderLeftWidth)};});expect(box.border).toBeGreaterThan(0);for(const side of ['left','right','top','bottom'])expect(box[side]).toBeGreaterThanOrEqual(box.border);}
 await checkFrame(selected.locator('.catalog-unit-portrait'));
 await expect(page.locator('#formationCatalog [data-stock-id="'+id+'"]').first()).toHaveAttribute('aria-selected','true');
 await page.locator('#formationCatalog [data-stock-id="'+id+'"] .catalog-unit-portrait').click();await expect(page.locator('#warehouseDialog')).toBeVisible();
 await page.locator('#warehouseClose').click();await expect(page.locator('#formationUnitPicker')).toBeVisible();
 const positions=await page.evaluate(()=>Economy.snapshot().storage.units.map(item=>({id:item.id,slot:item.slot})));expect(positions).toEqual(stock.map(item=>({id:item.id,slot:item.slot})));
 const layout=await rows.first().evaluate(node=>({overflow:node.scrollWidth>node.clientWidth+1,height:node.parentElement.getBoundingClientRect().height,contentFits:node.querySelector('.catalog-unit-info').getBoundingClientRect().bottom<=node.getBoundingClientRect().bottom}));expect(layout.overflow).toBe(false);expect(layout.height).toBeLessThanOrEqual(101);expect(layout.contentFits).toBe(true);
 await page.screenshot({path:`tmp/verification/screenshots/formation-picker-order-${width}.png`});expect(errors).toEqual([]);
 await page.locator('#addFormationUnit').click();await page.locator('#closeFormationPicker').click();
 await checkFrame(page.locator('#formationUnits .formation-icon').first());
 await expect(page.locator('#formationUnits .formation-pilot-button')).toHaveCount(0);
 await expect(page.locator('#formationUnits .formation-inventory-count')).toHaveCount(0);
 const actionRows=await page.locator('#formationUnits .formation-row-actions').first().evaluate(node=>getComputedStyle(node).gridTemplateRows.split(' ').length);expect(actionRows).toBe(2);
 const remove=page.locator('#formationUnits .formation-row-actions > .danger').first();
 expect(await remove.evaluate(node=>{const css=getComputedStyle(node);return [css.gridColumnStart,css.gridRowStart];})).toEqual(['2','2']);
 const count=await page.locator('#formationUnits .formation-row').count();await remove.click();await expect(page.locator('#formationUnits .formation-row')).toHaveCount(count-1);
});
