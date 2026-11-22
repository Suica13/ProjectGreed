const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

for(const width of [1440,390])test(`planning 1.21 commission branches, conditions and permit rewards at ${width}px`,async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width,height:960});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Planning PMC');
 await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  I18n.setLanguage('zh');
  const p=ProfileSave.encodeData();p.economy.contactIntro=true;p.economy.contactAffinity=700;
  p.economy.contactTasks=ContactTasks.tasks.slice(0,6).map(t=>({id:t.id,status:'claimed',progress:t.required}));
  ProfileSave.importData(p);
 });
 await page.reload();
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#shellMissions').click();
 await page.locator('#shellContactMerchants').click();
 await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
 const terminal=page.locator('#merchantTerminal');
 await terminal.getByRole('button',{name:'任务',exact:true}).click();
 await expect(terminal.locator('.contact-task-card')).toHaveCount(10);
 await terminal.locator('[data-task-id="efsf-7"]').click();
 await expect(terminal.locator('.contact-task-conditions')).toContainText('敌军：地球联邦军');
 await expect(terminal.locator('.contact-technology-reward')).toContainText('苍蓝宿命计划');
 await expect(terminal.locator('.contact-currency-reward')).toContainText('好感度 +100');
 await expect(terminal.locator('#contactTaskAction')).toBeEnabled();
 await terminal.locator('#contactTaskAction').click();
 await terminal.locator('[data-task-id="efsf-9"]').click();
 await expect(terminal.locator('#contactTaskAction')).toBeDisabled();
 await expect(terminal.locator('.contact-technology-reward')).toContainText('V计划数据回收计划');
 await terminal.locator('[data-task-id="efsf-8"]').click();
 await expect(terminal.locator('.contact-task-progress')).toHaveText('歼灭吉翁军MS 0/50');
 await expect(terminal.locator('#contactTaskAction')).toBeEnabled();
 await terminal.locator('#contactTaskAction').click();
 await page.evaluate(()=>{
  Economy.creditAward({id:'fifty-kills',matchId:'planning-battle',money:0,supplies:0,contactProgress:[{id:'efsf-8',amount:50}]});
  Economy.completeContactTask('efsf-8');
 });
 await terminal.locator('[data-task-id="efsf-9"]').click();
 await expect(terminal.locator('#contactTaskAction')).toBeEnabled();
 await terminal.locator('[data-task-id="efsf-10"]').click();
 await expect(terminal.locator('.contact-task-progress')).toHaveText('使用炮击技能击坠吉翁军MS 0/30');
 await expect(terminal.locator('.contact-technology-reward')).toContainText('重型钢加农开发计划');
 await expect(terminal.locator('#contactTaskAction')).toBeDisabled();
 expect(await page.evaluate(()=>({version:ContactTasks.planningVersion,affinity:Economy.liaisonAffinity(),level:Economy.liaisonLevel()})))
  .toEqual({version:'1.21',affinity:800,level:2});
 expect(errors).toEqual([]);
});

test('loaned Pale Rider cannot be sold or removed through warehouse UI',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Loan PMC');
 await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  const p=ProfileSave.encodeData();p.economy.contactIntro=true;
  p.economy.contactTasks=ContactTasks.tasks.slice(0,4).map(t=>({id:t.id,status:'claimed',progress:t.required}));
  ProfileSave.importData(p);
 });
 await page.reload();await page.waitForFunction(()=>assetsReady);
 const item=await page.evaluate(()=>{Economy.acceptContactTask('efsf-5');return Economy.snapshot().storage.units.find(u=>u.contactLoan==='efsf-5');});
 await page.locator('#shellHangar').click();
 await page.locator('#warehouseBays [data-slot="'+item.slot+'"]').click();
 await expect(page.locator('#warehouseSellUnit')).toBeDisabled();
 await expect(page.locator('#warehouseSellUnit')).toHaveAttribute('title',/任务借用/);
});
