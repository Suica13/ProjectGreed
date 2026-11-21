const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path'),P=require('../shared/pilots');
for(const width of [1440,390])test('warehouse and dorm pages use new slot capacities and five desktop columns '+width,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:1050});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ace=P.createAce(P.catalog.aces.find(p=>P.skillsOf({pilot:P.createAce(p.id)}).length>=2).id);
  const pilots=[...Array.from({length:12},(_,i)=>P.createCustom('custom-five-'+i,'驾驶员'+i)),ace];
  await page.addInitScript(pilots=>{if(!localStorage.getItem('projectgreed.custom-pilots.v3.shared'))localStorage.setItem('projectgreed.custom-pilots.v3.shared',JSON.stringify({pilots,awards:[]}));},pilots);
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  expect(await page.evaluate(()=>Economy.snapshot().storage.slots)).toEqual({units:20,ships:4});
  await page.evaluate(()=>{const data=Economy.snapshot();data.baseFacilities.levels={hq:2,factory:2,giantFactory:2,beacon:2,academy:2};localStorage.setItem(Economy.key,SaveCodec.stringify(data));});
  await page.reload();await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'five-cards',matchId:'five-cards',money:0,supplies:0,inventory:{RGM_79:11,Medea:5}});});
  expect(await page.evaluate(()=>({slots:Economy.snapshot().storage.slots,pmc:Economy.customPilotLimit(),ace:Economy.acePilotLimit()}))).toEqual({slots:{units:30,ships:8},pmc:20,ace:20});
  const size=width===1440?10:4,pages=Math.ceil(30/size),destination=2*size-1;
  if(width===390)for(const headerWidth of [320,390]){
    await page.setViewportSize({width:headerWidth,height:1050});
    const header=await page.locator('.shell-top').evaluate(top=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect(),brand=rect('.shell-brand'),profile=rect('#shellProfile'),settings=rect('#shellSettings'),primary=rect('.shell-primary');
      return {aligned:Math.abs(brand.y+brand.height/2-profile.y-profile.height/2)<3&&Math.abs(settings.y+settings.height/2-profile.y-profile.height/2)<3,navBelow:primary.y>=profile.bottom,overflow:top.scrollWidth>top.clientWidth+1,inputWidth:rect('#playerId').width};
    });expect(header.aligned).toBe(true);expect(header.navBelow).toBe(true);expect(header.overflow).toBe(false);expect(header.inputWidth).toBeGreaterThan(45);
  }
  await page.locator('#shellHangar').click();await expect(page.locator('#warehouseBays .warehouse-bay')).toHaveCount(size);
  expect(await page.locator('#warehouseBays').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(width===1440?5:2);
  await expect(page.locator('#warehousePage')).toHaveText('1 / '+pages+' 页');await page.locator('#warehouseNext').click();
  await page.locator('#warehouseBays [data-stock-id]').first().click();await page.locator('#warehouseRelocate').click();await expect(page.locator('#warehouseRelocatePage')).toHaveText('2 / '+pages+' 页');
  await expect(page.locator('.warehouse-relocate-choice')).toHaveCount(size);await expect(page.locator(`.warehouse-relocate-choice[data-slot="${size}"]`)).toBeDisabled();
  await page.locator(`.warehouse-relocate-choice[data-slot="${destination}"]`).click();await page.locator('#warehouseClose').click();await expect(page.locator(`#warehouseBays [data-stock-id][data-slot="${destination}"]`)).toHaveCount(1);
  await page.locator('#warehouseShips').click();await expect(page.locator('#warehouseBays .warehouse-bay')).toHaveCount(Math.min(8,size));
  await page.locator('#shellPilots').click();await expect(page.locator('#customPilotList .dorm-card-slot')).toHaveCount(size);
  expect(await page.locator('#customPilotList').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(width===1440?5:2);
  await page.locator('#dormNext').click();await expect(page.locator('#dormPage')).toHaveText(width===1440?'2 / 2 页':'2 / 5 页');
  await expect(page.locator(`.dorm-card[data-pilot-id="custom-five-${size}"]`)).toBeVisible();
  expect(await page.locator('.dorm-card-state').first().evaluate(el=>el.offsetHeight)).toBe(32);
  await page.locator('#dormACETab').click();
  const badges=page.locator('.dorm-card-skills .pilot-list-skill');await expect(badges).toHaveCount(2);
  const positions=await badges.evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().y));expect(Math.abs(positions[0]-positions[1])).toBeLessThan(1);
  await page.screenshot({path:`tmp/verification/screenshots/base-five-columns-${width}.png`});expect(errors).toEqual([]);
});
