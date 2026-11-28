const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('url'),path=require('path');
for(const width of [1440,390])test('squad portrait multiselect uses common skills and excludes unselected units '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Squad test');await page.locator('#profileOnboardingConfirm').click();
 const ids=await page.evaluate(()=>{
 Net.leave();TurnFlow.reset();session++;AttackControls.reset();MapCombat.reset();
 const entry={unitId:'RGM_79',kitId:'beam_spray',plugins:['minovsky','generator']};
 game=Rules.create(false,17,[[entry,entry,entry],[{unitId:'MS_06F',kitId:'machine_gun'}]],false,{costLimit:50000,formationStyle:'free'});
 game.tiles.forEach(row=>row.fill('plain'));const own=game.units.filter(u=>u.team===0);
 own.forEach((u,i)=>Object.assign(u,{x:10,y:10,squadId:'test-squad',squadSlot:i,en:1000,deployed:true}));
 game.units.filter(u=>u.team!==0).forEach(u=>Object.assign(u,{x:20,y:20}));
 game.deployment=[true,true];selected=weaponId=pending=battleView=moving=null;mode='select';phase='idle';setPageView('game');select(own[0].id);return own.map(u=>u.id);
 });
 await page.locator(`[data-squad-member="${ids[0]}"]`).click();await page.locator(`[data-squad-member="${ids[1]}"]`).click();
 await expect(page.locator('#hudSquad [data-squad-member][aria-pressed="true"]')).toHaveCount(2);
 await page.locator('[data-unit-command="skills"]').click();
 const actual=await page.evaluate(()=>Rules.unitSkills(game.units[0]).find(s=>s.type==='minovsky').id);
 const button=page.locator(`[data-unit-skill="${actual}"]`);
 await page.evaluate(id=>{getUnit(id).en=0;update();},ids[1]);await expect(button).toBeDisabled();
 await page.evaluate(id=>{getUnit(id).en=1000;update();},ids[1]);await expect(button).toBeEnabled();await expect(button).toContainText('2');await button.click();
 await expect.poll(()=>page.evaluate(()=>game.minovskyFields?.length||0)).toBe(2);
 expect(await page.evaluate(ids=>ids.map(id=>game.units.find(u=>u.id===id).en),ids)).toEqual([700,700,1000]);
 await expect(button).toBeDisabled();expect(errors).toEqual([]);
 await page.screenshot({path:`tmp/verification/screenshots/squad-multiselect-${width}.png`});
});
test('warehouse unload button persists all four empty slots',async({page})=>{
 test.setTimeout(90000);await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Parts test');await page.locator('#profileOnboardingConfirm').click();
 const id=await page.evaluate(()=>{Economy.creditActivity({id:'unload-ui',matchId:'unload-ui',money:0,supplies:0,inventory:{RGM_79:1},pluginInventory:{frame:1,generator:1,armor:1,antenna:1}});Economy.receiveDeliveries();const item=Economy.snapshot().storage.units.find(i=>i.unitId==='RGM_79');['frame','generator','armor','antenna'].forEach((p,i)=>Economy.setStoredPlugin(item.id,i,p));WarehouseUI.open();WarehouseUI.openItem(item.id);return item.id;});
 await page.locator('#warehouseRemoveAllPlugins').click();await expect(page.locator('#warehouseRemoveAllPlugins')).toBeDisabled();await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(id=>Economy.snapshot().storage.units.find(i=>i.id===id).plugins,id)).toEqual([null,null,null,null]);
});
test('two selected mortar skills share a confirmed target and submit separate intents',async({page})=>{
 test.setTimeout(90000);await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Weapon batch');await page.locator('#profileOnboardingConfirm').click();
 const result=await page.evaluate(()=>{
 Net.leave();session++;const model=Object.values(Rules.models).find(m=>m.prefabId==='RX_77_2'&&m.weapons.some(w=>w.category==='mortar')),entry={unitId:model.prefabId,kitId:model.kitId};
 game=Rules.create(false,1,[[entry,entry],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{fogMode:'disabled',costLimit:99999});game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
 game.units.forEach((u,i)=>Object.assign(u,{x:u.team?9:5,y:5,en:100000,hp:1000000,...(!u.team?{squadId:'mortar-batch',squadSlot:i}:{})}));
 phase='idle';pending=moving=battleView=null;selected=game.units[0].id;mode='select';Net.active=true;Net.seat=0;Net.socket={readyState:1};Net.awaiting=false;
 Net.snapshot={started:true,phase:'idle',settings:Rules.defaultRoomSettings(),members:[{seat:0,connected:true},{seat:1,connected:true}],connected:[true,true],turnDone:[false,false],game};
 window.batchRequests=[];Net.request=(action,fields)=>batchRequests.push({action,fields});setPageView('game');update();
 for(const u of game.units.filter(u=>!u.team))document.querySelector(`[data-squad-member="${u.id}"]`).click();BattleHUD.setTab('skills');
 const w=Rules.modelOf(game.units[0]).weapons.find(w=>w.category==='mortar');document.querySelector(`[data-weapon-skill="${w.id}"]`).click();
 SkillControls.chooseWeaponTarget(game.units[0],{...game.units[2],aimCell:{x:9,y:5}},w);const ready=SkillControls.confirmation(game.units[0]).ready;
 SkillControls.confirm();return {ready,requests:batchRequests};
 });
 expect(result.ready).toBe(true);expect(result.requests).toHaveLength(2);expect(result.requests.map(r=>r.fields.unitId)).toEqual(['0-0','0-1']);expect(result.requests.every(r=>r.action==='attack'&&r.fields.single&&r.fields.targetId==='1-0')).toBe(true);
});
