const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390]) test(`mode menus omit regular and use battlefield/strategy/contract order at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const menus=await page.evaluate(()=>['offlineRoomMode','newRoomMode','roomBattleMode'].map(id=>({
    id,groups:[...document.getElementById(id).children].map(g=>({label:g.label,modes:[...g.children].map(o=>o.value)}))
  })));
  for(const menu of menus) expect(menu.groups).toEqual([
    {label:'合约模式',modes:['mission','sweep']},
    {label:'战场模式',modes:['battlefield','quick']},
    {label:'策略模式',modes:['campaign']},
  ]);
  await page.locator('#openSkirmish').click();
  await expect(page.locator('#offlineRoomMode')).toBeHidden();
  await expect(page.locator('#createOfflineRoom')).not.toHaveClass(/primary/);
  await expect(page.locator('#openRooms')).toHaveClass(/primary/);
  await page.locator('#createOfflineRoom').click();
  await expect(page.locator('#offlineModeSetup')).toBeVisible();
  await expect(page.locator('#skirmishSetup')).toBeHidden();
  expect(await page.evaluate(()=>Net.active)).toBeFalsy();
  await page.locator('#cancelOfflineMode').click();
  await expect(page.locator('#skirmishSetup')).toBeVisible();
  await expect(page.locator('#offlineModeSetup')).toBeHidden();
  await page.locator('#createOfflineRoom').click();
  await page.locator('#offlineRoomMode').press('Escape');
  await expect(page.locator('#skirmishSetup')).toBeVisible();
  await page.locator('#createOfflineRoom').click();
  await page.locator('#offlineRoomMode').selectOption('quick');
  await page.locator('#confirmOfflineMode').click();
  await expect(page.locator('#roomPreparation')).toBeVisible();
  await expect(page.locator('#offlineModeSetup')).toBeHidden();
  expect(await page.evaluate(()=>Net.snapshot.settings.mode)).toBe('quick');
  await expect(page.locator('#roomBattleMode')).toHaveValue('quick');
});
