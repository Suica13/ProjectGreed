const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const width of [1600,390])for(const mapId of ['battlefield_twin_ridges','battlefield_ruined_basin'])
test(`0087 battle deploys and renders on ${mapId} at ${width}px`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:width===390?844:1000});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.evaluate(()=>{
    const original=createRoomEngine;
    createRoomEngine=options=>(window.v102Engine=original({...options,aiDelayMs:999999}));
    Formation.current=()=>[{unitId:'Type61',kitId:'standard'}];
  });
  await page.locator('#openSkirmish').click();
  await page.locator('#offlineRoomMode').selectOption('battlefield');
  await page.locator('#createOfflineRoom').click();
  if(width===390)await page.getByRole('button',{name:'房间设置',exact:true}).click();
  await page.locator('#roomMapSelect').selectOption(mapId);
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.mapId)).toBe(mapId);
  await page.locator('#battlefieldScalePreset').selectOption('0087T2-standard');
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.battlefieldTeams[0].era)).toBe('0087T2');
  expect(await page.evaluate(()=>Rules.getMap(Net.snapshot.settings.mapId).spawns.length)).toBe(12);
  if(width===390)await page.locator('#closeRoomSettingsSheet').click();
  await page.locator('#startRoomGame').click();
  await expect(page.locator('#confirmFinalFormation')).toBeVisible();
  await page.locator('#confirmFinalFormation').click();
  await expect(page.locator('#confirmDeployment')).toBeVisible();
  await page.locator('#confirmDeployment').click();
  await expect(page.locator('#battlefieldStatus')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!BattleAssets.loading&&Net.canAct())).toBe(true);
  await page.evaluate(()=>{game.fogMode='disabled';MapCamera.setPercent(1);drawMap(performance.now());});
  await expect.poll(()=>page.evaluate(()=>TileMapRenderer.cacheStats().chunks)).toBeGreaterThan(0);
  const state=await page.evaluate(()=>({map:game.mapId,slots:Rules.getMap(game.mapId).spawns.length,
    factions:game.battlefield.teams,units:game.units.length,points:game.battlefield.points.length,
    towers:game.units.filter(u=>u.facility?.type==='machineGun').map(u=>({level:u.facility.level,hp:u.hp,name:Rules.modelOf(u).name}))}));
  expect(state.map).toBe(mapId);expect(state.slots).toBe(12);expect(state.units).toBeGreaterThan(12);
  expect(state.factions.map(t=>t.faction)).toEqual(['AEUG','TITANS']);expect(state.points).toBe(4);
  expect(state.towers.every(t=>t.level===4&&t.hp===39063&&t.name.includes('Lv.4'))).toBe(true);
  await page.locator('#map').screenshot({path:`build/v102-${mapId}-${width}.png`});
  expect(errors).toEqual([]);
});
