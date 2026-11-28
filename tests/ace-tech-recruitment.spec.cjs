const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('task technology opens ACE recruitment at triple price and recovery costs only materials '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:1000});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('ACE test');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{const s=Economy.snapshot();s.money=s.supplies=1000000;s.baseFacilities.levels.hq=2;s.baseFacilities.levels.beacon=2;localStorage.setItem(Economy.key,SaveCodec.stringify(s));});
 await page.reload();await page.waitForFunction(()=>assetsReady);await page.locator('#shellHangar').click();await page.locator('#shellPilots').click();await page.locator('#dormACETab').click();await page.locator('#recruitAcePilot').click();
 const id='Pilot_EFSF_0079_N_ACE_YDR';await page.locator('[data-ace-id="'+id+'"] .ace-candidate-content').click();await expect(page.locator('#confirmRecruitAce')).toBeDisabled();
 await page.evaluate(()=>{Economy.meetLiaison('efsf');for(const id of ['efsf-1','efsf-2']){const t=ContactTasks.byId.get(id);Economy.acceptContactTask(id);Economy.creditAward({id:'ace-test-'+id,matchId:'ace-test-'+id,money:0,supplies:0,contactProgress:[{id,amount:t.required}]});Economy.completeContactTask(id);}});
 await page.locator('#aceRecruitDialog').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#recruitAcePilot').click();await page.locator('[data-ace-id="'+id+'"] .ace-candidate-content').click();await expect(page.locator('#confirmRecruitAce')).toBeEnabled();
 await expect(page.locator('#aceRecruitPrice')).toContainText('9,000');await expect(page.locator('#aceRecruitPrice')).toContainText('4,500');const before=await page.evaluate(()=>Economy.snapshot());
 await page.locator('#confirmRecruitAce').click();const after=await page.evaluate(()=>Economy.snapshot());expect(before.money-after.money).toBe(9000);expect(before.supplies-after.supplies).toBe(4500);
 const pilotId=await page.evaluate(id=>{const key='projectgreed.custom-pilots.v3.shared',store=SaveCodec.parse(localStorage.getItem(key)),p=store.pilots.find(p=>p.aceId===id);store.pilots=store.pilots.map(q=>q.id===p.id?PilotSystem.custom({...q,level:3,stats:undefined,needsRecruitment:true}):q);localStorage.setItem(key,SaveCodec.stringify(store));return p.id;},id);
 await page.reload();await page.waitForFunction(()=>assetsReady);await page.locator('#shellHangar').click();await page.locator('#shellPilots').click();await page.locator('#dormACETab').click();const balance=await page.evaluate(()=>Economy.snapshot());
 await page.locator('.dorm-card[data-pilot-id="'+pilotId+'"] .dorm-card-state').click();await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();
 const restored=await page.evaluate(id=>{const p=SaveCodec.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots.find(p=>p.id===id);return {p,wallet:Economy.snapshot()};},pilotId);
 expect(restored.p.needsRecruitment).toBe(false);expect(restored.p.level).toBe(3);expect(restored.wallet.money).toBe(balance.money);expect(balance.supplies-restored.wallet.supplies).toBe(3000);
});
