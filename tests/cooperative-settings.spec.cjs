const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`cooperative menu and fixed mission rules at ${width}px`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:950});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 expect(await page.locator('optgroup[label="合作模式"]').count()).toBe(3);
 expect(await page.locator('optgroup[label="合约模式"]').count()).toBe(0);
 await page.evaluate(()=>{byId('offlineRoomMode').value='mission';LocalRoom.open();});
 await page.waitForFunction(()=>Net.snapshot?.settings.mode==='mission');
 expect(await page.evaluate(()=>Net.snapshot.settings.costLimit)).toBe(2000);
 expect(await page.locator('#roomTagRestrictions').evaluate(el=>el.closest('details').hidden)).toBe(true);
 const reused=await page.evaluate(()=>{
  const s={...Net.snapshot,started:true,phase:'idle',game:{...Net.snapshot.game,mission:{protect:['whitebase'],dialogue:null}}};
  MissionUI.receive(s);const node=document.querySelector('#missionObjectives p').firstChild;
  for(let i=0;i<20;i++)MissionUI.receive(s);
  const same=node===document.querySelector('#missionObjectives p').firstChild;
  MissionUI.clear();return same;
 });
 expect(reused).toBe(true);expect(errors).toEqual([]);
});
