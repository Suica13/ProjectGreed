const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('mission contacts have no contract N level '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:1000});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Mission check');await page.locator('#profileOnboardingConfirm').click();
 const ids=await page.evaluate(()=>{
  const tasks=ContactTasks.tasks.filter(t=>t.missionId||t.id==='efsf-17'),state=Economy.snapshot();
  state.contactIntro=true;state.merchantIntros.zeon=true;
  state.contactTasks=tasks.map(t=>({id:t.id,status:'accepted',progress:0,progressVersion:t.progressVersion}));
  localStorage.setItem('projectgreed.economy.v1',SaveCodec.stringify(state));return tasks.filter(t=>t.missionId).map(t=>t.id);
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);await page.locator('#shellMissions').click();
 for(const id of ids){
  await page.locator('#contactTasks [data-task-id="'+id+'"]').click();
  const conditions=page.locator('#contactTasks .contact-task-conditions').first();
  await expect(conditions).toContainText('任务模式');await expect(conditions).not.toContainText(/N\d|undefined/);
 }
 await page.locator('#contactTasks [data-task-id="efsf-17"]').click();
 await expect(page.locator('#contactTasks .contact-task-conditions').first()).toContainText('N5');
});
