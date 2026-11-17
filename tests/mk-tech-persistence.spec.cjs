const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const tree=require('../shared/development-tree.json');
const id='Tech_TITANS_0087_T2_GundamMkIVVDevelopmentPlan';
test('Mk-IV / Mk-V research survives full HTML startup and repeated reloads',async({page})=>{
 test.setTimeout(90000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const researched=Object.fromEntries(Object.entries(tree).map(([f,nodes])=>[f,nodes.filter(n=>n.id!==id).map(n=>n.id)]));
 await page.addInitScript(({researched})=>{
  if(localStorage.getItem('mk-persistence-seeded'))return;
  localStorage.setItem('projectgreed.developmentProgress.v1',JSON.stringify({points:{TITANS:100000},claimed:{},researched}));
  localStorage.setItem('mk-persistence-seeded','true');
 },{researched});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>typeof Development!=='undefined' && assetsReady);
 expect(await page.evaluate(id=>Development.research('TITANS',id),id)).toBe(true);
 for(let i=0;i<3;i++){
  await page.reload();
  await page.waitForFunction(()=>typeof Development!=='undefined' && assetsReady);
  expect(await page.evaluate(id=>Development.unlockedTech('TITANS').includes(id),id)).toBe(true);
  expect(await page.evaluate(()=>Development.allows('PMC','ORX_012')&&Development.allows('PMC','ORX_013'))).toBe(true);
 }
 expect(errors).toEqual([]);
});
