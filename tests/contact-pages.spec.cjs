const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('contact tabs and horizontal merchant cards '+width,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>I18n.setLanguage('zh'));
  await expect(page.locator('#shellMissions')).toBeEnabled();
  await expect(page.locator('#shellMissions')).toContainText('联络');
  await page.locator('#shellMissions').click();
  await expect(page.locator('#contactTasks')).toBeVisible();
  await expect(page.locator('#contactMerchants')).toBeHidden();
  await page.locator('#shellContactMerchants').click();
  await expect(page.locator('#contactTasks')).toBeHidden();
  await expect(page.locator('#contactMerchants')).toBeVisible();
  await expect(page.locator('.merchant-card')).toHaveCount(3);
  const layout=await page.locator('.merchant-card').evaluateAll(async cards=>{
    for(const image of cards.flatMap(card=>[...card.querySelectorAll('img')]))await image.decode();
    return cards.map(card=>{const r=card.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,portrait:!!card.querySelector('.merchant-portrait'),info:card.querySelector('.merchant-information').textContent};});
  });
  expect(layout.every(card=>card.y===layout[0].y&&card.portrait&&card.info.includes('好感度0等级Lv1'))).toBe(true);
  expect(layout[1].x).toBeGreaterThan(layout[0].x+layout[0].w);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/contact-merchants-${width}.png`});
  await page.locator('#shellHangar').click();await expect(page.locator('#contactScreen')).toBeHidden();
  await page.locator('#shellMissions').click();await expect(page.locator('#contactTasks')).toBeVisible();
  expect(errors).toEqual([]);
});
