const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const [width,n] of [[1440,19],[390,29]])test(`fleet battle ${n} dialogue and autonomous allies at ${width}px`,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('舰队 PMC');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(n=>{const p=ProfileSave.encodeData();p.economy.contactTasks=[{id:'efsf-'+n,status:'accepted',progress:0,progressVersion:2}];ProfileSave.importData(p);},n);
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'fleet-fixture',matchId:'fleet-fixture',money:0,supplies:0,inventory:{ColumbusClass:1}});Economy.receiveDeliveries();const factory=createRoomEngine;createRoomEngine=options=>(window.fleetEngine=factory({...options,aiDelayMs:999999}));});
 await page.locator('#openSkirmish').click();await page.locator('#createOfflineRoom').click();await page.locator('#offlineRoomMode').selectOption('mission');await page.locator('#confirmOfflineMode').click();
 await expect(page.locator('#roomMapSelect')).toHaveValue('mission_efsf_'+n);
 await page.evaluate(()=>{const u=Economy.snapshot().storage.ships.find(u=>u.unitId==='ColumbusClass');Net.request('start_game',{formation:[{unitId:u.unitId,kitId:u.kitId,stockId:u.id}]});});
 await expect(page.locator('#confirmFinalFormation')).toBeVisible();await page.locator('#confirmFinalFormation').click();
 await expect.poll(()=>page.evaluate(()=>Net.snapshot?.phase)).toBe('deployment');
 const briefing=page.locator('#operationBriefing');await expect(briefing).toBeVisible();await briefing.locator('footer').getByRole('button',{name:'关闭',exact:true}).click();
 await page.evaluate(()=>Net.request('auto_place_deployment'));await expect.poll(()=>page.evaluate(()=>!!Net.awaiting)).toBe(false);await page.evaluate(()=>Net.request('confirm_deployment'));
 const dialogue=page.locator('#missionDialogue');await expect(dialogue).toBeVisible();await expect(dialogue).toContainText(n===19?'阿巴瓦空':'殖民卫星');
 const state=await page.evaluate(()=>{const r=fleetEngine.rooms.get('OFFLINE'),units=r.game.units.filter(u=>u.missionActor);return {allies:units.filter(u=>u.team===0).length,enemies:units.filter(u=>u.team===1).length,locked:units.filter(u=>u.team===0).every(u=>!Rules.canControlUnit({...r.settings,shareAlliedUnits:true},[{seat:0}],0,u))};});
 expect(state).toEqual({allies:22,enemies:33,locked:true});
 if(n===19){const fleet=await page.evaluate(()=>{const r=fleetEngine.rooms.get('OFFLINE'),map=Rules.getMap(r.settings.mapId),allies=r.game.units.filter(u=>u.missionActor&&u.team===0);return {width:map.width,height:map.height,loaded:allies.filter(u=>u.embarked).length,ships:allies.filter(u=>Rules.modelOf(u).unitTags.includes('Ship')).map(u=>Rules.modelOf(u).prefabId).sort()};});expect(fleet.width).toBe(44);expect(fleet.height).toBe(64);expect(fleet.loaded).toBeGreaterThanOrEqual(13);expect(fleet.ships).toEqual(['ColumbusClass','MagellanClassLateType','SalamisClassLateType']);}
 await page.screenshot({path:`tmp/verification/screenshots/efsf-fleet-${n}-${width}.png`});
 for(let i=0;i<(n===19?3:4);i++)await dialogue.getByRole('button',{name:'继续',exact:true}).click();await expect(dialogue).toBeHidden();expect(errors).toEqual([]);
 await page.evaluate(()=>fleetEngine.close());
});
