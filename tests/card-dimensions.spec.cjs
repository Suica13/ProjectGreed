const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const kits = require('../shared/production-data.cjs').defaultKits;
for (const width of [1440, 390, 360]) test(`unit lists keep equal card dimensions at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height:960});
  await page.addInitScript(kits => {
    const ids = ['Type61', 'Type74', 'RGC_80', 'MedeaKai', 'RGM_79'];
    localStorage.setItem('slg-formations-v1.PMC', JSON.stringify({version:3,squads:[{name:'Cards',units:ids.map(unitId => ({unitId,kitId:kits[unitId],...(unitId==='RGM_79'?{preload:{carrierIndex:3,hangarId:'Hangar_1'}}:{})}))}]}));
    localStorage.setItem('projectgreed.economy.v1', JSON.stringify({schemaVersion:3,money:10000,supplies:20000,licenses:Object.fromEntries(ids.map(id=>[id,true])),inventory:Object.fromEntries(ids.map(id=>[id,1])),kits:Object.fromEntries(ids.map(id=>[id+'__'+kits[id],1]))}));
  }, kits);
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(() => typeof assetsReady !== 'undefined' && assetsReady);
  await page.evaluate(() => { I18n.setLanguage('zh'); MenuShell.go('encyclopedia'); });
  async function equal(selector, name) {
    const cards=page.locator(selector);
    await expect(cards.first()).toBeVisible();
    const sizes=await cards.evaluateAll(cards => cards.map(c => ({id:c.dataset.unitId||c.querySelector('[data-unit-id]')?.dataset.unitId, scroll:c.scrollHeight,client:c.clientHeight,w:c.getBoundingClientRect().width,h:c.getBoundingClientRect().height,overflow:c.scrollWidth>c.clientWidth+1,vertical:c.scrollHeight>c.clientHeight+1})));
    expect(sizes.length).toBeGreaterThan(2);
    expect(new Set(sizes.map(s=>s.h)).size, name+' heights').toBe(1);
    expect(new Set(sizes.map(s=>s.w)).size, name+' widths').toBe(1);
    const ceiling = width > 1100 ? {encyclopedia:152,workshop:128,formation:144,picker:152} : {encyclopedia:168,workshop:160,formation:192,picker:188};
    expect(Math.min(...sizes.map(s=>s.h)),name+' height').toBeGreaterThan(50);
    expect(sizes.some(s=>s.overflow),name+' overflow').toBe(false);
    expect(sizes.filter(s=>s.vertical),name+' vertical overflow').toEqual([]);
    await cards.first().screenshot({path:`tmp/verification/screenshots/${name}-equal-${width}.png`});
  }
  await equal('#encyclopediaList > .encyclopedia-unit','encyclopedia');
  await page.evaluate(() => MenuShell.go('production'));
  await equal('#productionList > .production-unit','workshop');
  await page.evaluate(() => MenuShell.go('formation'));
  await equal('#formationUnits > .formation-row','formation');
  await expect(page.locator('#formationUnits > .formation-hangar-divider')).toHaveCount(0);
  const positions=await page.locator('#formationUnits > .formation-row').evaluateAll(rows=>rows.map(row=>({x:row.getBoundingClientRect().x,y:row.getBoundingClientRect().y})));
  expect(positions[0].y === positions[1].y).toBe(width > 1100);
  const pilot=page.locator('#formationUnits .formation-pilot-button').first();
  await expect(pilot).toHaveCSS('text-align','center');
  await expect(pilot.locator('.pilot-name-viewport')).toHaveCount(0);
  await page.locator('#formationUnits').screenshot({path:`tmp/verification/screenshots/formation-compact-list-${width}.png`});
  await page.locator('#openFormationPicker').click();
  await equal('#formationCatalog > .catalog-unit-row','picker');
  expect(await page.locator('#formationCatalog').evaluate(list => parseFloat(getComputedStyle(list).rowGap))).toBeLessThanOrEqual(3);
});
