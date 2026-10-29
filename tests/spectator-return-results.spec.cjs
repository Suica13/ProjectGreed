const {test,expect}=require('@playwright/test');
const {createServer}=require('../server.js');
const G=require('../shared/rules.js');
const formation=[{unitId:'Type61',kitId:'standard'},{unitId:'Type61',kitId:'standard'}];
test('spectator returns with the room, rejects delayed UI snapshots, sees team losses and opens records',async({browser})=>{
 test.setTimeout(60000);
 const app=createServer({host:'127.0.0.1',port:0,roomReturnMs:250,resultReturnMs:60000}),addr=await app.listen(),base='http://127.0.0.1:'+addr.port;
 const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
 const pages=await Promise.all(contexts.map(c=>c.newPage())),[host,guest,watch]=pages,errors=[];
 const idle=p=>p.waitForFunction(()=>Net.active&&Net.snapshot&&!Net.awaiting);
 const act=async(p,action,fields={})=>{await idle(p);await p.evaluate(({action,fields})=>Net.request(action,fields),{action,fields});await idle(p);};
 const begin=async()=>{await act(guest,'set_ready',{ready:true,formation});await act(host,'start_game',{formation});await Promise.all(pages.map(p=>p.waitForFunction(()=>Net.snapshot.phase==='assembly')));};
 const checkReturn=async()=>{
  for(const p of pages)await p.evaluate(()=>{window.oldRoomFrame=Net.snapshot;});
  await act(host,'return_room',{matchId:await host.evaluate(()=>Net.snapshot.matchId)});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>Net.snapshot.phase==='waiting')));
  for(const p of pages){await p.evaluate(()=>{Net.applySnapshot(oldRoomFrame);update();});await expect(p.locator('#finalAssemblyPanel')).toBeHidden();await expect(p.locator('#roomReturnCountdown')).not.toHaveAttribute('open','');expect(await p.evaluate(()=>phase)).toBe('waiting');}
 };
 try{
  for(const [i,p] of pages.entries()){
   p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForFunction(()=>assetsReady);
   await p.evaluate(({base,i})=>{I18n.setLanguage('zh');byId('playerId').value=['Host','Guest','Observer'][i];Lobby.reconnect(base);}, {base,i});
   await expect(p.locator('#lobby')).toBeVisible();
   if(!i){await p.locator('#createRoom').click();await p.locator('#roomCode').fill('WATCHRETURN');await p.locator('#roomCreateForm button[type="submit"]').click();}
   else await p.locator('.room-card').filter({hasText:'WATCHRETURN'}).getByRole('button').click();
   await idle(p);
  }
  expect(await watch.evaluate(()=>Net.seat)).toBeNull();
  await begin();
  await watch.evaluate(()=>{
   const saved=Net.snapshot,original=BattleAssets.guard;
   BattleAssets.guard=(snapshot,resume)=>{if(snapshot===saved){window.delayedAssembly=resume;return true;}return original(snapshot,resume);};
   Net.applySnapshot(saved);BattleAssets.guard=original;
  });
  await checkReturn();await watch.evaluate(()=>delayedAssembly());expect(await watch.evaluate(()=>phase)).toBe('waiting');
  // Repeat from the battle scene, including a spectator who keeps the seats panel open.
  await begin();await act(host,'confirm_formation');await act(guest,'confirm_formation');await act(host,'confirm_deployment');await act(guest,'confirm_deployment');
  await watch.evaluate(()=>setPageView('game'));await watch.locator('#hudToggleRoster').click();
  await expect(watch.locator('#rosterTeam0')).toBeVisible();await expect(watch.locator('#rosterTeam1')).toBeVisible();
  const grouped=await watch.evaluate(()=>[0,1].map(team=>[...byId(team?'enemies':'allies').querySelectorAll('.roster-unit')].every(row=>getUnit(row.dataset.unitId).team===team)));
  expect(grouped).toEqual([true,true]);
  await watch.evaluate(()=>{const units=game.units.slice();for(const u of units)for(let i=0;i<12;i++)game.units.push({...u,id:u.id+'copy'+i});update();byId('allies').scrollTop=70;byId('enemies').scrollTop=35;update();});
  expect(await watch.evaluate(()=>[byId('allies').scrollTop,byId('enemies').scrollTop])).toEqual([70,35]);
  await watch.evaluate(()=>byId('roomSettings').click());await checkReturn();
  // Finish a real authoritative attack, with losses on both teams.
  await begin();await act(host,'confirm_formation');await act(guest,'confirm_formation');await act(host,'confirm_deployment');await act(guest,'confirm_deployment');
  const room=app.rooms.get('WATCHRETURN'),blue=room.game.units.filter(u=>u.team===0),red=room.game.units.filter(u=>u.team===1);
  room.game.tiles.forEach(row=>row.fill('plain'));Object.assign(blue[0],{x:2,y:4});blue[1].hp=0;Object.assign(red[0],{x:4,y:4,hp:1,shield:0});red[1].hp=0;room.game.seed=1;
  for(const p of pages){await p.evaluate(()=>{byId('quick').checked=true;setPageView('game');});await act(p,'sync');}
  await act(host,'attack',{unitId:blue[0].id,targetId:red[0].id,weaponId:'EF_Type61_Cannon'});await act(host,'end_turn');await guest.waitForFunction(()=>Net.snapshot.phase==='reaction');await act(guest,'respond',{response:'defend'});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>Net.snapshot.phase==='playback')));
  for(const p of pages)await act(p,'playback_ready',{batchId:await p.evaluate(()=>Net.snapshot.playback.id)});
  await expect(watch.locator('#victory')).toBeVisible({timeout:15000});
  await expect(watch.locator('.result-team-losses[data-team="0"] img')).toHaveCount(1);await expect(watch.locator('.result-team-losses[data-team="1"] img')).toHaveCount(2);
  await expect(watch.locator('#victoryEconomy')).toBeHidden();await expect(watch.locator('#victoryUnitIcons')).not.toContainText('击毁单位');
  await watch.locator('#victoryRecords').click();await expect(watch.locator('#matchRecordsDialog')).toBeVisible();await expect(watch.locator('#battleLogPerspective')).toBeVisible();
  await watch.locator('#matchRecordsDialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(watch.locator('#victory')).toBeVisible();
  await checkReturn();expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));await app.close();}
});
test('mobile spectator results keep the records button reachable and use the shared records dialog',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(require('node:url').pathToFileURL(require('node:path').resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(async()=>{I18n.setLanguage('zh');LocalRoom.open();await new Promise(r=>setTimeout(r,0));});
 await page.waitForFunction(()=>Net.snapshot);
 await page.evaluate(()=>{
  const s=structuredClone(Net.snapshot);s.revision+=100;s.started=true;s.phase='finished';s.you.seat=null;s.game.winner=0;s.returnAt=Date.now()+30000;s.serverTime=Date.now();s.economyAwards=[];
  s.teamLosses=[0,1].map(team=>({team,units:Array.from({length:20},(_,i)=>({id:team+'-'+i,unitId:'Type61',model:'Type61__standard'}))}));
  Net.receive(s,Net.socket);setPageView('game');showVictory();
 });
 await expect(page.locator('#victory')).toBeVisible();
 const bounds=await page.locator('#victory > .modal').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(391);
 await page.locator('#victoryRecords').click();await expect(page.locator('#matchRecordsDialog')).toBeVisible();
 await page.locator('#matchRecordsDialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('#victoryRecords')).toBeVisible();
});
