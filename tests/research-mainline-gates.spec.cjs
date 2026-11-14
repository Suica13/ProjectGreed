const {test,expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
for (const width of [1440,390]) test(`main-line tree gates and their explanations at ${width}px`, async ({page}) => {
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>byId('openDevelopment').click());
  const picker=page.locator('#developmentFactionSelect');
  for (const [faction,hint] of [
    ['AEUG','请先完成地球联邦军科技树主线'],['TITANS','请先完成地球联邦军科技树主线'],
    ['NEO_ZEON','请先完成吉翁公国军科技树主线'],['EFSF_0093','请先完成奥古或提坦斯任一科技树主线'],
    ['NEO_ZEON_0093','请先完成新吉翁科技树主线'],
  ]) {
    await picker.selectOption(faction);
    await expect(page.locator('.development-era-lock')).toHaveText(hint);
    expect(await page.evaluate(f=>Development.research(f,Development.nodes(f)[0].id),faction)).toBe(false);
    await expect(page.locator('#developmentDetails > button')).toBeDisabled();
  }
  async function complete(faction) {
    expect(await page.evaluate(f=>{
      Development.creditAward({id:'main_'+f,matchId:'main_gates',faction:f,points:1000000});
      for (const node of Development.nodes(f).filter(n=>n.row==='mid')) {
        if (!Development.unlockedTech(f).includes(node.id) && !Development.research(f,node.id)) return false;
      }
      return Development.mainlineComplete(f);
    },faction)).toBe(true);
  }
  await complete('EFSF');
  for (const f of ['AEUG','TITANS']) {
    await picker.selectOption(f);await expect(page.locator('.development-era-lock')).toHaveCount(0);
  }
  await picker.selectOption('NEO_ZEON');await expect(page.locator('.development-era-lock')).toHaveCount(1);
  await complete('AEUG');
  await picker.selectOption('EFSF_0093');await expect(page.locator('.development-era-lock')).toHaveCount(0);
  await expect(page.locator('#developmentTree .development-node')).toHaveCount(4);
  await complete('ZEON');await complete('NEO_ZEON');
  await picker.selectOption('NEO_ZEON_0093');await expect(page.locator('.development-era-lock')).toHaveCount(0);
  expect(errors).toEqual([]);
});
