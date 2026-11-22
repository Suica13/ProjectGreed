const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('encyclopedia lists searchable read-only plugin cards '+width,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:1050});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Catalog PMC');await page.locator('#profileOnboardingConfirm').click();await page.evaluate(()=>I18n.setLanguage('zh'));
  const before=await page.evaluate(()=>Economy.snapshot());
  await page.locator('#shellCatalog').click();await page.locator('#encyclopediaPluginsTab').click();
  await expect(page.locator('#encyclopediaPluginsTab')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#encyclopediaList .encyclopedia-plugin')).toHaveCount(33);await expect(page.locator('#encyclopediaCount')).toHaveText('33');
  for(const name of ['Faction','Era','Type','Status','Level'])await expect(page.locator('#encyclopedia'+name)).toBeHidden();
  const cards=await page.locator('.encyclopedia-plugin').evaluateAll(async cards=>{
    for(const card of cards)await card.querySelector('img').decode();
    return cards.map(card=>({icon:card.querySelector('img').naturalWidth,cost:!!card.querySelector('.plugin-cost'),rarity:!!card.querySelector('.plugin-rarity'),description:!!card.querySelector('.plugin-effect'),overflow:card.scrollWidth>card.clientWidth+1}));
  });expect(cards.every(card=>card.icon===64&&card.cost&&card.rarity&&card.description&&!card.overflow)).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/encyclopedia-plugins-${width}.png`});
  await page.locator('#encyclopediaSearch').fill('frame');await expect(page.locator('.encyclopedia-plugin')).toHaveCount(1);await expect(page.locator('.encyclopedia-plugin')).toContainText('强化骨架');
  await page.locator('#encyclopediaSearch').fill('不存在的零件');await expect(page.locator('#encyclopediaCount')).toHaveText('0');await expect(page.locator('#encyclopediaList')).toContainText('没有符合筛选的内容');
  await page.locator('#encyclopediaSearch').fill('');await page.locator('#encyclopediaUnitsTab').click();await expect(page.locator('#encyclopediaFaction')).toBeVisible();await expect(page.locator('#encyclopediaList')).toHaveAttribute('data-tab','units');
  expect(await page.evaluate(()=>Economy.snapshot())).toEqual(before);expect(errors).toEqual([]);
});
