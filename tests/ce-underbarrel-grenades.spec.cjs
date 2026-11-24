const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('CE weapon cards and firing assets distinguish the rifle from its underbarrel grenade',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(async()=>{
  const ids=['GAT_01__standard','GAT_01A1__kit_0','GAT_01D__standard','GAT_01D1__standard','GAT_01D_AS__standard','GAT_01D1_AS__standard'];
  await SpriteRenderer.ensureModels(ids);
  const results=[];
  for(const lang of ['zh','en','ja']){
   I18n.setLanguage(lang);
   for(const id of ids){
    const model=UnitModels[id],grenade=model.weapons.find(w=>w.id.endsWith('_GL'));
    const rifle=model.weapons.find(w=>w.id===grenade.id.slice(0,-3));
    const name=WeaponInfo.card(grenade).querySelector('.weapon-name').textContent;
    results.push({id,lang,name,shell:grenade.damageComponents.shell,beam:rifle.damageComponents.beam,
     grenadeTexture:grenade.projectile.texture,rifleTexture:rifle.projectile.texture,
     shots:grenade.attack.strikes.length,rifleShots:rifle.attack.strikes.length,sound:!!grenade.sound});
   }
  }
  return results;
 });
 expect(result).toHaveLength(18);
 for(const row of result){
  expect(row.shell).toBe(1125);expect(row.beam).toBeGreaterThan(4500);
  expect(row.name).toBe({zh:'下挂榴弹发射器',en:'Underbarrel Grenade Launcher',ja:'アンダーバレル・グレネードランチャー'}[row.lang]);
  expect(row.grenadeTexture).toContain('Bazooka_1.png');expect(row.rifleTexture).toContain('Beam_2_Green.png');
  expect(row.shots).toBe(1);expect(row.rifleShots).toBe(1);expect(row.sound).toBe(true);
 }
 expect(errors).toEqual([]);
});
