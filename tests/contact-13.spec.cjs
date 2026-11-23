const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`new contact branches and permits at ${width}px`,async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('新枝PMC');
 await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  I18n.setLanguage('zh');Economy.meetLiaison('efsf');
  for(const t of ContactTasks.tasks.filter(t=>(t.contactId||'efsf')==='efsf'&&t.number<=9&&t.id!=='efsf-7')){
   Economy.acceptContactTask(t.id);
   Economy.creditAward({id:'setup-'+t.id,matchId:'setup-'+t.id,money:0,supplies:0,contactProgress:[{id:t.id,amount:t.required}]});
   Economy.completeContactTask(t.id);
  }
 });
 await page.locator('#shellMissions').click();
 await page.locator('#shellContactMerchants').click();
 await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
 const terminal=page.locator('#merchantTerminal');
 await terminal.getByRole('button',{name:'任务',exact:true}).click();
 await expect(terminal.locator('[data-task-id]')).toHaveCount(12);
 await terminal.locator('[data-task-id="efsf-12"]').click();
 await expect(page.locator('#contactTaskAction')).toBeDisabled();
 await expect(terminal).toContainText('掠地攻城');
 await expect(terminal).toContainText('小菜一碟');
 await expect(terminal).toContainText('地球联邦军');
 await terminal.locator('[data-task-id="efsf-11"]').click();
 await expect(page.locator('#contactTaskAction')).toBeEnabled();
 await expect(terminal).toContainText('吉姆开发计划');
 await page.locator('#contactTaskAction').click();
 expect(await page.evaluate(()=>Economy.snapshot().contactTasks.find(t=>t.id==='efsf-11').status)).toBe('accepted');
 await terminal.locator('[data-task-id="efsf-12"]').click();
 await expect(page.locator('#contactTaskAction')).toBeDisabled();
 await expect(terminal).toContainText('苍白骑士');
 const bounds=await terminal.evaluate(e=>[e.scrollWidth,e.clientWidth]);expect(bounds[0]).toBeLessThanOrEqual(bounds[1]+1);
 expect(errors).toEqual([]);
});
