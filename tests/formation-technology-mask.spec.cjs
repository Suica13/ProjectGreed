const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390]) test(`room technology masks draft and hangar picker at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950});
  await page.addInitScript(()=>{
    localStorage.setItem('projectgreed.language','zh');
    localStorage.setItem('projectgreed.economy.v1',JSON.stringify({schemaVersion:3,money:10000,supplies:20000,
      licenses:{Medea:true,RX_178_AEUG:true},inventory:{Medea:5,RX_178_AEUG:5}}));
    localStorage.setItem('slg-formations-v1.PMC',JSON.stringify({version:3,squads:[{name:'Technology test',units:[
      {unitId:'Medea',kitId:'standard'},
      {unitId:'RX_178_AEUG',kitId:'kit_2',preload:{carrierIndex:0,hangarId:'Hangar_1'}}]}]}));
  });
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{document.getElementById('offlineRoomMode').value='quick';LocalRoom.open();});
  await page.evaluate(()=>Net.request('configure_room',{...Net.snapshot.settings,costLimit:5000,technologyLimitMode:'custom',technologyLimit:0,regularEra:'0087T2'}));
  await page.waitForFunction(()=>Net.snapshot.settings.technologyLimitMode==='custom');
  await page.locator('#roomFormation').click();
  const draft=page.locator('#formationUnits [data-formation-index="1"]');
  await expect(draft.locator('.overcost-label')).toHaveText('超出科技点');
  await expect(draft.locator('.disabled-panel')).toHaveCSS('background-color','rgba(0, 0, 0, 0.72)');
  await page.locator('[data-add-hangar-carrier="0"]').first().click();
  await page.locator('#formationSearch').fill('MK');
  const card=page.locator('#formationCatalog .catalog-unit-row').filter({has:page.locator('[data-unit-id="RX_178_AEUG"]')});
  await expect(card.locator('.overcost-label')).toHaveText('超出科技点');
  await card.locator('.catalog-unit').click();
  await expect(page.locator('#addFormationUnit')).toBeDisabled();
  // Changes to the room cap must invalidate the cached picker, without closing it.
  await page.evaluate(()=>Net.request('configure_room',{...Net.snapshot.settings,technologyLimit:999999}));
  await expect(card.locator('.disabled-panel')).toHaveCount(0);
  await expect(draft.locator('.disabled-panel')).toHaveCount(0);
  await expect(page.locator('#addFormationUnit')).toBeEnabled();
});
