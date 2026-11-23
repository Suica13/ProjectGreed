const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url'), path = require('node:path');
const { createServer } = require('../server');

for (const origin of ['file', 'http']) test(`retire test supply tokens on ${origin}, then preserve normal rewards and imports`, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width:390, height:844 });
  let app;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    let url=pathToFileURL(path.resolve('public/client.html')).href;
    if (origin==='http') {
      app=createServer({host:'127.0.0.1',port:0});
      const address=await app.listen();url='http://127.0.0.1:'+address.port;
    }
    await page.goto(url);await page.waitForFunction(()=>assetsReady);
    await page.locator('#profileCompanyName').fill('Clean supply test');
    await page.locator('#profileOnboardingConfirm').click();
    expect(await page.evaluate(()=>Economy.snapshot().itemInventory['0079t1-token']||0)).toBe(0);
    const before=await page.evaluate(()=>{
      I18n.setLanguage('zh');
      const saved=Economy.snapshot();saved.supplyTestGrant=true;
      saved.itemInventory={'0079t1-token':99999};
      localStorage.setItem(Economy.key,SaveCodec.stringify(saved));
      return {money:saved.money,supplies:saved.supplies,storage:JSON.stringify(saved.storage)};
    });
    await page.reload();await page.waitForFunction(()=>assetsReady);
    const read=()=>page.evaluate(()=>{
      const saved=Economy.snapshot(),raw=SaveCodec.parse(localStorage.getItem(Economy.key));
      return {tokens:saved.itemInventory['0079t1-token']||0,marked:raw.supplyTestGrant===true,
        money:saved.money,supplies:saved.supplies,storage:JSON.stringify(saved.storage)};
    });
    expect(await read()).toEqual({...before,tokens:0,marked:false});
    await page.evaluate(()=>MenuShell.go('contactSupply'));
    await expect(page.locator('#supplyTokenCount')).toHaveText('◈ 0');
    await expect(page.locator('#supplyDrawOnce')).toBeDisabled();
    await expect(page.locator('#supplyDrawTen')).toBeDisabled();
    await page.evaluate(()=>Economy.creditActivity({id:'normal-tokens',matchId:'normal-tokens',money:0,supplies:0,itemInventory:{'0079t1-token':123}}));
    await expect(page.locator('#supplyDrawTen')).toBeEnabled();
    await page.reload();await page.waitForFunction(()=>assetsReady);
    expect((await read()).tokens).toBe(123);
    await page.evaluate(()=>{
      const archive=ProfileSave.exportData();
      archive.economy.supplyTestGrant=true;archive.economy.itemInventory={'0079t1-token':100006};
      ProfileSave.importData(archive);
    });
    await page.reload();await page.waitForFunction(()=>assetsReady);
    expect((await read()).tokens).toBe(7);
    await page.evaluate(()=>Economy.creditActivity({id:'legitimate-balance',matchId:'legitimate-balance',money:0,supplies:0,itemInventory:{'0079t1-token':99992}}));
    await page.reload();await page.waitForFunction(()=>assetsReady);
    expect((await read()).tokens).toBe(99999);
    expect(errors).toEqual([]);
  } finally {if(app)await app.close();}
});
