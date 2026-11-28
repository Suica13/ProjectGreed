const {test,expect}=require('@playwright/test'),{createServer}=require('../server'),G=require('../shared/rules');
test('selected squad skills use sequential authoritative requests with independent EN and cooldown',async({page})=>{
 test.setTimeout(120000);const app=createServer({port:0,aiDelayMs:999999}),address=await app.listen(),base='http://127.0.0.1:'+address.port,errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(base);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Skill authority');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(base=>{Net.serverURL=base.replace('http:','ws:')+'/ws';Net.room='BATCHSKILL';byId('newRoomMode').value='quick';Net.connect('create',true);},base);await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
 const room=app.rooms.get('BATCHSKILL'),entry={unitId:'RGM_79',kitId:'beam_spray',plugins:['minovsky','generator']};
 room.game=G.create(false,19,[[entry,entry,entry],[{unitId:'MS_06F',kitId:'machine_gun'}]],false,{costLimit:50000,formationStyle:'free'});room.game.tiles.forEach(row=>row.fill('plain'));room.started=true;room.phase='idle';room.turnDone=room.seats.map(()=>false);room.game.deployment=room.seats.map(()=>true);room.game.winner=null;
 const own=room.game.units.filter(u=>u.team===0);own.forEach((u,i)=>Object.assign(u,{x:10,y:10,squadId:'batch-test',squadSlot:i,en:1000,deployed:true}));room.game.units.filter(u=>u.team!==0).forEach(u=>Object.assign(u,{x:20,y:20}));
 await page.evaluate(()=>Net.request('sync'));await page.waitForFunction(()=>phase==='idle'&&pageView==='game'&&!Net.awaiting);
 await page.evaluate(id=>select(id),own[0].id);
 for(const u of own.slice(0,2))await page.locator(`[data-squad-member="${u.id}"]`).click();
 await page.locator('[data-unit-command="skills"]').click();const skill=G.unitSkills(own[0]).find(s=>s.type==='minovsky');
 await page.locator(`[data-unit-skill="${skill.id}"]`).click();
 await expect.poll(()=>own.slice(0,2).map(u=>u.en)).toEqual([700,700]);expect(own[2].en).toBe(1000);
 await page.waitForFunction(()=>!Net.awaiting);expect(room.game.minovskyFields.length).toBe(2);
 for(const u of own.slice(0,2))expect(G.canUseSkill(room.game,u,skill.id)).toBe(false);
 expect(errors).toEqual([]);
 }finally{await page.close();await app.close();}
});
