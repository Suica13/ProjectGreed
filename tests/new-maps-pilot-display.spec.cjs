const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const kind of ['custom','ace'])test(kind+' battlefield pilot panel uses deployed rank, XP and stats',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const expected=await page.evaluate(kind=>{
  const P=PilotSystem;
  let p=kind==='ace'?P.createAce(P.catalog.aces.find(a=>a.price).id):P.createCustom('custom-panel-rank','Panel');
  for(let i=0;i<3;i++)p=P.upgrade(P.gainExperience(p,Math.max(0,P.experienceRequired(p.level,p)-p.experience)));
  if(kind==='custom')p=P.custom({...p,stats:{...p.stats,shooting:150}});
  const e={unitId:'Type61',kitId:'standard'};
  game=Rules.create(false,1,[[{...e,customPilot:p}],[e]],false,{costLimit:10000,unitCostLimit:10000});
  phase='idle';selected=game.units[0].id;renderPanel();
  return {xp:p.experience,threshold:P.experienceRequired(p.level,p),shooting:Math.round(p.stats.shooting)};
 },kind);
 await expect(page.locator('[data-pilot-experience]')).toContainText('Lv.3');
 await expect(page.locator('[data-pilot-experience]')).toContainText(`${expected.xp}/${expected.threshold}`);
 expect(await page.locator('.unit-pilot-stats strong').first().textContent()).toBe(String(expected.shooting));
});
test('new maps appear in the playable catalog with localized labels and embedded art',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const maps=await page.evaluate(()=>['a_baoa_qu_space_3v3','colony_interior_3v3','mass_driver_facility_3v3'].map(id=>{
  const m=Rules.getMap(id);return {id:m.id,name:m.name,spawns:m.spawns.length,art:!!m.tileMap};
 }));
 for(const m of maps){expect(m.name).toMatch(/^\[\u65b0\]/);expect(m.spawns).toBe(6);expect(m.art).toBe(true);}
});
