const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
for (const width of [1440, 390, 360]) test(`workshop aligns identity to portrait and prioritizes research state at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:960});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>typeof assetsReady!=='undefined'&&assetsReady);
  await page.evaluate(()=>{
    I18n.setLanguage('zh');
    const states={Type61:[false,false],Type74:[true,false],RGC_80:[false,true],MedeaKai:[true,true]};
    const allows=Development.allows, license=Economy.hasLicense;
    Development.allows=(f,id,...args)=>states[id]?states[id][0]:allows(f,id,...args);
    Economy.hasLicense=id=>states[id]?states[id][1]:license(id);
    MenuShell.go('production');
  });
  for (const [id,status] of [['Type61','未开发'],['Type74','未许可'],['RGC_80','未开发'],['MedeaKai',null]]) {
    const card=page.locator(`#productionList [data-unit-id="${id}"]`);
    await expect(card).toHaveCount(1);
    const flag=card.locator('.unit-portrait-status');
    if(status) { await expect(flag).toHaveText(status); await expect(flag).toHaveCSS('color','rgb(255, 184, 187)'); }
    else await expect(flag).toHaveCount(0);
    const geometry=await card.evaluate(c=>({image:c.querySelector('.production-unit-portrait > img').getBoundingClientRect().top,text:c.querySelector('.production-unit-info').getBoundingClientRect().top}));
    expect(Math.abs(geometry.image-geometry.text)).toBeLessThanOrEqual(1);
  }
  await page.locator('#productionSearch').fill('Type');
  await page.locator('#productionList').screenshot({path:`tmp/verification/screenshots/v85-workshop-${width}.png`});
});
