const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('shared map scale and camera across storage, production and catalog at '+width,async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:960});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 if(await page.locator('#profileOnboardingConfirm').isVisible()){
  await page.locator('#profileCompanyName').fill('预览比例测试');
  await page.locator('#profileOnboardingConfirm').click();
 }
 await page.evaluate(()=>{
  const p=Economy.snapshot();p.inventory={};p.storage.units=[];p.storage.ships=[];p.storage.deliveries=[];
  p.baseFacilities.levels={hq:3,factory:3,giantFactory:3,beacon:3,academy:1};
  localStorage.setItem(Economy.key,SaveCodec.stringify(p));
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'preview-scale-fixture',matchId:'preview-scale-fixture',money:100000,supplies:100000,inventory:{RGM_79:1,MS_06F:1,RX_78GP03D:1,Medea:1,WhiteBase:1}});Economy.receiveDeliveries();});
 await page.locator('#shellHangar').click();
 await expect(page.locator('.warehouse-card-icon')).toHaveCount(3);
 await expect(page.locator('.warehouse-camera')).toHaveCount(0);
 await page.waitForFunction(()=>[...document.querySelectorAll('.warehouse-card-icon')].every(c=>c.dataset.cardReady==='true' && !!c.dataset.previewScale));
 await expect(page.locator('.warehouse-card-icon').first()).toHaveAttribute('data-preview-angle','180');
 const cardScales=await page.locator('.warehouse-card-icon').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardZoom));
 expect(cardScales.map(Number)).toEqual([1.15,1.15,0.5]);
 await expect(page.locator('.warehouse-card-zoom')).toHaveCount(0);
 await expect(page.locator('#warehouseDialog')).not.toBeVisible();
 await page.screenshot({path:`tmp/verification/screenshots/map-scale-storage-${width}.png`});
 await page.locator('#warehouseShips').click();
 await expect(page.locator('.warehouse-card-icon')).toHaveCount(2);
 await page.waitForFunction(()=>[...document.querySelectorAll('.warehouse-card-icon')].every(c=>c.dataset.cardReady==='true' && !!c.dataset.previewScale));
 expect(await page.locator('.warehouse-card-icon').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.cardZoom)))).toEqual([0.25,0.25]);
 await page.screenshot({path:`tmp/verification/screenshots/map-scale-dock-${width}.png`});
 await page.evaluate(()=>ProductionUI.openUnit('RGM_79',{returnView:'warehouse'}));
 await expect(page.locator('#productionPreview')).toHaveAttribute('data-preview-framing','map');
 await expect(page.locator('#productionPreview')).toHaveAttribute('data-preview-angle','180');
 await expect(page.locator('#productionPreview').locator('..').locator('.unit-preview-camera-controls')).toBeVisible();
 const before=await page.locator('#productionPreview').getAttribute('data-preview-scale');
 const kits=await page.locator('#productionKit option').evaluateAll(nodes=>nodes.map(n=>n.value));
 if(kits.length>1){await page.locator('#productionKit').selectOption(kits[1]);await page.waitForFunction(()=>SpriteRenderer.modelsReady([document.querySelector('#productionPreview').dataset.previewModel]));await expect(page.locator('#productionPreview')).toHaveAttribute('data-preview-scale',before);}
 await page.screenshot({path:`tmp/verification/screenshots/map-scale-production-${width}.png`});
 await page.evaluate(()=>Formation.previewUnit('MS_06F'));
 await expect(page.locator('#formationUnitDetail')).toBeVisible();
 await expect(page.locator('#formationDetailPreview')).toHaveAttribute('data-preview-framing','card');
 await expect(page.locator('#formationDetailPreview')).toHaveAttribute('data-preview-angle','180');
 const normalized=await page.evaluate(()=>{
  const a=document.querySelector('#productionPreview'),b=document.querySelector('#formationDetailPreview');
  return [a,b].map(c=>Number(c.dataset.previewScale)/(Math.min(c.width,c.height)-48)/UnitModels[c.dataset.previewModel].presentation.mapScale/(c.dataset.previewFraming==='card'?Number(c.dataset.cardZoom):UnitPreview.zoom(Warehouse.category(UnitModels[c.dataset.previewModel]))));
 });
 expect(normalized[0]).toBeCloseTo(normalized[1],8);
 expect(normalized[0]).toBeCloseTo(await page.evaluate(()=>ART.presentation.unitMapScale/160),8);
 await page.screenshot({path:`tmp/verification/screenshots/map-scale-catalog-${width}.png`});
 expect(errors).toEqual([]);
});
