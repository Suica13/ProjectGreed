const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const {createServer}=require('../server');

for(const width of [1440,390])test(`CE liaisons unlock, play their intros and expose the T1 task chains at ${width}px`,async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:1000});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('CE Contract PMC');await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(()=>I18n.setLanguage('zh'));
  await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();
  await expect(page.locator('.merchant-card')).toHaveCount(5);
  for(const id of ['omni','zaft']){
    await expect(page.locator(`[data-merchant-id="${id}"] .merchant-portrait`)).toBeDisabled();
    await expect(page.locator(`[data-merchant-id="${id}"] .merchant-information`)).toContainText('未解锁');
    await expect(page.locator(`[data-merchant-id="${id}"]`)).not.toContainText('小菜一碟');
  }
  await page.evaluate(()=>{
    const state=Economy.snapshot();state.contactTasks.push({id:'efsf-11',status:'claimed',progress:1});
    localStorage.setItem('projectgreed.economy.v1',SaveCodec.stringify(state));
  });
  await page.reload();await page.waitForFunction(()=>assetsReady);
  await page.locator('#shellMissions').click();await page.locator('#shellContactMerchants').click();
  await expect(page.locator('.merchant-card')).toHaveCount(5);
  for(const id of ['omni','zaft']){
    const card=page.locator(`[data-merchant-id="${id}"]`),terminal=page.locator('#merchantTerminal');
    await expect(card.locator('img')).toHaveAttribute('src',/^data:image\/png;base64,/);
    expect(await card.locator('img').evaluate(async image=>{await image.decode();return image.naturalWidth>0;})).toBe(true);
    await card.locator('.merchant-portrait').click();
    const lines=await page.evaluate(id=>ContactTasks.introFor(id).length,id);
    for(let i=0;i<lines;i++)await page.locator('#liaisonDialogueNext').click();
    expect(await page.evaluate(id=>ContactTasks.met(Economy.snapshot(),id),id)).toBe(true);
    await terminal.getByRole('button',{name:'任务',exact:true}).click();
    await expect(terminal.locator('[data-task-id]')).toHaveCount(10);
    await terminal.locator(`[data-task-id="${id}-1"]`).click();
    await expect(terminal.locator('.contact-task-detail')).toContainText('CE0071T1');
    await expect(terminal.locator('.contact-task-detail')).toContainText(id==='omni'?'扎夫特':'地球联合');
    await expect(page.locator('#contactTaskAction')).toBeEnabled();
    await page.locator('#contactTaskAction').click();
    await terminal.locator(`[data-task-id="${id}-10"]`).click();
    await expect(terminal.locator('.contact-task-detail')).toContainText('同一局完成');
    await expect(terminal.locator('.contact-task-detail')).toContainText(id==='omni'?'公司印章':'哈维尔');
    await expect(terminal.locator('.contact-task-detail')).toContainText(id==='omni'?'决斗短剑':'决斗高达');
    await expect(page.locator('#contactTaskAction')).toBeDisabled();
    await expect(terminal.locator('.contact-task-requirements')).toContainText(id==='omni'?'中立的价码':'没有中立的潮水');
    await page.screenshot({path:`tmp/verification/screenshots/ce-contact-${id}-${width}.png`});
    await terminal.getByRole('button',{name:'关闭',exact:true}).click();
  }
  expect(errors).toEqual([]);
});

test('CE era selection starts at N2 and the WebSocket authority rejects N1',async({page})=>{
  const app=createServer({host:'127.0.0.1',port:0}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(base);await page.waitForFunction(()=>assetsReady);
    await page.locator('#profileCompanyName').fill('CE room');await page.locator('#profileOnboardingConfirm').click();
    await page.evaluate(base=>{I18n.setLanguage('zh');byId('newRoomMode').value='sweep';Net.serverURL=base.replace('http:','ws:')+'/ws';Net.room='CEUI';Net.connect('create',true);},base);
    await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
    await expect(page.locator('#sweepEra option[value="CE_0071_T1"]')).toBeEnabled();
    await page.locator('#sweepEra').selectOption('CE_0071_T1');
    await expect(page.locator('#sweepDifficulty')).toHaveValue('2');
    await expect(page.locator('#sweepDifficulty option[value="1"]')).toHaveJSProperty('disabled',true);
    await expect(page.locator('#sweepFaction option[value="NONE|NONE"]')).toHaveText('武装介入');
    const rejected=await page.evaluate(()=>new Promise(resolve=>{
      const listener=e=>{const m=JSON.parse(e.data);if(m.type==='error'){Net.socket.removeEventListener('message',listener);resolve(m.message);}};
      Net.socket.addEventListener('message',listener);Net.request('configure_room',{...Net.snapshot.settings,sweepDifficulty:1});
    }));
    expect(rejected).toContain('N2');expect(app.rooms.get('CEUI').settings.sweepDifficulty).toBe(2);
    await page.locator('#sweepFaction').selectOption('NONE|NONE');
    await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.sweepFaction)).toBe('NONE');
    expect(errors).toEqual([]);
  }finally{await page.evaluate(()=>Net.leave()).catch(()=>{});await app.close();}
});
