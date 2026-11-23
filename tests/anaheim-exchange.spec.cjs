const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url'), path = require('node:path');
for (const width of [1440,390]) test(`Anaheim two-way exchange and air-capable ground labels at ${width}`, async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('Exchange test');
  await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(()=>{I18n.setLanguage('zh');Economy.meetLiaison('anaheim');MenuShell.go('contactMerchants');});
  await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();
  const terminal=page.locator('#merchantTerminal');
  await terminal.getByRole('button',{name:'资源兑换',exact:true}).click();
  await expect(terminal).toContainText('1物资 ⇄ 2资金');
  const read=()=>page.evaluate(()=>({money:Economy.snapshot().money,supplies:Economy.snapshot().supplies}));
  const before=await read();
  await page.locator('#merchantExchangeQuantity').fill('100');
  await terminal.getByRole('button',{name:'确认兑换'}).click();
  expect(await read()).toEqual({money:before.money+200,supplies:before.supplies-100});
  await page.locator('#merchantExchangeDirection').selectOption('money');
  await terminal.getByRole('button',{name:'确认兑换'}).click();
  expect(await read()).toEqual(before);
  await page.locator('#merchantExchangeQuantity').fill('999999');
  await expect(terminal.getByRole('button',{name:'确认兑换'})).toBeDisabled();
  await page.locator('#merchantExchangeQuantity').fill('10');
  await terminal.getByRole('button',{name:'确认兑换'}).click();
  const after=await read();
  expect(after).toEqual({money:before.money-20,supplies:before.supplies+10});
  expect(await terminal.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/anaheim-exchange-${width}.png`});
  await terminal.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>MenuShell.go('encyclopedia'));
  const labels=await page.evaluate(()=>{
    const kit=Economy.defaultKit('RX_78_2_BPart'), model=Rules.models['RX_78_2_BPart__'+kit];
    const tags=UnitPreview.unitTags(model,{limit:100});
    return {ground:tags.querySelector('[data-tag="ground"]')?.className,
      text:tags.querySelector('[data-tag="ground"]')?.textContent,
      groundValue:model.adaptability.ground,airValue:model.adaptability.air,
      filtered:UnitCatalog.select('RX_78_2_BPart',{environments:['ground']},()=>true,true).map(p=>p.id)};
  });
  expect(labels.ground).not.toContain('is-dim');expect(labels.text).toBe('地面');
  expect(labels.groundValue).toBe(10);expect(labels.airValue).toBe(100);
  expect(labels.filtered).toContain('RX_78_2_BPart');
  await page.reload();await page.waitForFunction(()=>assetsReady);
  expect(await read()).toEqual(after);expect(errors).toEqual([]);
});
