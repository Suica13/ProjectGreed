const {test,expect}=require('@playwright/test'),{createServer}=require('../server');
for(const width of [1440,390])test('mission fixed controls and compact contract fields '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const app=createServer({host:'127.0.0.1',port:0}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 try{
  await page.goto(base);await page.waitForFunction(()=>assetsReady);
  await page.evaluate(base=>{I18n.setLanguage('zh');byId('newRoomMode').value='mission';Net.serverURL=base.replace('http:','ws:')+'/ws';Net.room='FIXED_ROOM';Net.connect('create',true);},base);
  await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
  if(width<720)await page.locator('[data-room-tab="settings"]').click();
  for(const id of ['roomFogMode','roomPilotPolicy'])await expect(page.locator('#'+id)).toBeDisabled();
  await expect(page.locator('#roomFogMode')).toHaveValue('full');await expect(page.locator('#roomPilotPolicy')).toHaveValue('allow');
  await page.evaluate(()=>Net.request('configure_room',{...Net.snapshot.settings,fogMode:'disabled',pilotPolicy:'none'}));
  await page.waitForFunction(()=>!Net.awaiting);
  expect(await page.evaluate(()=>[Net.snapshot.settings.fogMode,Net.snapshot.settings.pilotPolicy])).toEqual(['full','allow']);
  await page.evaluate(()=>Net.request('configure_room',{...Net.snapshot.settings,battleMode:'sweep'}));
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.mode)).toBe('sweep');await page.waitForFunction(()=>!Net.awaiting);
  await page.locator('#sweepDifficulty').scrollIntoViewIfNeeded();
  const difficulty=await page.locator('#sweepDifficulty').boundingBox(),environment=await page.locator('#sweepEnvironment').boundingBox();
  expect(Math.abs(difficulty.y-environment.y)).toBeLessThan(2);expect(environment.x).toBeGreaterThan(difficulty.x+difficulty.width);
  const grid=await page.locator('#sweepRoomOptions .room-mode-fields').boundingBox();expect(difficulty.width).toBeLessThan(grid.width*.6);
  await page.locator('#sweepEnvironment').selectOption('space');await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.sweepEnvironment)).toBe('space');
  expect(errors).toEqual([]);await page.screenshot({path:`tmp/verification/screenshots/contract-fixed-settings-${width}.png`});
 }finally{await app.close();}
});
