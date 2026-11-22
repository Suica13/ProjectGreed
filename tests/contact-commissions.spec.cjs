const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('liaison first contact, commission hand-in and safekeeping '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{I18n.setLanguage('zh');byId('playerId').value='白龙PMC';PlayerProfile.name();Economy.creditActivity({id:'fill-depot',matchId:'fill-depot',money:100000,supplies:100000,inventory:{RGM_79:21,Medea:5}});});
 await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();
 await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
 const terminal=page.locator('#merchantTerminal');await expect(terminal).toContainText('初见联络人');
 await terminal.getByRole('button',{name:'关闭',exact:true}).click();
 expect(await page.evaluate(()=>Economy.snapshot().contactIntro)).toBe(false);
 await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
 let company=false;
 for(let i=0;i<21;i++){
  if((await terminal.textContent()).includes('白龙PMC'))company=true;
  await page.locator('#liaisonDialogueNext').click();
 }
 expect(company).toBe(true);expect(await page.evaluate(()=>Economy.snapshot().contactIntro)).toBe(true);
 expect(await page.evaluate(()=>Economy.hasLicense('RGM_79_E'))).toBe(true);
 await terminal.getByRole('button',{name:'任务',exact:true}).click();
 await expect(terminal.locator('[data-task-id]')).toHaveCount(6);
 await terminal.locator('[data-task-id="efsf-2"]').click();await expect(page.locator('#contactTaskAction')).toBeDisabled();
 await terminal.locator('[data-task-id="efsf-1"]').click();await page.locator('#contactTaskAction').click();
 await expect(page.locator('#contactTaskAction')).toHaveText('进行中');
 await page.evaluate(()=>Economy.creditAward({id:'commission-proof',matchId:'commission-match',money:0,supplies:0,contactProgress:[{id:'efsf-1',amount:6}]}));
 await expect(page.locator('#contactTaskAction')).toHaveText('交付任务');await page.locator('#contactTaskAction').click();
 await page.locator('#liaisonDialogueNext').click();await page.locator('#liaisonDialogueNext').click();
 await expect(terminal).toContainText('好感度 0.1');
 await terminal.getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#shellHangar').click();await page.locator('#warehouseDeliveries').click();
 await expect(page.locator('.warehouse-delivery-card')).toHaveCount(5);
 const depot=page.locator('#warehouseDialog');await expect(depot.getByRole('button',{name:'接受',exact:true}).first()).toBeDisabled();
 await page.evaluate(()=>Economy.discardStoredUnit(Economy.snapshot().storage.units[0].id));
 await page.locator('#warehouseClose').click();await page.locator('#warehouseDeliveries').click();
 await page.locator('.warehouse-delivery-card').filter({hasText:'吉姆初期型'}).first().getByRole('button',{name:'接受',exact:true}).click();
 await expect(page.locator('.warehouse-delivery-card')).toHaveCount(4);
 expect(await depot.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
 await page.screenshot({path:'tmp/verification/screenshots/contact-safekeeping-'+width+'.png'});
 await page.locator('#warehouseClose').click();
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
 await expect(page.locator('#liaisonDialogueNext')).toHaveCount(0);
 await terminal.getByRole('button',{name:'任务',exact:true}).click();await terminal.locator('[data-task-id="efsf-2"]').click();await expect(page.locator('#contactTaskAction')).toBeEnabled();
 await terminal.getByRole('button',{name:'关闭',exact:true}).click();
 await page.evaluate(()=>{
  for(let n=2;n<=6;n++){const id='efsf-'+n;Economy.acceptContactTask(id);Economy.creditAward({id:'facility-progress-'+id,matchId:'facility-progress-'+id,money:0,supplies:0,contactProgress:[{id,amount:1}]});Economy.completeContactTask(id);}
  BaseFacilitiesUI.open();
 });
 await page.locator('[data-facility-upgrade="factory"]').click();await expect(page.locator('#confirmFacilityUpgrade')).toBeDisabled();await expect(page.locator('#facilityDialog')).toContainText('10,000');await page.locator('#closeFacilityDialog').click();
 await page.locator('[data-facility-upgrade="hq"]').click();await expect(page.locator('#facilityDialog')).toContainText('20,000');await page.locator('#confirmFacilityUpgrade').click();
 expect(await page.evaluate(()=>Economy.snapshot().baseFacilities.levels.hq)).toBe(2);
 await page.locator('[data-facility-upgrade="factory"]').click();await expect(page.locator('#confirmFacilityUpgrade')).toBeEnabled();await page.locator('#confirmFacilityUpgrade').click();
 expect(await page.evaluate(()=>Economy.storageUsage('units').slots)).toBe(30);
 expect(errors).toEqual([]);
});

test('accepted liaison recovery reaches a real room, renders its wreck and returns verified progress',async({page})=>{
 test.setTimeout(90000);
 const {createServer}=require('../server'),app=createServer({port:0,aiDelayMs:999999,resultReturnMs:999999}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const idle=()=>page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
 const act=async(action,fields={})=>{await idle();await page.evaluate(({action,fields})=>Net.request(action,fields),{action,fields});await idle();};
 try{
  await page.goto(base);await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{
   I18n.setLanguage('zh');Economy.meetLiaison();Economy.acceptContactTask('efsf-1');
   Economy.creditAward({id:'first-proof',matchId:'first-proof',money:0,supplies:0,contactProgress:[{id:'efsf-1',amount:6}]});Economy.completeContactTask('efsf-1');Economy.acceptContactTask('efsf-2');
   Economy.creditActivity({id:'carrier',matchId:'carrier',money:0,supplies:0,inventory:{Medea:1}});
   const item=Economy.snapshot().storage.ships.find(u=>u.unitId==='Medea');
   localStorage.setItem('slg-formations-v1.PMC',JSON.stringify({version:3,squads:[{name:'Commission',units:[{unitId:item.unitId,kitId:item.kitId,stockId:item.id}]}]}));localStorage.setItem('slg-formations-v1.PMC-active','0');
  });
  await page.reload();await page.waitForFunction(()=>assetsReady);await page.evaluate(base=>Lobby.reconnect(base),base);
  await page.locator('#createRoom').click();await page.locator('#roomCode').fill('LIAISON_WS');await page.locator('#newRoomMode').selectOption('sweep');await page.locator('#roomCreateForm button[type=submit]').click();await idle();
  await act('start_game',{formation:await page.evaluate(()=>Formation.current())});await act('confirm_formation');
  const briefing=page.locator('#operationBriefing');await expect(briefing).toBeVisible();await briefing.locator('footer').getByRole('button',{name:'关闭',exact:true}).click();
  await act('auto_place_deployment');await act('confirm_deployment');
  const room=app.rooms.get('LIAISON_WS'),g=room.game,o=g.contract.objectives.find(o=>o.contactTaskId==='efsf-2'),actor=g.units.find(u=>u.ownerSeat===0);
  expect(o).toBeTruthy();expect(o.wreckModel).toBe('Medea__standard');
  g.fogMode='disabled';actor.x=o.x;actor.y=o.y;actor.acted=false;await act('sync');
  await page.evaluate(({x,y})=>{MapCamera.setPercent(75);MapCamera.focus(x,y);},o);
  await page.waitForTimeout(400);await page.screenshot({path:'tmp/verification/screenshots/liaison-wreck.png'});
  await act('contract_interact',{unitId:actor.id,objectiveId:o.id});
  expect(await page.evaluate(()=>Economy.snapshot().contactTasks.find(e=>e.id==='efsf-2').status)).toBe('accepted');
  actor.x=g.contract.extraction.x;actor.y=g.contract.extraction.y;await act('contract_extract',{unitId:actor.id});
  await expect.poll(()=>page.evaluate(()=>Economy.snapshot().contactTasks.find(e=>e.id==='efsf-2').status)).toBe('ready');
  expect(errors).toEqual([]);
 }finally{await page.evaluate(()=>Net.leave()).catch(()=>{});await app.close();}
});
