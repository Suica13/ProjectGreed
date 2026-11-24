const{test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`TB and CB supply cards, covers, rental deliveries and independent wallets at ${width}`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{I18n.setLanguage('zh');const p=Economy.initial('EFSF');p.itemInventory={'0079t1-token':10,'thunderbolt-token':10,'celestial-being-token':10};localStorage.setItem(Economy.key,SaveCodec.stringify(p));});
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.locator('#shellMissions').click();await page.locator('#shellContactSupply').click();await expect(page.locator('.supply-pool-card')).toHaveCount(3);
 const frames=await page.locator('.supply-pool-card').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
 expect(frames.every(n=>n.width===frames[0].width&&n.height===frames[0].height)).toBe(true);
 for(const[id,name,count]of [['thunderbolt','雷霆宙域',2],['celestial-being','天人',4]]){
  await page.locator(`[data-pool-id="${id}"]`).click();await expect(page.locator('.supply-wallet')).toContainText(name+'补给代币');
  await expect(page.locator('.supply-featured figure')).toHaveCount(count);await page.waitForFunction(()=>[...document.querySelectorAll('.supply-cover canvas')].every(c=>c.dataset.spriteReady==='true'));
  expect(await page.locator('.supply-cover canvas').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.previewAngle)))).toEqual(count===2?[270,90]:[315,45,225,135]);
  expect(await page.locator('.supply-detail').evaluate(n=>n.scrollHeight<=n.clientHeight+1)).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/${id}-supply-${width}.png`});
  await page.locator('#contactSupply').getByRole('button',{name:'商品一览',exact:true}).click();
  await expect(page.locator('.supply-products')).toContainText('C品 · 50%');await expect(page.locator('.supply-products')).toContainText('1000–3000');await expect(page.locator('.supply-products')).toContainText('剩余次数 20 次');
  await page.locator('.supply-products').getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>{const old=crypto.getRandomValues,rolls=[.1,.99,0];window.restoreSupplyRandom=()=>{crypto.getRandomValues=old;};crypto.getRandomValues=a=>{a[0]=Math.floor(rolls.shift()*4294967296);return a;};});
  await page.locator('#supplyDrawOnce').click();const dialog=page.locator('.supply-delivery');await expect(dialog.locator('#supplyOpenCrate')).toBeEnabled();await dialog.locator('#supplyOpenCrate').click();await expect(dialog.locator('.supply-result')).toContainText('20次');await dialog.getByRole('button',{name:'收下补给',exact:true}).click();await page.evaluate(()=>restoreSupplyRandom());
 }
 expect(await page.evaluate(()=>Economy.snapshot().itemInventory)).toEqual({'0079t1-token':10,'thunderbolt-token':9,'celestial-being-token':9});
 expect(await page.evaluate(()=>Economy.snapshot().storage.deliveries.slice(-2).map(d=>d.rentalUses))).toEqual([20,20]);expect(errors).toEqual([]);
});
test('GN defensive playback exposes the deployed original four-frame field and separate passive abilities',async({page})=>{
 test.setTimeout(120000);await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('GN护罩验证');await page.locator('#profileOnboardingConfirm').click();
 const result=await page.evaluate(async()=>{
  game=Rules.create(false,1,[[{unitId:'GN_001',kitId:'default'}],[{unitId:'GN_005',kitId:'default'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});game.deployment=null;game.tiles.forEach(r=>r.fill('plain'));const[a,b]=game.units;Object.assign(a,{x:3,y:5,deploymentStaged:false});Object.assign(b,{x:6,y:5,deploymentStaged:false});
  await SpriteRenderer.ensureModels([a.model,b.model]);await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({game}));
  const actors=structuredClone(game.units),w=Rules.modelOf(a).weapons[0],events=Rules.resolveProjectile(game,a,b,w,'defend');
  const battle={a:a.id,b:b.id,actors,events};MapCombat.reset();MapCombat.seed([battle]);battleView={a:a.id,b:b.id,battles:[battle],actors,events,index:0,completed:false};phase='battle';pageView='game';MapCombat.begin(battleView,()=>.99);const start=performance.now();MapCombat.update(start);MapCombat.update(start+300/MovementTiming.combatRate(false,false));
  const target=MapCombat.units().find(u=>u.id===b.id),field=ART.effects.GN_Field;
  setPageView('game');MapCamera.focus(b.x,b.y);const draws=[],draw=SpriteEffects.draw;SpriteEffects.draw=(...args)=>{draws.push(args[1]);return draw(...args);};try{drawMap(start+300/MovementTiming.combatRate(false,false));}finally{SpriteEffects.draw=draw;}
  const canvas=document.createElement('canvas');canvas.id='gn-field-proof';canvas.width=600;canvas.height=300;canvas.style='position:fixed;inset:0;z-index:999999;background:#152130';document.body.append(canvas);const ctx=canvas.getContext('2d');SpriteEffects.setFogClip(new Path2D(),ctx);SpriteRenderer.draw(ctx,b.model,150,150,1,270,null,0);SpriteEffects.draw(ctx,'GN_Field',150,150,1,.2);
  return{drawn:draws.includes('GN_Field'),defending:target?.mapPose?.gnFieldDefending,frames:field.frames,width:SpriteRenderer.images[field.asset].width,labels:SkillControls.defensiveAbilities(Rules.modelOf(b)).map(a=>a.name),solar:SkillControls.defensiveAbilities(Rules.modelOf(b)).find(a=>a.name==='太阳炉').description,pixels:ctx.getImageData(0,0,600,300).data.some((x,i)=>i%4===3&&x>0)};
 });
 expect(result.drawn).toBe(true);expect(result.defending).toBe(true);expect(result.frames).toBe(4);expect(result.labels).toEqual(expect.arrayContaining(['GN立场','太阳炉']));expect(result.labels).not.toContain('I立场');expect(result.pixels).toBe(true);
 expect(result.solar).toContain('反侦测');expect(result.solar).toContain('隐蔽');
 await page.locator('#gn-field-proof').screenshot({path:'tmp/verification/screenshots/gn-field-deployed.png'});
});
