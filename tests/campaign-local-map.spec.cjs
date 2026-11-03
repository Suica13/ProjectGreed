const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390]) for(const region of ['canada_east','north_atlantic'])
test('regional deployment at '+region+' / '+width+'px',async({page})=>{
 test.setTimeout(45000);
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 await page.evaluate(()=>{const original=createRoomEngine;createRoomEngine=options=>(window.mapTestEngine=original(options));});
 await page.locator('#openSkirmish').click();
 await page.locator('#offlineRoomMode').selectOption('campaign');
 await page.locator('#createOfflineRoom').click();
 await page.locator('#startRoomGame').click();
 await page.locator('.campaign-setup button').last().click();
 await expect(page.locator('#campaignScreen')).toBeVisible();
 await page.evaluate(region=>{
   const room=[...mapTestEngine.rooms.values()][0],s=room.campaign;
   const scenario=Rules.catalog.scenarios.earth_0079_mid;
   const layout=scenario.regions[region].layout;
   s.units=[];s.regions.find(r=>r.id===region).owner=0;
   const ctx={G:Rules,production:PRODUCTION_CATALOG};
   CampaignRules.addUnit(ctx,s,0,region,region==='north_atlantic'?'FF_X7':'Type61');
   const enemy=CampaignRules.addUnit(ctx,s,1,region,region==='north_atlantic'?'FF_X7':'MS_06F');
   enemy.entryFrom=layout.gates[0].region;
   s.regions.find(r=>r.id===enemy.entryFrom).owner=1;
   s.phase='encounters';s.encounters=[{region,turn:0,battleSave:null,roster:{},settled:[]}];
   room.revision++;mapTestEngine.broadcast(room);
 },region);
 const drawer=page.locator('#campaignEncounterDialog');
 await expect(drawer).toBeVisible();
 await drawer.getByRole('button',{name:'手动指挥',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Net.started)).toBe(true);
 const info=await page.evaluate(()=>{
   const g=Net.snapshot.game,m=Rules.getMap(g.mapId),f=g.campaignBattlefield;
   return {width:Rules.mapWidth(g),height:Rules.mapHeight(g),areas:m.deploymentAreas||null,
     valid:g.units.every(u=>Rules.campaignBattlefield.deploymentCells(Rules,g,u).some(c=>c.x===u.x&&c.y===u.y)),
     strip:m.geography.landingPlatforms.some(id=>id.startsWith('staging_'))};
 });
 expect(info).toEqual({width:43,height:51,areas:null,valid:true,strip:false});
 await expect(page.locator('#hudCampaignRegion')).toBeVisible();
 expect(errors).toEqual([]);
});
