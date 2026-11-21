const {test,expect}=require('@playwright/test');const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('reference panel shares owned preview geometry and has read-only hangar properties '+width,async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:960});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'reference-panel-layout',matchId:'reference-panel-layout',money:100000,supplies:100000,inventory:{WhiteBase:1}});});
 await page.locator('#shellHangar').click();await page.locator('#warehouseShips').click();await page.locator('.warehouse-bay[data-slot="0"]').first().click();
 await expect(page.locator('#warehouseDialog')).toBeVisible();
 const owned=await page.locator('#warehouseDialog').evaluate(node=>{
  const preview=node.querySelector('.warehouse-detail-preview').getBoundingClientRect(),action=node.querySelector('#warehouseRelocate').getBoundingClientRect(),canvas=node.querySelector('canvas');
  const image=canvas.getBoundingClientRect();return {width:preview.width,height:preview.height,bottom:preview.bottom,actionBottom:action.bottom,imageWidth:image.width,imageHeight:image.height,zoom:canvas.dataset.cardZoom,scale:canvas.dataset.previewScale};
 });
 if(width>720)expect(Math.abs(owned.bottom-owned.actionBottom)).toBeLessThan(1);
 await expect(page.locator('#warehouseClose')).toHaveText('关闭');
 await page.locator('#warehouseOpenCatalog').click();await expect(page.locator('#formationUnitDetail')).toBeVisible();
 await expect(page.locator('#producePreviewUnit')).toHaveCount(0);await expect(page.locator('#sellPreviewUnit')).toHaveCount(0);
 await expect(page.locator('#formationDetailHangars button')).toHaveCount(0);await expect(page.locator('#formationDetailHangarsBlock h3')).toHaveText('格纳库属性');
 await expect(page.locator('#formationDetailHangars')).not.toContainText('预先搭载');await expect(page.locator('#closeFormationDetail')).toHaveText('关闭');
 const reference=await page.locator('#formationUnitDetail').evaluate(node=>{
  const preview=node.querySelector('.unit-detail-preview-box').getBoundingClientRect(),dialog=node.querySelector('.formation-detail-dialog').getBoundingClientRect(),header=node.querySelector('header').getBoundingClientRect(),canvas=node.querySelector('canvas'),image=canvas.getBoundingClientRect();
  const stats=getComputedStyle(node.querySelector('#formationDetailStats'));
  return {width:preview.width,height:preview.height,imageWidth:image.width,imageHeight:image.height,zoom:canvas.dataset.cardZoom,scale:canvas.dataset.previewScale,headerLeft:header.left-dialog.left,headerRight:dialog.right-header.right,statsColumns:stats.gridTemplateColumns.split(' ').length};
 });
 expect(reference.width).toBeCloseTo(owned.width,0);expect(reference.height).toBeCloseTo(owned.height,0);expect(reference.imageWidth).toBeCloseTo(owned.imageWidth,0);expect(reference.imageHeight).toBeCloseTo(owned.imageHeight,0);expect(reference.zoom).toBe(owned.zoom);expect(reference.scale).toBe(owned.scale);
 expect(reference.headerLeft).toBeLessThan(3);expect(reference.headerRight).toBeLessThan(20);expect(reference.statsColumns).toBe(2);
 await page.screenshot({path:`tmp/verification/screenshots/reference-panel-layout-${width}.png`});expect(errors).toEqual([]);
 await page.locator('#closeFormationDetail').click();await expect(page.locator('#warehouseDialog')).toBeVisible();
});
