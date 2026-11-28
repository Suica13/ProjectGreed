const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('dismiss confirmation clears assignment and ACE growth; LV3 gates '+width,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('V154 test');await page.locator('#profileOnboardingConfirm').click();
 const aceId='Pilot_EFSF_0079_N_ACE_YDR';
 const pilotId=await page.evaluate(id=>{
  const p=PilotSystem.custom({...PilotSystem.createAce(id),level:3,experience:5000,stats:undefined}),s=Economy.snapshot();s.money=s.supplies=1000000;for(const k in s.baseFacilities.levels)s.baseFacilities.levels[k]=2;
  s.contactIntro=true;s.contactTasks=ContactTasks.tasks.map(t=>({id:t.id,status:'claimed',progress:t.required,progressVersion:t.progressVersion}));
  const m=UnitModels.RGM_79__machine_gun;s.storage.units=[];s.storage.ships=[];s.storage.deliveries=[];s.inventory={RGM_79:1};s.kits={};s.storage.units.push({id:'dismiss-stock',unitId:'RGM_79',kitId:'machine_gun',slot:0,hp:m.hp,en:m.en,pilotId:p.id});
  localStorage.setItem(Economy.key,SaveCodec.stringify(s));localStorage.setItem('projectgreed.custom-pilots.v3.shared',SaveCodec.stringify({pilots:[p],awards:[]}));return p.id;
 },aceId);
 await page.reload();await page.waitForFunction(()=>assetsReady);await page.locator('#shellHangar').click();await page.locator('#shellPilots').click();await page.locator('#dormACETab').click();
 await page.locator('.dorm-card[data-pilot-id="'+pilotId+'"]').click();const dismiss=page.locator('#dismissCustomPilot');await expect(dismiss).toBeVisible();
 const a=await dismiss.boundingBox(),b=await page.locator('#finishCustomPilot').boundingBox();expect(a.x+a.width).toBeLessThanOrEqual(b.x+1);
 await dismiss.click();await expect(page.locator('#gameDialog')).toContainText('重新招募此ACE');await page.locator('#gameDialog').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('#customPilotPanel')).toBeVisible();
 expect(await page.evaluate(()=>SaveCodec.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots.length)).toBe(1);
 await dismiss.click();await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();await expect(page.locator('#customPilotPanel')).toBeHidden();
 expect(await page.evaluate(()=>Economy.snapshot().storage.units.find(u=>u.id==='dismiss-stock').pilotId)).toBe(null);
 await page.reload();await page.waitForFunction(()=>assetsReady);expect(await page.evaluate(()=>SaveCodec.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots.length)).toBe(0);
 await page.locator('#shellHangar').click();await page.locator('#shellPilots').click();await page.locator('#dormACETab').click();await page.locator('#recruitAcePilot').click();await page.locator('[data-ace-id="'+aceId+'"] .ace-candidate-content').click();
 await expect(page.locator('#aceRecruitPrice')).toContainText('9,000');const before=await page.evaluate(()=>Economy.snapshot());await page.locator('#confirmRecruitAce').click();
 const result=await page.evaluate(()=>({p:SaveCodec.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots[0],s:Economy.snapshot()}));expect(result.p.level).toBe(0);expect(result.p.experience).toBe(0);expect(before.money-result.s.money).toBe(9000);expect(before.supplies-result.s.supplies).toBe(4500);
 await page.evaluate(()=>BaseFacilitiesUI.open());await page.locator('[data-facility-upgrade="hq"]').click();await expect(page.locator('#facilityDialog')).toContainText('权必有责');await expect(page.locator('#confirmFacilityUpgrade')).toBeEnabled();await page.locator('#confirmFacilityUpgrade').click();expect(await page.evaluate(()=>Economy.snapshot().baseFacilities.levels.hq)).toBe(3);
 await page.locator('[data-facility-upgrade="academy"]').click();await expect(page.locator('#confirmFacilityUpgrade')).toBeEnabled();await page.locator('#closeFacilityDialog').click();await page.locator('[data-facility-upgrade="beacon"]').click();await expect(page.locator('#confirmFacilityUpgrade')).toBeDisabled();
 await page.screenshot({path:`tmp/verification/screenshots/v154-facilities-${width}.png`});expect(errors).toEqual([]);
});
