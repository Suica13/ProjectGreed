const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`escort mission selection, deployment and support at ${width}px`,async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  await page.addInitScript(()=>localStorage.setItem('projectgreed.economy.v1',JSON.stringify({
    schemaVersion:3,money:100000,supplies:100000,licenses:{Medea:true},inventory:{Medea:5},kits:{},claimed:{}})));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.evaluate(()=>{
    I18n.setLanguage('zh');
    const factory=createRoomEngine;
    createRoomEngine=options=>(window.escortEngine=factory({...options,aiDelayMs:999999}));
  });
  await page.locator('#openSkirmish').click();
  await page.locator('#createOfflineRoom').click();
  await page.locator('#offlineRoomMode').selectOption('mission');
  await page.locator('#confirmOfflineMode').click();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot?.settings.mode)).toBe('mission');
  await page.evaluate(()=>Net.request('configure_room',{mapId:'mission_no_fool',costLimit:2000,unitLimit:18}));
  await expect.poll(()=>page.evaluate(()=>Net.snapshot?.settings.mapId)).toBe('mission_no_fool');
  await expect.poll(()=>page.evaluate(()=>!!Net.awaiting)).toBe(false);
  await page.evaluate(()=>Net.request('start_game',{formation:[{unitId:'Medea',kitId:'standard'}]}));
  await expect(page.locator('#confirmFinalFormation')).toBeVisible();
  await page.locator('#confirmFinalFormation').click();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.phase)).toBe('deployment');
  await page.evaluate(()=>Net.request('auto_place_deployment'));
  await expect.poll(()=>page.evaluate(()=>!!Net.awaiting)).toBe(false);
  await page.evaluate(()=>Net.request('confirm_deployment'));
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.game.mission.escort?.step)).toBe(1);
  await expect(page.locator('#missionObjectives')).toBeVisible();
  await page.locator('#missionObjectives summary').click();
  await expect(page.locator('#missionObjectives p')).toContainText('1/15');
  await expect(page.locator('#missionDialogue')).toBeHidden();
  await page.evaluate(()=>{
    const room=[...escortEngine.rooms.values()][0];
    Rules.end(room.game);escortEngine.broadcast(room);
  });
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.game.mission.escort?.step)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>phase)).toBe('idle');
  expect(await page.evaluate(()=>Net.snapshot.game.units.filter(u=>u.missionGroup==='air-support').length)).toBe(6);
  await page.evaluate(()=>{
    const convoy=game.units.find(u=>u.missionActor==='bigtray');
    MapCamera.focus(convoy.x,convoy.y);
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:`tmp/verification/screenshots/no-fool-mission-${width}.png`});
  expect(errors).toEqual([]);
});
