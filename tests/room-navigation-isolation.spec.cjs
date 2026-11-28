const {test,expect}=require('@playwright/test'),{createServer}=require('../server');
for(const roomMode of ['quick','sweep'])test('room preparation pages stay local during peer navigation and snapshots '+roomMode,async({browser})=>{
 test.setTimeout(120000);const app=createServer({port:0}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 const contexts=[],pages=[],errors=[];
 try{
 for(let i=0;i<2;i++){
 const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Nav '+i);await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(({base,i,roomMode})=>{Net.serverURL=base.replace("http:","ws:")+"/ws";Net.room='NAVFIX';byId('newRoomMode').value=roomMode;Net.connect(i?'join':'create',true);},{base,i,roomMode});
 await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting,null,{timeout:20000});
 }
 for(const view of ['pilots','formation','warehouse','production','contactTasks','encyclopedia']){
 if(['pilots','formation','warehouse','production'].includes(view)){await pages[0].locator('#shellHangar').click();await pages[0].locator({pilots:'#shellPilots',formation:'#shellFormation',warehouse:'#shellWarehouse',production:'#shellProduction'}[view]).click();}else await pages[0].evaluate(view=>MenuShell.go(view),view);
 expect(await pages[0].evaluate(()=>pageView),errors.join('\n')).toBe(['pilots','formation'].includes(view)?'formation':view);
 if(view==='pilots')expect(await pages[0].locator('#formationMain').getAttribute('data-page')).toBe('pilots');
 await pages[1].locator('#shellHangar').click();await pages[1].locator('#shellFormation').click();await pages[1].locator('#shellWarehouse').click();
 await pages[1].waitForFunction(()=>!Net.awaiting);
 await pages[0].evaluate(()=>Net.request('sync'));await pages[0].waitForFunction(()=>!Net.awaiting);
 expect(await pages[0].evaluate(()=>pageView),errors.join('\n')).toBe(['pilots','formation'].includes(view)?'formation':view);
 }
 await pages[0].evaluate(()=>MenuShell.go('production'));
 await pages[0].evaluate(()=>Net.connect('resume',true));await pages[0].waitForFunction(()=>Net.snapshot&&!Net.connecting&&!Net.awaiting);
 expect(await pages[0].evaluate(()=>pageView)).toBe('production');
 const host=app.rooms.get('NAVFIX').seats.find(member=>member&&!member.bot);
 host.formationPreset={id:'locked-room-preset',name:'Room preset',units:[{unitId:'Type61',kitId:'standard'}]};
 const preset=JSON.stringify(host.formationPreset);await pages[0].evaluate(()=>Net.request('sync'));await pages[0].waitForFunction(()=>!Net.awaiting);
 for(const tab of ['#shellFormation','#shellPilots']){await pages[0].locator('#shellHangar').click();await pages[0].locator(tab).click();expect(await pages[0].evaluate(()=>pageView)).toBe('formation');}
 await pages[0].locator('#shellWarehouse').click();expect(JSON.stringify(host.formationPreset)).toBe(preset);
 expect(errors).toEqual([]);
 }finally{for(const c of contexts)await c.close();await app.close();}
});
