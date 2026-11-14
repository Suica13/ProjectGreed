const {test,expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const tree = require('../shared/development-tree.json');
for (const width of [1440,390]) test(`research faction names, colors and 0093 unlocks at ${width}px`, async ({page}) => {
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  await page.addInitScript(researched=>localStorage.setItem('projectgreed.developmentProgress.v1',JSON.stringify({points:{},claimed:{},researched})),
    Object.fromEntries(['EFSF','ZEON','AEUG','NEO_ZEON'].map(f=>[f,tree[f].filter(n=>n.row==='mid').map(n=>n.id)])));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>byId('openDevelopment').click());
  for (const faction of ['EFSF','ZEON','TITANS','AEUG','NEO_ZEON','EFSF_0093','NEO_ZEON_0093','OMNI','ZAFT']) {
    await page.locator('#developmentFactionSelect').selectOption(faction);
    const actual=await page.evaluate(f=>({
      label:byId('developmentFactionSelect').selectedOptions[0].textContent,
      name:Rules.factionInfo[f].name,
      color:getComputedStyle(byId('developmentMain')).getPropertyValue('--dev-faction-mark').trim(),
      expected:Rules.factionInfo[f].color,
    }),faction);
    expect(actual.label).toBe(actual.name);
    expect(actual.color).toBe(actual.expected);
    if (faction.endsWith('_0093')) {
      await expect(page.locator('#developmentTree .development-node')).toHaveCount(4);
      await expect(page.locator('#developmentTree svg path')).toHaveCount(3);
      const positions=await page.locator('#developmentTree .development-node').evaluateAll(cards=>cards.map(c=>c.getBoundingClientRect().top));
      expect(positions.every((top,i)=>!i||top>positions[i-1])).toBe(true);
    }
  }
  const progress=await page.evaluate(()=>{
    const faction='EFSF_0093';
    Development.creditAward({id:'test0093',matchId:'test0093',faction,points:12000});
    Development.research(faction,'Tech_0093_EFSF_Mid02');
    Development.research(faction,'Tech_0093_EFSF_Recovery');
    Development.research(faction,'Tech_0093_EFSF_Mid03');
    return {points:Development.pointBalance(faction),nu:Development.allows('PMC','RX_93'),old:Development.pointBalance('EFSF'),exported:ProfileSave.exportData().development.points};
  });
  expect(progress.points).toBe(12000);
  expect(progress.old).toBe(0);
  expect(progress.nu).toBe(true);
  expect(progress.exported.EFSF_0093).toBe(12000);
  expect(errors).toEqual([]);
});
