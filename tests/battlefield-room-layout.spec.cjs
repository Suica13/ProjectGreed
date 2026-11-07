const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
for (const width of [1600, 1000, 390]) test('separate battlefield settings and mode-specific map choices / '+width, async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({width,height:width===390?844:1000});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.locator('#openSkirmish').click();
  await page.locator('#offlineRoomMode').selectOption('battlefield');
  await page.locator('#createOfflineRoom').click();
  if (width===390) await page.getByRole('button',{name:'房间设置',exact:true}).click();
  const section=page.locator('#battlefieldRoomRules');
  await expect(section).toBeVisible();
  await expect(section.locator('summary')).toHaveText('雇佣兵战争模式设置');
  expect(await section.evaluate(el=>el.parentElement.id)).toBe('roomRulesPanel');
  await page.locator('#battlefieldRoomOptions').scrollIntoViewIfNeeded();
  const layout=await page.locator('#battlefieldRoomOptions').evaluate(panel=>{
    const root=panel.getBoundingClientRect();
    return [...panel.querySelectorAll('fieldset')].every(field=>{
      const rect=field.getBoundingClientRect();
      const selects=[...field.querySelectorAll('select')].map(el=>el.getBoundingClientRect());
      return rect.left>=root.left-1&&rect.right<=root.right+1&&
        selects.every(s=>s.left>=rect.left&&s.right<=rect.right+1&&s.top>=rect.top&&s.bottom<=rect.bottom+1)&&
        selects[0].right<=selects[1].left;
    });
  });
  expect(layout).toBe(true);
  expect(await page.locator('#roomSettingsPage').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'build/canyon-room-'+width+'.png'});
  expect(await page.locator('#battlefieldTeam0era option').evaluateAll(options => options.map(option => option.value))).toEqual(['0079T1','0079T2']);
  await page.locator('#battlefieldTeam0faction').selectOption('ZEON');
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.battlefieldTeams[0].faction)).toBe('ZEON');
  for (const mode of ['battlefield','regular','quick','campaign','battlefield']) {
    await page.locator('#roomBattleMode').selectOption(mode);
    await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.mode)).toBe(mode);
    await expect.poll(()=>page.locator('#roomMapSelect').evaluate((el,mode)=>{
      const expected=Object.values(Rules.catalog.maps).filter(map=>mode!=='campaign'&&map.scope!=='strategic'&&(map.supportedModes||['regular','quick']).includes(mode)).map(map=>map.id).sort();
      return JSON.stringify([...el.options].map(option=>option.value).sort())===JSON.stringify(expected);
    },mode)).toBe(true);
    if(mode==='campaign') {
      await expect(page.locator('#roomMapSelect')).toBeHidden();
      await expect(page.locator('#roomScenarioSelect')).toBeVisible();
    }
    if(mode==='battlefield') await expect(section).toBeVisible();
    else await expect(section).toBeHidden();
  }
  expect(errors).toEqual([]);
});
