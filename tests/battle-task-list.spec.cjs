const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');

test('Zeon live task list uses its own liaison heading and Federal kill progress',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Zeon Task PMC');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  I18n.setLanguage('zh');BattleTaskList.receive({started:true,phase:'idle',game:{},
   contactTaskStatus:[{id:'zeon-1',status:'accepted',progress:3}]});byId('battleTaskList').click();
 });
 const panel=page.locator('#battleTaskPanel');await expect(panel).toContainText('吉翁联络人');
 await expect(panel).toContainText('歼灭地球联邦军MS 3/6');await expect(panel).not.toContainText('联邦联络人');
 await page.evaluate(()=>BattleTaskList.receive({started:true,phase:'idle',game:{},contactTaskStatus:[{id:'zeon-1',status:'ready',progress:6}]}));
 await expect(panel).toContainText('歼灭地球联邦军MS 6/6');await expect(panel).toContainText('可交付');
});

test('battle task list contains only liaison tasks and refreshes without persisting or accumulating live credit',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Task PMC');
 await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  window.taskSaveBefore=JSON.stringify(Economy.snapshot());
  window.taskFrame={started:true,phase:'idle',game:{mission:{id:'test'}},contract:{objectives:[]},
    contactTaskStatus:[{id:'efsf-1',status:'accepted',progress:2}]};
  BattleTaskList.receive(taskFrame);
  byId('battleTaskList').click();
 });
 const panel=page.locator('#battleTaskPanel');
 await expect(panel).toContainText('歼灭吉翁军MS 2/6');
 await expect(panel.locator('h3')).toHaveCount(1);
 await expect(panel).not.toContainText('胜利条件');
 await expect(panel).not.toContainText('失败条件');
 await page.evaluate(()=>{
  taskFrame.contactTaskStatus[0].progress=5;
  BattleTaskList.receive(taskFrame);BattleTaskList.receive(taskFrame);
 });
 await expect(panel).toContainText('歼灭吉翁军MS 5/6');
 await page.evaluate(()=>{
  taskFrame.contactTaskStatus[0]={id:'efsf-1',status:'ready',progress:6};
  BattleTaskList.receive(taskFrame);
 });
 await expect(panel).toContainText('可交付');
 expect(await page.evaluate(()=>JSON.stringify(Economy.snapshot())===taskSaveBefore)).toBe(true);
 await page.evaluate(()=>{taskFrame.contactTaskStatus=[];BattleTaskList.receive(taskFrame);});
 await expect(panel).toContainText('暂无任务');
 await expect(panel.locator('article')).toHaveCount(0);
});
