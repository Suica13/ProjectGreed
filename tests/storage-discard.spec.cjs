const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390]) test(`depot removal confirms and persists at ${width}px`,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:960});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{
    I18n.setLanguage('zh');
    const pilot=PilotSystem.createCustom('custom-depot-test','保管测试');pilot.inDormStorage=true;
    localStorage.setItem('projectgreed.custom-pilots.v3.shared',JSON.stringify({pilots:[pilot],awards:[]}));
    Economy.creditActivity({id:'depot-ui',matchId:'depot-ui',money:0,supplies:0,inventory:{RGM_79:40}});
  });
  await page.reload();await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>MenuShell.go('warehouse'));
  await page.locator('#warehouseDeliveries').click();
  const rows=page.locator('#warehouseDialog [data-delivery-index]'),count=await rows.count();
  expect(count).toBeGreaterThan(1);
  await rows.first().getByRole('button',{name:'移除',exact:true}).click();
  await page.locator('#gameDialog').getByRole('button',{name:'取消',exact:true}).click();
  await expect(rows).toHaveCount(count);
  await rows.first().getByRole('button',{name:'移除',exact:true}).click();
  await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();
  await expect(rows).toHaveCount(count-1);
  await page.locator('#warehouseDialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>MenuShell.go('pilots'));
  await page.locator('#dormPMCStorage').click();
  const pilot=page.locator('#dormStorageDialog [data-pilot-id="custom-depot-test"]');
  await pilot.getByRole('button',{name:'移除',exact:true}).click();
  await page.locator('#gameDialog').getByRole('button',{name:'取消',exact:true}).click();
  await expect(pilot).toBeVisible();
  await pilot.getByRole('button',{name:'移除',exact:true}).click();
  await page.locator('#gameDialog').getByRole('button',{name:'确认',exact:true}).click();
  await expect(pilot).toHaveCount(0);
  const state=await page.evaluate(()=>({count:Economy.snapshot().storage.deliveries.length,
    pilots:JSON.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots}));
  expect(state.count).toBe(count-1);expect(state.pilots.some(p=>p.id==='custom-depot-test')).toBe(false);
  expect(errors).toEqual([]);
});
