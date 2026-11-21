const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path'),P=require('../shared/pilots');
test('fleet rows follow the taller carrier and standby anchors between level and training points',async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width:1440,height:1050});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(pilot=>{if(!localStorage.getItem('projectgreed.custom-pilots.v3.shared'))localStorage.setItem('projectgreed.custom-pilots.v3.shared',JSON.stringify({pilots:[pilot],awards:[]}));},P.createCustom('custom-status-anchor','位置校验驾驶员'));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{
    I18n.setLanguage('zh');Economy.creditActivity({id:'fleet-columns',matchId:'fleet-columns',money:0,supplies:0,inventory:{Medea:1,WhiteBase:1,FatUncle:1}});
    const items=Economy.snapshot().storage.ships,units=['Medea','WhiteBase','FatUncle'].map(unitId=>{const item=items.find(i=>i.unitId===unitId);return {unitId,kitId:item.kitId,stockId:item.id};});
    localStorage.setItem('slg-formations-v1.PMC',JSON.stringify({version:3,squads:[{name:'Two columns',units}]}));localStorage.setItem('slg-formations-v1.PMC-active','0');
  });
  await page.reload();await page.waitForFunction(()=>assetsReady);await page.evaluate(()=>I18n.setLanguage('zh'));
  await page.locator('#shellHangar').click();await page.locator('#shellFormation').click();
  await expect(page.locator('#formationUnits > .formation-carrier-group')).toHaveCount(3);
  const before=await page.evaluate(()=>JSON.stringify(Formation.current()));
  for(const width of [1440,1024,390,1440]){
    await page.setViewportSize({width,height:1050});
    await expect.poll(()=>page.locator('#formationUnits').evaluate(list=>getComputedStyle(list).display)).toBe(width>720?'grid':'block');
    const groups=await page.locator('#formationUnits > .formation-carrier-group').evaluateAll(groups=>groups.map(group=>{
      const r=group.getBoundingClientRect(),last=group.lastElementChild.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom,height:r.height,contentBottom:last.bottom};
    }));
    if(width>720){
      expect(Math.abs(groups[0].y-groups[1].y)).toBeLessThan(1);expect(groups[1].x).toBeGreaterThan(groups[0].x);
      expect(Math.abs(groups[0].height-groups[1].height)).toBeLessThan(1);
      expect(groups[1].contentBottom-groups[0].contentBottom).toBeGreaterThan(50);
      expect(groups[2].y).toBeGreaterThan(Math.max(groups[0].bottom,groups[1].bottom));expect(groups[2].x).toBe(groups[0].x);
    }else{expect(groups.every(group=>group.x===groups[0].x)).toBe(true);expect(groups[2].y).toBeGreaterThan(groups[1].bottom);}
    expect(await page.evaluate(()=>JSON.stringify(Formation.current()))).toBe(before);
    await page.screenshot({path:`tmp/verification/screenshots/fleet-two-columns-${width}.png`});
  }
  await page.locator('#shellPilots').click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1050});
    const anchor=await page.locator('.dorm-card-progress').first().evaluate(progress=>{
      const p=progress.getBoundingClientRect(),state=progress.querySelector('.dorm-card-state').getBoundingClientRect(),level=progress.querySelector('.dorm-card-experience strong').getBoundingClientRect(),points=progress.querySelector('.dorm-card-badges > span').getBoundingClientRect();
      return {right:(p.right-state.right)/(p.width/progress.offsetWidth),center:state.y+state.height/2,target:(level.y+level.height/2+points.y+points.height/2)/2};
    });expect(Math.abs(anchor.right-8)).toBeLessThan(1);expect(Math.abs(anchor.center-anchor.target)).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});
