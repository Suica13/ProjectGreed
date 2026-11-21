const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const G=require('../shared/rules.js'),Classes=require('../shared/weapon-classes.js');
const definitions=require('../assets/weapons.json').definitions;
test('beam scatter guns retain native pellets and use shotgun names, classes and localized kits',()=>{
  for(const [unit,source,shots] of [['RGM_79HC','EF_BeamSprayGunE2',8],['RGM_79FD','EF_BeamSprayGunFD',6],['RGM_79_D','EF_BeamSprayGunFD',6]]){
    const prefab=G.catalog.prefabs.find(p=>p.id===unit),weapon=prefab.weapons[source];
    assert.equal(weapon.name,'光束霰弹枪');assert.equal(Classes.classify(weapon),'beam_shotgun');
    assert.equal(weapon.localization.en.name,'Beam Shotgun');assert.equal(weapon.localization.ja.name,'ビーム・ショットガン');
    assert.equal(weapon.nativeTiming.projectiles,shots);
    assert.equal(weapon.attack.steps.reduce((sum,step)=>sum+(step.shots||0)*(step.repeat||1),0),shots);
    for(const model of Object.values(G.models).filter(m=>m.prefabId===unit)){
      const compiled=model.weapons.find(w=>w.sourceName===source);if(!compiled)continue;
      assert.equal(Classes.classify(compiled),'beam_shotgun');assert.equal(Classes.rounds(compiled),1);
    }
  }
  assert.equal(definitions.EF_BeamSprayGunE2__lv1.damagePerShot,1250);
  assert.equal(definitions.EF_BeamSprayGunE2__lv1.en,40);
});
test('native scatter carriers identify shields, wrist guns and ballistic shotguns without treating bazookas or ordinary spray guns as shotguns',()=>{
  let count=0;
  for(const weapon of Object.values(definitions)){
    if(!weapon.nativeProjectile?.match(/^Projectile_(Beam|Shell)ShotGun/))continue;
    const expected=weapon.nativeProjectile.startsWith('Projectile_Beam')?'beam_shotgun':'shell_shotgun';
    assert.equal(Classes.classify(weapon),expected,weapon.sourceName);assert.equal(weapon.category,expected);count++;
  }
  assert(count>=29);
  assert.match(definitions.NZN_MSN_03_ShieldBSG__lv1.name,/盾牌光束霰弹枪/);
  assert.match(definitions.Common_ArmBSG_L_Yellow_NRX_055__lv1.name,/腕部光束霰弹枪/);
  for(const source of ['EF_BeamSprayGun','EF_BeamSprayGunB2','EF_BeamSprayGunF'])assert.equal(Classes.classify(definitions[source+'__lv1']),'beam_spray');
  for(const weapon of Object.values(definitions).filter(w=>/Bazooka.*ShotgunMode/.test(w.sourceName)))assert.equal(Classes.classify(weapon),'bazooka');
});
test('native importer marks actual scatter carriers before category and multilingual naming policies',()=>{
  const result=JSON.parse(execFileSync('python',['-c',`
import sys,json
sys.path.insert(0,'tools')
from native_combat import native_weapon
from native_weapon_names import label
from weapon_policy import category
from weapon_store import loads
from mod_source import ASSETS,MOD,load
p=loads((ASSETS/'units/RGM_79HC/unit.json').read_text(encoding='utf8'))
w=p['weapons']['EF_BeamSprayGunE2'];w.pop('weaponClass',None);w.pop('nativeProjectile',None)
native_weapon(p,w,load(MOD/p['source']))
print(json.dumps({'class':w['weaponClass'],'projectile':w['nativeProjectile'],'category':category(w['sourceName'],w),'names':label(w['sourceName'],w)},ensure_ascii=True))
`],{encoding:'utf8'}));
  assert.equal(result.class,'beam_shotgun');assert.equal(result.category,'beam_shotgun');
  assert.equal(result.projectile,'Projectile_BeamShotGun_Pink');assert.equal(result.names[0],'光束霰弹枪');
});
