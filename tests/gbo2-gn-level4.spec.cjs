const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('GN catalog previews and native firing frames load in both directions',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await expect(page.locator('#profileOnboarding')).toBeVisible();
 await page.locator('#profileCompanyName').fill('GN移植验证');
 await page.locator('#profileOnboardingConfirm').click();
 await expect(page.locator('#profileOnboarding')).not.toBeVisible();
 await page.evaluate(()=>{I18n.setLanguage('zh');MenuShell.go('encyclopedia');});
 await page.locator('#encyclopediaFaction').selectOption('CB');
 await expect(page.locator('.encyclopedia-unit')).toHaveCount(5);
 for(const id of ['GN_001','GN_002','GN_003','GN_003_MA','GN_005']) {
  await page.evaluate(id=>Formation.previewUnit(id),id);
  await expect(page.locator('#formationUnitDetail')).toBeVisible();
  await page.waitForFunction(()=>SpriteRenderer.modelsReady([document.querySelector('#formationDetailPreview').dataset.previewModel]));
  await page.screenshot({path:`tmp/verification/screenshots/${id}-level4.png`});
  await page.locator('#closeFormationDetail').click();
 }
 const frames=await page.evaluate(async()=>{
  const ids=['GN_001','GN_002','GN_003','GN_003_MA','GN_005'];
  await SpriteRenderer.ensureModels(ids.map(id=>id+'__default'));
  const canvas=document.createElement('canvas');canvas.id='gn-verification';canvas.width=1500;canvas.height=700;canvas.style='position:fixed;inset:0;z-index:999999;background:#17212b;width:1500px;height:700px';document.body.append(canvas);
  const ctx=canvas.getContext('2d');
  return ids.map((id,i)=>{
   const model=UnitModels[id+'__default'];
   for(const [j,angle] of [90,270].entries()){
    const w=model.weapons[0],clip=w.clip||model.presentation.idle;
    SpriteRenderer.draw(ctx,id+'__default',150+i*300,150+j*330,1,angle,clip,.4,w.id,false,true,false,{},angle,true,false,'ground',w.id,w.displayIndex);
    ctx.fillStyle='white';ctx.font='16px sans-serif';ctx.fillText(id+' / '+angle,70+i*300,280+j*330);
   }
   return {id,ready:SpriteRenderer.modelsReady([id+'__default']),weapons:model.weapons.map(w=>({id:w.id,sound:!!w.sound,events:w.attack.strikes.length}))};
  });
 });
 await page.locator('#gn-verification').screenshot({path:'tmp/verification/screenshots/gn-level4-directions.png'});
 expect(frames.every(f=>f.ready&&f.weapons.every(w=>w.events>0&&w.sound))).toBe(true);
 const beam=await page.evaluate(async()=>{
  game=Rules.create(false,1,[[{unitId:'GN_005',kitId:'default'}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
  game.tiles.forEach(r=>r.fill('plain'));const [u,v]=game.units;Object.assign(u,{x:3,y:5});Object.assign(v,{x:8,y:5});
  await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({game}));
  const event=Rules.useSkill(game,u,'Irradiation',4,5),skill=Rules.unitSkills(u).find(s=>s.id==='Irradiation');
  const canvas=document.createElement('canvas');canvas.id='gn-beam';canvas.width=1200;canvas.height=400;canvas.style='position:fixed;inset:0;z-index:999999;background:#17212b;width:1200px;height:400px';document.body.append(canvas);
  const ctx=canvas.getContext('2d'),draws=[],original=ctx.drawImage.bind(ctx);
  ctx.drawImage=(...args)=>{draws.push(Object.keys(SpriteRenderer.images).find(k=>SpriteRenderer.images[k]===args[0]));original(...args);};
  SpriteEffects.setFogClip(new Path2D(),ctx);IrradiationFX.reset();IrradiationFX.start({...event,id:'gn-beam-proof'});
  const position=(x,y)=>({x:x*40,y:y*40});IrradiationFX.draw(ctx,1000,position,40);draws.length=0;
  IrradiationFX.draw(ctx,1000+(skill.chargeSeconds+.4)*1000,position,40);
  return {prefix:event.effectPrefix,parts:draws.filter(k=>k?.includes('GBO2_Irradiation')),visible:ctx.getImageData(0,0,1200,400).data.some((n,i)=>i%4===3&&n>0)};
 });
 expect(beam.prefix).toBe('GBO2_Irradiation');expect(beam.parts).toHaveLength(3);expect(beam.visible).toBe(true);
 await page.locator('#gn-beam').screenshot({path:'tmp/verification/screenshots/gn-virtue-beam.png'});
 expect(errors).toEqual([]);
});
