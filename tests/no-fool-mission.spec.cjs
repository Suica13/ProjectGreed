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
  await page.locator('#missionObjectives').click();
  const panel=page.locator('#missionObjectivesPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h2')).toHaveText('任务目标');
  await expect(panel.locator('h3')).toHaveText(['胜利条件','失败条件']);
  await expect(panel.locator('[data-objectives="victory"]')).toContainText('(1/15)');
  await expect(panel.locator('[data-objectives="failure"]')).toContainText('(0/1)');
  const bounds=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return {
    x:Math.abs(r.x+r.width/2-innerWidth/2),y:Math.abs(r.y+r.height/2-innerHeight/2),
    left:r.left,right:r.right,width:innerWidth};});
  expect(bounds.x).toBeLessThan(2);expect(bounds.y).toBeLessThan(2);
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(panel).toBeHidden();
  await page.locator('#missionObjectives').click();
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
  await expect(panel.locator('[data-objectives="victory"]')).toContainText('(2/15)');
  await page.screenshot({path:`tmp/verification/screenshots/no-fool-mission-${width}.png`});
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});
