const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');const path=require('node:path');
const url=pathToFileURL(path.resolve('public/client.html')).href;
for(const width of [1280,360])test(`wallet gifts, compact spacing, durable awards and live room startup at ${width}px`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});
 await page.goto(url);await page.waitForFunction(()=>assetsReady);await page.evaluate(()=>I18n.setLanguage('zh'));
 expect(await page.evaluate(()=>Economy.snapshot())).toEqual({money:5000,supplies:10000,inventory:{Type61:24,FF_B2:12,Medea:3,MS_06F:4,MS_06S:2,FatUncle:3},kits:{}});
 const geometry=await page.evaluate(()=>{
  const money=byId('menuResources').querySelector('.resource-money').getBoundingClientRect();
  const supplies=byId('menuResources').querySelector('.resource-supplies').getBoundingClientRect();
  return {gap:supplies.x-money.right,rows:Math.abs(money.y-supplies.y),overflow:document.documentElement.scrollWidth>innerWidth};
 });
 expect(geometry.gap).toBeGreaterThan(0);expect(geometry.gap).toBeLessThanOrEqual(18);expect(geometry.rows).toBeLessThan(2);expect(geometry.overflow).toBe(false);
 await page.evaluate(()=>{
  const award={id:'browser-kill',matchId:'browser-battle',kind:'kill',money:400,supplies:0};
  ProductionUI.receiveAwards({phase:'playback',economyAwards:[award]});
  ProductionUI.receiveAwards({phase:'playback',economyAwards:[award]});
  ProductionUI.receiveAwards({startedFromSave:true,economyAwards:[{...award,id:'saved',money:9999,losses:{Type61:10}}]});
  ProductionUI.receiveAwards({replay:true,economyAwards:[{...award,id:'replay',money:9999,losses:{Type61:10}}]});
  const before = Development.pointBalance('EFSF');
  const tech = {id:'saved-tech',matchId:'browser-battle',faction:'EFSF',points:9999};
  DevelopmentUI.receiveAwards({startedFromSave:true,techAwards:[tech]});
  DevelopmentUI.receiveAwards({replay:true,techAwards:[{...tech,id:'replay-tech'}]});
  if(Development.pointBalance('EFSF')!==before)throw Error('Saved or replay technology credit');
 });
 await expect(page.locator('#menuResources .resource-money')).toContainText('5,400');
 expect(await page.evaluate(()=>Economy.quantity('Type61'))).toBe(24);
 await page.evaluate(()=>ProductionUI.receiveAwards({phase:'finished',economyAwards:[{id:'browser-result',matchId:'browser-battle',kind:'result',money:1350,supplies:2700,losses:{Type61:2}}]}));
 expect(await page.evaluate(()=>ProfileSave.validate(ProfileSave.exportData()).economy.money)).toBe(6750);
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>ProductionUI.receiveAwards({phase:'finished',economyAwards:[{id:'browser-result',matchId:'browser-battle',kind:'result',money:1350,supplies:2700,losses:{Type61:2}}]}));
 expect(await page.evaluate(()=>({money:Economy.snapshot().money,supplies:Economy.snapshot().supplies,owned:Economy.quantity('Type61')}))).toEqual({money:6750,supplies:12700,owned:22});
 await page.locator('#openSkirmish').click();await page.locator('#createOfflineRoom').click();
 await expect.poll(()=>page.evaluate(()=>Net.snapshot?.phase)).toBe('waiting');
 expect(errors).toEqual([]);
});
