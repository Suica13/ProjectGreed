const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('url'),path=require('path');
for(const width of [1440,390])test(`Zeon T2 missions and Anaheim T2 purchases persist at ${width}px`,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('T2验收');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{
  I18n.setLanguage('zh');Economy.meetLiaison('zeon');
  const finish=t=>{Economy.acceptContactTask(t.id);Economy.creditAward({id:'ui-'+t.id,matchId:'ui-'+t.id,money:0,supplies:0,contactProgress:[{id:t.id,amount:t.required}]});Economy.completeContactTask(t.id);};
  const pending=ContactTasks.tasks.filter(t=>t.contactId==='zeon'),done=new Set();while(pending.length){const i=pending.findIndex(t=>t.requires.every(id=>done.has(id)));if(i<0)throw Error('task cycle');const task=pending.splice(i,1)[0];finish(task);done.add(task.id);}
  Economy.meetLiaison('anaheim');['anaheim-1','anaheim-2','anaheim-3','anaheim-4','anaheim-5','anaheim-6','anaheim-8','anaheim-7','anaheim-9','anaheim-13','anaheim-10','anaheim-14'].forEach(id=>finish(ContactTasks.byId.get(id)));
 });
 const open=async id=>{await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();await page.locator(`[data-merchant-id="${id}"] .merchant-portrait`).click();};
 const terminal=page.locator('#merchantTerminal');await open('zeon');await terminal.getByRole('button',{name:'任务',exact:true}).click();
 await expect(terminal.locator('[data-task-id="zeon-12"]')).toBeVisible();await terminal.locator('[data-task-id="zeon-12"]').click();await expect(terminal).toContainText('新型水中MS开发计划');
 await terminal.getByRole('button',{name:'关闭',exact:true}).click();await open('anaheim');await terminal.getByRole('button',{name:'购买',exact:true}).click();
 await expect(terminal.locator('[data-plugin-id="weapon_rack"] button')).toBeDisabled();await expect(terminal.locator('[data-plugin-id="weapon_rack"]')).toContainText('长期供货');
 await page.evaluate(()=>{const t=ContactTasks.byId.get('anaheim-12');Economy.acceptContactTask(t.id);Economy.creditAward({id:'ui-final',matchId:'ui-final',money:0,supplies:0,contactProgress:[{id:t.id,amount:1}]});Economy.completeContactTask(t.id);});
 await page.reload();await page.waitForFunction(()=>assetsReady);await open('anaheim');await terminal.getByRole('button',{name:'购买',exact:true}).click();
 await expect(terminal.locator('[data-plugin-id="weapon_rack"] button')).toBeEnabled();await terminal.locator('[data-plugin-id="weapon_rack"] button').click();
 await expect(terminal.locator('[data-plugin-id="anti_beam_coating"]')).toHaveCount(0);
 await page.screenshot({path:`tmp/verification/screenshots/zeon-anaheim-t2-${width}.png`});
 await page.reload();await page.waitForFunction(()=>assetsReady);expect(await page.evaluate(()=>Economy.pluginQuantity('weapon_rack'))).toBe(1);expect(await page.evaluate(()=>Economy.merchantLevel('anaheim'))).toBe(3);expect(errors).toEqual([]);
});
