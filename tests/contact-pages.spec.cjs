const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const [width,height] of [[1440,960],[390,960],[390,640]])test('UC and CE contact frames without scrolling '+width+'x'+height,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('Contact PMC');await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(()=>I18n.setLanguage('zh'));
  await expect(page.locator('#shellMissions')).toBeEnabled();
  await expect(page.locator('#shellMissions')).toContainText('联络');
  await page.locator('#shellMissions').click();
  await expect(page.locator('#contactTasks')).toBeVisible();
  await expect(page.locator('#contactMerchants')).toBeHidden();
  await page.locator('#shellContactMerchants').click();
  await expect(page.locator('#contactTasks')).toBeHidden();
  await expect(page.locator('#contactMerchants')).toBeVisible();
  await expect(page.locator('.merchant-card')).toHaveCount(5);
  const layout=await page.locator('.merchant-card').evaluateAll(async cards=>{
    for(const image of cards.flatMap(card=>[...card.querySelectorAll('img')]))await image.decode();
    return cards.map(card=>{const r=card.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,portrait:!!card.querySelector('.merchant-portrait'),info:card.querySelector('.merchant-information').textContent};});
  });
  expect(layout.slice(0,3).every(card=>card.portrait&&card.info.includes('好感度0.0等级Lv1'))).toBe(true);
  expect(layout.slice(3).every(card=>card.info.includes('未解锁')&&!card.info.includes('解锁条件')&&!card.info.includes('好感度'))).toBe(true);
  expect(layout[1].x).toBeGreaterThan(layout[0].x+layout[0].w);
  await expect(page.locator('.contact-era-frame[data-era="UC"] .merchant-card')).toHaveCount(3);
  await expect(page.locator('.contact-era-frame[data-era="CE"] .merchant-card')).toHaveCount(2);
  const fitting=await page.locator('.contact-content').evaluate(node=>({
    fits:node.scrollHeight<=node.clientHeight&&node.scrollWidth<=node.clientWidth,
    overflow:getComputedStyle(node).overflow,
    cardsFit:[...node.querySelectorAll('.merchant-card')].every(card=>{
      const r=card.getBoundingClientRect(),p=node.getBoundingClientRect();return r.bottom<=p.bottom&&r.right<=p.right;
    }),
    equalCards:['width','height'].every(key=>{
      const sizes=[...node.querySelectorAll('.merchant-card')].map(card=>card.getBoundingClientRect()[key]);
      return Math.max(...sizes)-Math.min(...sizes)<1;
    }),
    imagesFit:[...node.querySelectorAll('.merchant-portrait img')].every(image=>{
      const r=image.getBoundingClientRect(),p=image.parentElement.getBoundingClientRect();
      return r.top>=p.top&&r.left>=p.left&&r.right<=p.right&&r.bottom<=p.bottom;
    }),
  }));
  expect(fitting).toEqual({fits:true,overflow:'hidden',cardsFit:true,equalCards:true,imagesFit:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/contact-merchants-${width}x${height}.png`});
  await page.locator('#shellHangar').click();await expect(page.locator('#contactScreen')).toBeHidden();
  await page.locator('#shellMissions').click();await expect(page.locator('#contactTasks')).toBeVisible();
  expect(errors).toEqual([]);
});
