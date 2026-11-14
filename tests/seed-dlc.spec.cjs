const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`SEED technology, PS textures and CE room settings at ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{byId('openDevelopment').click();});
  await page.locator('#developmentFactionSelect').selectOption('OMNI');
  await expect(page.locator('#developmentTree .development-node')).toHaveCount(6);
  await page.locator('#developmentFactionSelect').selectOption('ZAFT');
  await expect(page.locator('#developmentTree .development-node')).toHaveCount(7);
  const textures=await page.evaluate(async()=>{
    const model='GAT_X105__'+Economy.defaultKit('GAT_X105');
    await SpriteRenderer.ensureModels([model]);
    const layers=active=>SpriteRenderer.visibleLayers(model,null,true,false,'Common_Idle',0,true,{},false,false,'ground',null,null,false,false,active);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=384;
    const ctx=canvas.getContext('2d');
    function draw(active){
      ctx.clearRect(0,0,384,384);SpriteRenderer.beginFrame();
      SpriteRenderer.draw(ctx,model,192,192,2,0,'Common_Idle',0,null,true,true,false,{},0,false,false,'ground',null,null,false,null,false,false,[],512,active);
      SpriteRenderer.endFrame();return canvas.toDataURL();
    }
    return {on:layers(true).map(l=>l.texture),off:layers(false).map(l=>l.texture),different:draw(true)!==draw(false)};
  });
  expect(textures.on.some(t=>t.startsWith('PS__'))).toBeTruthy();
  expect(textures.on.some(t=>t.startsWith('NoPS__'))).toBeFalsy();
  expect(textures.off.some(t=>t.startsWith('NoPS__'))).toBeTruthy();
  expect(textures.off.some(t=>t.startsWith('PS__'))).toBeFalsy();
  expect(textures.different).toBeTruthy();
  await page.locator('#developmentFactionSelect').press('Escape');
  await page.evaluate(()=>{byId('offlineRoomMode').value='sweep';LocalRoom.open();});
  await expect(page.locator('#roomPreparation')).toBeVisible();
  await page.evaluate(()=>Net.request('configure_room',{...Net.snapshot.settings,sweepEra:'CE_0071_T1',sweepFaction:'ZAFT'}));
  await page.waitForFunction(()=>Net.snapshot.settings.sweepEra==='CE_0071_T1');
  await expect(page.locator('#sweepEra')).toHaveValue('CE_0071_T1');
  await expect(page.locator('#sweepFaction')).toHaveValue('ZAFT');
  expect(errors).toEqual([]);
});

test('standalone map editor loads the shared UC/CE era module',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/map-editor.html')).href);
  expect(await page.evaluate(()=>TechnologyEras.weight('CE_0071_T1'))).toBe(1);
  expect(await page.evaluate(()=>TechnologyEras.eras.includes('UC_0093_T1'))).toBeTruthy();
  expect(errors).toEqual([]);
});
