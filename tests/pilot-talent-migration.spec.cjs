const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');

test('loading the roster rerolls legacy PMC talents once, persists the result and keeps the pilot',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{
  const pilot=PilotSystem.createCustom('custom-migration-browser','旧档PMC',PilotSystem.catalog.portraits[0].id);
  pilot.talents=['pt05','pt48'];pilot.talentSlotsUnlocked=2;pilot.record.kills=17;
  delete pilot.talentPoolVersion;
  localStorage.setItem('projectgreed.custom-pilots.v3.shared',JSON.stringify({pilots:[pilot],awards:[]}));
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots[0]);
 const pilot=await read();
 expect(pilot.id).toBe('custom-migration-browser');expect(pilot.record.kills).toBe(17);
 expect(pilot.talentPoolVersion).toBe(2);expect(pilot.talents).toHaveLength(2);
 expect(pilot.talents).not.toContain('pt05');expect(pilot.talents).not.toContain('pt48');
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect((await read()).talents).toEqual(pilot.talents);
});
