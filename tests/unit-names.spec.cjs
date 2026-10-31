const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('formation and battlefield have no unit rename controls and logs keep serials',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('projectgreed.combatFaction','PMC');
  localStorage.setItem('slg-formations-v1.PMC',JSON.stringify({version:3,squads:[{name:'Test',units:[{unitId:'Type61',kitId:'standard',customName:'Type61[A12]'}]}]}));
 });
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#shellHangar').click();
 await page.locator('.formation-row').first().getByRole('button',{name:'\u8be6\u60c5',exact:true}).click();
 await expect(page.locator('#formationDetailNameEditor')).toHaveCount(0);
 await expect(page.locator('#editFormationUnitName')).toHaveCount(0);
 await expect(page.locator('#formationDetailTitle')).toContainText('[A12]');
 const labels=await page.evaluate(()=>{
  const e={unitId:'Type61',kitId:'standard'};
  game=Rules.create(false,1,[[{...e,customName:'Type61[A12]'}],[e]]);
  phase='idle';selected=game.units[0].id;renderPanel();
  return game.units.map(logUnit);
 });
 await expect(page.locator('#editBattleUnitName')).toHaveCount(0);
 expect(labels[0]).toContain('[\u961f\u4f0d1]');expect(labels[0]).toContain('[A12]');
 expect(labels[1]).toContain('[\u961f\u4f0d2]');expect(labels[1]).toMatch(/\[[A-Z]\d{2}\]/);
});
