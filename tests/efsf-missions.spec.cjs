const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`mission entrance and accepted-task map gates at ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Mission Test');await page.locator('#profileOnboardingConfirm').click();
 const result=await page.evaluate(()=>{
  I18n.setLanguage('zh');Economy.meetLiaison('efsf');Economy.acceptContactTask('efsf-1');
  const locked=!Object.values(Rules.catalog.maps).some(m=>MissionMode.commissions.unlocked(m,Economy.snapshot().contactTasks));
  for(let n=1;n<=18;n++){const t=ContactTasks.byId.get('efsf-'+n);if(n>1)Economy.acceptContactTask(t.id);Economy.creditAward({id:'ui-'+n,matchId:'ui-'+n,money:0,supplies:0,contactProgress:[{id:t.id,amount:t.required}]});Economy.completeContactTask(t.id);}
  Economy.acceptContactTask('efsf-19');
  return {locked,conditions:[16,19,22,29].map(n=>ContactUI.taskSummary(ContactTasks.byId.get('efsf-'+n)).conditions),budgets:[19,29].map(n=>MissionMode.settings(Rules,'mission_efsf_'+n).costLimit),options:[...document.querySelectorAll('option[value="mission"]')].map(o=>o.disabled)};
 });
 expect(result.locked).toBe(true);expect(result.options.length).toBe(3);expect(result.options.every(v=>!v)).toBe(true);
 result.conditions.forEach((text,i)=>expect(text).toContain('N'+(i+3)));expect(result.budgets).toEqual([13500,22500]);
 await page.locator('#openSkirmish').click();await page.locator('#createOfflineRoom').click();
 await page.locator('#offlineRoomMode').selectOption('mission');await page.locator('#confirmOfflineMode').click();
 await expect(page.locator('#roomMapSelect')).toHaveValue('mission_efsf_19');
 const maps=await page.locator('#roomMapSelect option').evaluateAll(options=>options.map(o=>({id:o.value,disabled:o.disabled})));
 expect(maps).toEqual([{id:'mission_efsf_19',disabled:false},{id:'mission_efsf_29',disabled:true}]);
 expect(errors).toEqual([]);await page.screenshot({path:`tmp/verification/screenshots/efsf-missions-${width}.png`});
});
