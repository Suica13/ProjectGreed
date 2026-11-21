const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390]) test('weapon type icons and compact identities '+width,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:960});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(async()=>{
    I18n.setLanguage('zh');
    const base=UnitModels.RGM_79__machine_gun.weapons[0];
    const weapons=Object.values(UnitModels).flatMap(model=>model.weapons);
    for(const [name,pick,expected] of [
      ['head',w=>w.sourceName==='Common_DoubleVulcan_MS','small_vulcan'],
      ['beam gun',w=>WeaponClasses.classify(w)==='beam_gun'&&!WeaponClasses.wristWeapon(w),'beam_gun'],
      ['wrist',w=>WeaponClasses.wristWeapon(w),'wrist'],
      ['railgun',w=>w.sourceName==='EF_Railgun_79_D_RG','railgun'],
      ['incom',w=>w.remote?.kind==='incom','incom'],
      ['funnel',w=>w.remote?.kind==='funnel','remote'],
      ['shell sniper',w=>WeaponClasses.classify(w)==='sniper'&&w.type==='shell','sniper'],
      ['shell shotgun',w=>WeaponClasses.classify(w)==='shell_shotgun','shell_shotgun'],
      ['scatter bazooka',w=>w.sourceName==='AEUG_ClayBazooka_ShotgunMode','shell_scatter_bazooka'],
    ]){
      const source=weapons.find(pick);if(!source)throw Error('Missing fixture '+name);
      const image=WeaponInfo.summary(source).querySelector('.weapon-type-icon');await image.decode();
      if(image.dataset.weaponIcon!==expected||image.src!==ART.assets[ART.weaponIcons[expected]])throw Error('Incorrect icon '+name);
    }
    for(const [key,file] of Object.entries({small_vulcan:'Ciws_1',beam_gun:'BeamGun_1',wrist:'ArmGun_2',railgun:'Railgun_1',incom:'Incom_1'})){
      if(!ART.weaponIcons[key]||!ART.assets[ART.weaponIcons[key]])throw Error('Missing '+file);
    }
    const kinds=Object.keys(WeaponClasses.labels),decoded=[];
    for(const kind of kinds){
      const source={...base,sourceName:'IconFixture',weaponClass:kind};
      const image=WeaponInfo.summary(source).querySelector('.weapon-type-icon');
      await image.decode();
      if(image.dataset.weaponClass!==kind||!image.naturalWidth)throw Error('Bad icon: '+kind);
      decoded.push(kind);
    }
    const fixture={...base,id:'icon-layout',name:'测试复合武器',en:125,hit:75,
      attack:{...base.attack,strikes:[{damageComponents:{shell:100}},{damageComponents:{shell:100}},{damageComponents:{beam:50}}]}};
    const host=document.createElement('div');host.id='weaponIconFixture';
    host.style.cssText='position:fixed;inset:10px;z-index:10000;padding:16px;background:#10283d;overflow:auto';
    for(const compact of [false,true]){
      const card=WeaponInfo.card(fixture,null,{compact,rounds:2,encyclopediaLink:true});
      card.style.cssText='width:min(100%,420px);box-sizing:border-box;margin:0 0 20px;padding:12px';host.append(card);
    }
    document.body.append(host);
    return decoded;
  });
  expect(result).toHaveLength(29);
  for(const card of await page.locator('#weaponIconFixture .weapon-card').all()){
    await expect(card.locator('.weapon-en-cost')).toHaveText('125');
    await expect(card.locator('.weapon-damage-formula')).toHaveText('2×100+1×50=250');
    await expect(card.locator('.weapon-rounds')).toHaveText('2');
    await expect(card.locator('.weapon-attributes')).toBeVisible();
    const layout=await card.evaluate(node=>{
      const summary=node.querySelector('.weapon-summary'),heading=node.querySelector('.weapon-summary-heading').getBoundingClientRect(),
        icon=node.querySelector('.weapon-type-icon').getBoundingClientRect(),visual=node.querySelector('.weapon-visual-row').getBoundingClientRect(),stats=node.querySelector('.weapon-statistics-row').getBoundingClientRect(),
        link=node.querySelector('.weapon-encyclopedia-link').getBoundingClientRect(),users=node.querySelector('.weapon-reference-actions > button').getBoundingClientRect();
      return {ordered:heading.left>=icon.right&&stats.top>=visual.bottom&&users.top>=link.bottom,overflow:summary.scrollWidth>summary.clientWidth+1};
    });
    expect(layout).toEqual({ordered:true,overflow:false});
  }
  await page.screenshot({path:`tmp/verification/screenshots/weapon-icons-${width}.png`});
  await page.locator('#weaponIconFixture').evaluate(node=>node.remove());
  await page.locator('#shellCatalog').click();await page.locator('#encyclopediaWeaponsTab').click();
  await expect(page.locator('#encyclopediaList .weapon-type-icon').first()).toBeVisible();
  expect(errors).toEqual([]);
});
