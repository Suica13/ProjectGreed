const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`shared crew recruitment and assignment at ${width}px`,async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  const P=require('../shared/pilots');
  const namedAce=P.createAce(Object.values(P.catalog.aces).find(p=>p.price).id);
  const custom=P.createCustom('custom-order-check','Order test');
  await page.addInitScript(store=>localStorage.setItem('projectgreed.custom-pilots.v3.shared',JSON.stringify(store)),
    {pilots:[namedAce,custom],awards:[]});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.evaluate(()=>I18n.setLanguage('zh'));
  await page.locator('#shellHangar').click();
  await page.locator('#shellSubnav button').filter({hasText:/^驾驶员$/}).click();
  const before=await page.evaluate(()=>Economy.snapshot().money);
  await page.locator('#crewRecruitment button').filter({hasText:'老兵'}).click();
  expect(await page.evaluate(()=>Economy.snapshot().crewStock.veteran)).toBe(1);
  expect(await page.evaluate(()=>Economy.snapshot().money)).toBe(before-250);
  await page.locator('#shellSubnav button').filter({hasText:/^编组$/}).click();
  await page.locator('#formationUnits .formation-pilot-button').first().click();
  const panel=page.locator('#formationPilotPanel');await expect(panel).toBeVisible();
  const cards=panel.locator('.formation-pilot-card');
  expect(await cards.evaluateAll(items=>items.map(el=>el.dataset.pilotKind))).toEqual([
    'general','crew','crew','crew','custom','ace']);
  const veteran=panel.locator('[data-crew-grade="veteran"]');
  await expect(veteran).toContainText('\u5c04\u51fb 101\u2013125');
  await expect(veteran).toContainText('\u89c9\u9192 0\u20130');
  await expect(panel.locator('[data-crew-grade="enhanced"]')).toContainText('\u89c9\u9192 75\u2013110');
  await veteran.getByRole('button',{name:'配属',exact:true}).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#formationUnits .formation-pilot-button').first()).toContainText('老兵');
  await page.locator('#formationUnits .formation-pilot-button').first().click();
  await expect(veteran.getByRole('button',{name:'已配属',exact:true})).toBeDisabled();
  const geometry=await panel.evaluate(el=>({right:el.getBoundingClientRect().right,width:innerWidth}));
  expect(geometry.right).toBeLessThanOrEqual(geometry.width+1);
  await page.screenshot({path:`tmp/verification/screenshots/crew-assignment-${width}.png`});
  expect(errors).toEqual([]);
});
test('smart beam remains visible after damage flight and advances through its native strip',async({page})=>{
  test.setTimeout(90000);await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  const result=await page.evaluate(async()=>{
    const model=Rules.models.MSZ_006C1__standard;
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({game:{units:[{model:'MSZ_006C1__standard'}]}}));
    const w=structuredClone(model.weapons.find(w=>w.sourceName==='AEUG_MSZ_006C1_BeamSmartGun'));
    delete w.muzzleEffects;
    const canvas=document.createElement('canvas');canvas.width=1100;canvas.height=360;
    canvas.id='smartBeamFixture';canvas.style.cssText='position:fixed;inset:0;z-index:999999;background:#17212b;width:1100px;height:360px';document.body.append(canvas);
    const ctx=canvas.getContext('2d'),frames=[];
    for(let i=0;i<3;i++){
      const shot={at:0,flight:.04,sequenceDuration:w.projectile.sequence.duration/ART.presentation.animationSpeed,
        visibleUntil:2,origin:{x:30,y:60+i*100},destination:{x:1030,y:60+i*100}};
      const draw=ctx.drawImage.bind(ctx);let count=0;
      ctx.drawImage=(...args)=>{count++;frames.push(args[1]);draw(...args);};
      WeaponEffects.draw(ctx,w,{shots:[shot]},shot.sequenceDuration*[.2,.5,.8][i],{scale:.7},null);
      ctx.drawImage=draw;if(count!==3)throw Error(JSON.stringify({count,loaded:w.projectile.sequence.segments.map(s=>!!SpriteRenderer.images[s.asset]),duration:shot.sequenceDuration,speed:ART.presentation.animationSpeed}));
    }
    return {frames:new Set(frames).size,clock:w.projectile.sequence.clock,duration:w.projectile.sequence.duration};
  });
  expect(result.frames).toBeGreaterThan(1);expect(result.clock).toBe('native');expect(result.duration).toBeGreaterThan(1);
  await page.locator('#smartBeamFixture').screenshot({path:'tmp/verification/screenshots/smart-beam-native-clock.png'});
});
