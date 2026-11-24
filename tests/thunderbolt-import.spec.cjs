const{test,expect}=require('@playwright/test');
const{pathToFileURL}=require('node:url'),path=require('node:path');
test('TB previews, native firing poses, Battle Operation projectiles and original audio load',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('TB移植验证');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(()=>{I18n.setLanguage('zh');MenuShell.go('encyclopedia');});
 const ids=['RGM_79_TB','MS_06F_TB','MS_06R_TB','MS_06R_TB_WeaponModeB','FA_78_1_TB','FA_78_1_TB_WeaponModeB','FA_78_1_TB_NA'];
 for(const id of ids){
  await page.evaluate(id=>Formation.previewUnit(id),id);await expect(page.locator('#formationUnitDetail')).toBeVisible();
  await page.waitForFunction(()=>SpriteRenderer.modelsReady([document.querySelector('#formationDetailPreview').dataset.previewModel]));
  await page.locator('#closeFormationDetail').click();
 }
 const results=await page.evaluate(async ids=>{
  await SpriteRenderer.ensureModels(ids.map(id=>id+'__default'));
  const weapons=ids.flatMap(id=>UnitModels[id+'__default'].weapons);
  await SpriteRenderer.ensureAssets(weapons.flatMap(w=>[w.projectile?.asset]));
  const audio=new AudioContext(),decoded=[];
  for(const key of new Set(weapons.map(w=>w.sound.asset))){
   const raw=ART.sounds[key],bytes=Uint8Array.from(atob(raw.split(',')[1]),c=>c.charCodeAt(0));
   const buffer=await audio.decodeAudioData(bytes.buffer);decoded.push(buffer.duration);
  }
  await audio.close();
  const canvas=document.createElement('canvas');canvas.id='tb-firing-proof';canvas.width=1400;canvas.height=600;canvas.style='position:fixed;inset:0;z-index:999999;background:#18232e';document.body.replaceChildren(canvas);const ctx=canvas.getContext('2d');
  const rows=ids.map((id,i)=>{
   const m=UnitModels[id+'__default'],w=m.weapons.find(w=>w.type!=='melee')||m.weapons[0];
   const time=w.attack.strikes[0].at+.01,pose=WeaponSequence.pose(w,time);
   for(const[j,angle]of [90,270].entries())SpriteRenderer.draw(ctx,id+'__default',100+i*200,140+j*280,2.4,angle,pose.clip||m.presentation.idle,pose.time,w.id,false,true,false,{},angle,true,false,'space',w.id,pose.weaponDisplayIndex);
   ctx.fillStyle='white';ctx.font='11px sans-serif';ctx.fillText(id,5+i*200,285);
   return {id,ready:SpriteRenderer.modelsReady([id+'__default']),projectiles:m.weapons.filter(w=>w.projectile).map(w=>({source:w.projectile.presentationSource,loaded:!!SpriteRenderer.images[w.projectile.asset]})),shield:m.shield.hp};
  });
  return {rows,decoded,visible:ctx.getImageData(0,0,1400,600).data.some((value,index)=>index%4===3&&value>0)};
 },ids);
 expect(results.rows).toHaveLength(7);expect(results.visible).toBe(true);expect(results.decoded.length).toBeGreaterThan(10);expect(results.decoded.every(n=>n>0)).toBe(true);
 for(const row of results.rows){expect(row.ready).toBe(true);for(const p of row.projectiles){expect(p.loaded).toBe(true);expect(p.source).toContain('GundamWars_BattleOperation2_V5/');}}
 await page.screenshot({path:'tmp/verification/screenshots/thunderbolt-native-firing.png'});
 expect(errors).toEqual([]);
});
