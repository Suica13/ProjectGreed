const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('owned-unit weapon tab scrolls the current loadout without resizing '+width,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  const fixture=await page.evaluate(()=>{
    I18n.setLanguage('zh');Economy.creditActivity({id:'weapon-tab',matchId:'weapon-tab',money:0,supplies:0,inventory:{RGM_79:1}});
    const item=Economy.snapshot().storage.units.find(item=>item.unitId==='RGM_79');return {stockId:item.id,kit:item.kitId,weapons:UnitModels[item.unitId+'__'+item.kitId].weapons.map(w=>w.id)};
  });
  await page.locator('#shellHangar').click();await page.locator('#warehouseBays [data-stock-id="'+fixture.stockId+'"]').click();
  const block=page.locator('#warehouseDialog .unit-attribute-block'),weapons=page.locator('#warehouseWeaponList');
  const height=await block.evaluate(node=>node.getBoundingClientRect().height);await expect(weapons).toBeHidden();
  await block.getByRole('button',{name:'武装列表',exact:true}).click();
  await expect(weapons).toBeVisible();await expect(weapons.locator('.weapon-card')).toHaveCount(fixture.weapons.length);
  expect(await weapons.locator('.weapon-range').allTextContents()).toEqual(await page.evaluate(()=>{
    const item=Economy.snapshot().storage.units.find(item=>item.unitId==='RGM_79');return UnitModels[item.unitId+'__'+item.kitId].weapons.map(weapon=>weapon.min+'–'+weapon.max);
  }));
  expect(await weapons.locator('.weapon-energy').first().evaluate(row=>row.querySelector('.weapon-range').getBoundingClientRect().x>row.querySelector('.weapon-en-cost').getBoundingClientRect().x)).toBe(true);
  expect(await weapons.locator('.weapon-card').evaluateAll(cards=>cards.map(card=>card.dataset.weaponId))).toEqual(fixture.weapons);
  const layout=await weapons.evaluate(node=>({scroll:node.scrollHeight>node.clientHeight,overflow:node.scrollWidth>node.clientWidth+1,mode:getComputedStyle(node).overflowY}));
  expect(layout).toEqual({scroll:true,overflow:false,mode:'auto'});expect(await block.evaluate(node=>node.getBoundingClientRect().height)).toBe(height);
  await weapons.evaluate(node=>node.scrollTop=node.scrollHeight);expect(await weapons.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  await block.getByRole('button',{name:'技能列表',exact:true}).click();await expect(weapons).toBeHidden();
  await block.getByRole('button',{name:'武装列表',exact:true}).click();await expect(weapons.locator('.weapon-card')).toHaveCount(fixture.weapons.length);
  await page.screenshot({path:`tmp/verification/screenshots/warehouse-weapons-${width}.png`});
  const next=await page.evaluate(stockId=>{
    const item=Economy.snapshot().storage.units.find(item=>item.id===stockId),kit=Rules.catalog.prefabs.find(p=>p.id===item.unitId).weaponKits.find(kit=>kit.id!==item.kitId);
    return {kit:kit.id,weapons:UnitModels[item.unitId+'__'+kit.id].weapons.map(w=>w.id)};
  },fixture.stockId);
  await page.locator('#warehouseDetailKit').selectOption(next.kit);
  await expect(weapons).toBeVisible();
  expect(await weapons.locator('.weapon-card').evaluateAll(cards=>cards.map(card=>card.dataset.weaponId))).toEqual(next.weapons);
  const formStock=await page.evaluate(()=>{
    Economy.creditActivity({id:'weapon-tab-form',matchId:'weapon-tab-form',money:0,supplies:0,inventory:{MSZ_006:1}});
    const item=Economy.snapshot().storage.units.find(item=>item.unitId==='MSZ_006');WarehouseUI.openItem(item.id);return item.id;
  });
  await expect(weapons).toBeVisible();
  await page.locator('#warehouseTransform').click();
  await page.locator('.warehouse-form-choice[data-form-id="MSZ_006_MA"]').click();
  await expect(weapons).toBeVisible();
  const formWeapons=await page.evaluate(id=>{
    const item=Economy.snapshot().storage.units.find(item=>item.id===id);return UnitModels[item.unitId+'__'+item.kitId].weapons.map(w=>w.id);
  },formStock);
  expect(await weapons.locator('.weapon-card').evaluateAll(cards=>cards.map(card=>card.dataset.weaponId))).toEqual(formWeapons);
  await block.getByRole('button',{name:'次要属性',exact:true}).click();
  await page.locator('#warehouseTransform').click();
  await page.locator('.warehouse-form-choice[data-form-id="MSZ_006"]').click();
  await expect(page.locator('#warehouseSecondaryAttributes')).toBeVisible();
  await expect(weapons).toBeHidden();
  expect(errors).toEqual([]);
});
