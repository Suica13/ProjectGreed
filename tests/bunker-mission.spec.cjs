const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const [width,option,length] of [[1440,'accept',8],[390,'refuse',9]])test(`bunker dialogue and ${option} branch at ${width}px`,async({page})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  await page.addInitScript(()=>localStorage.setItem('projectgreed.economy.v1',JSON.stringify({schemaVersion:3,money:100000,supplies:100000,licenses:{Medea:true},inventory:{Medea:5},kits:{},claimed:{}})));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.evaluate(()=>{I18n.setLanguage('zh');const factory=createRoomEngine;createRoomEngine=options=>(window.bunkerEngine=factory({...options,aiDelayMs:999999}));});
  await page.locator('#openSkirmish').click();await page.locator('#createOfflineRoom').click();
  await page.locator('#offlineRoomMode').selectOption('mission');await page.locator('#confirmOfflineMode').click();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot?.settings.mode)).toBe('mission');
  await page.evaluate(()=>Net.request('configure_room',{mapId:'mission_bunker_coastal',costLimit:4500,unitLimit:18}));
  await expect.poll(()=>page.evaluate(()=>Net.snapshot?.settings.mapId)).toBe('mission_bunker_coastal');
  await expect.poll(()=>page.evaluate(()=>!!Net.awaiting)).toBe(false);
  await page.evaluate(()=>Net.request('start_game',{formation:[{unitId:'Medea',kitId:'standard'}]}));
  await expect(page.locator('#confirmFinalFormation')).toBeVisible();await page.locator('#confirmFinalFormation').click();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.phase)).toBe('deployment');
  await page.evaluate(()=>Net.request('auto_place_deployment'));await expect.poll(()=>page.evaluate(()=>!!Net.awaiting)).toBe(false);
  await page.evaluate(()=>Net.request('confirm_deployment'));
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.phase)).not.toBe('deployment');
  const crews=await page.evaluate(()=>[...bunkerEngine.rooms.values()][0].game.units
    .filter(u=>u.facility).map(u=>({faction:u.pilot.faction,name:I18n.pilotName(u.pilot),
      portrait:PilotSystem.portrait(u.pilot),expected:PilotSystem.catalog.portraits.find(p=>p.faction==='ZEON').icon})));
  expect(crews).toHaveLength(12);
  for(const crew of crews){expect(crew.faction).toBe('ZEON');
    expect(crew.name).toBe('\u5409\u7fc1\u4e00\u822c\u9a7e\u9a76\u5458');expect(crew.portrait).toBe(crew.expected);}
  const briefing=page.locator('#missionDialogue');
  await expect(briefing).toBeVisible();
  await expect(briefing.locator('strong')).toHaveText('联邦通信员:');
  await expect(briefing.locator('p')).toHaveText('吉翁军在地球已经要完蛋了。');
  await page.screenshot({path:`tmp/verification/screenshots/bunker-briefing-${width}.png`});
  for(let i=0;i<5;i++)await briefing.getByRole('button',{name:'继续',exact:true}).click();
  await expect(briefing).toBeHidden();

  await page.evaluate(()=>{const room=[...bunkerEngine.rooms.values()][0];room.game.round=10;bunkerEngine.broadcast(room);room.game.units.filter(u=>u.missionGroup==='main-force').forEach(u=>u.hp=0);bunkerEngine.broadcast(room);});
  const cover=page.locator('#missionDialogue');
  await expect(cover).toBeVisible();
  await expect(cover.locator('strong')).toHaveText('吉翁军前线指挥官:');
  await expect(cover.locator('p')).toHaveText('这里是吉翁军前线指挥部，全频段呼叫联邦前线指挥官。');
  await expect.poll(()=>cover.locator('img').evaluate(el=>el.complete && el.naturalWidth>0)).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/bunker-dialogue-${width}.png`});
  for(let i=0;i<9;i++){
    await expect.poll(()=>page.evaluate(()=>Net.snapshot.game.mission.dialogue?.index)).toBe(i);
    await cover.getByRole('button',{name:'继续',exact:true}).click();
  }
  const choice=page.locator('#missionChoicePanel');await expect(choice).toBeVisible();
  await page.keyboard.press('Escape');await expect(choice).toBeVisible();
  await page.screenshot({path:`tmp/verification/screenshots/bunker-choice-${width}.png`});
  await choice.getByRole('button',{name:option==='accept'?'A：接受停火，任务结束。':'B：不接受停火，继续歼灭敌军。',exact:true}).click();
  for(let i=0;i<length;i++){
    await expect.poll(()=>page.evaluate(()=>Net.snapshot.game.mission.dialogue?.index)).toBe(i);
    expect(await page.evaluate(()=>Net.snapshot.game.winner)).toBe(null);
    expect(await page.evaluate(()=>[...bunkerEngine.rooms.values()][0].game.units.filter(u=>u.missionGroup==='last-stand').length)).toBe(0);
    await cover.getByRole('button',{name:'继续',exact:true}).click();
  }
  await expect(cover).toBeHidden();
  if(option==='refuse'){
    await expect.poll(()=>page.evaluate(()=>[...bunkerEngine.rooms.values()][0].game.units.filter(u=>u.missionGroup==='last-stand').length)).toBe(46);
    await page.evaluate(()=>{const room=[...bunkerEngine.rooms.values()][0];room.game.units.filter(u=>u.team===1).forEach(u=>u.hp=0);bunkerEngine.broadcast(room);});
  }
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.game.winner)).toBe(0);
  expect(errors).toEqual([]);
});
