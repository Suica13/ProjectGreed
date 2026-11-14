const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const Conversion = require('../shared/conversion-rules.cjs');
const prefab = id => G.catalog.prefabs.find(p => p.id === id);
const entry = id => ({unitId:id, kitId:prefab(id).weaponKits[0].id});
const battle = () => G.create(false, 7, [[entry('GAT_X207')],[entry('ZGMF_1017')]], false,
  {costLimit:99999,unitCostLimit:99999,fogMode:'full'});

test('BaCUE has independent rail and missile kits with native volleys and visible turret joints', () => {
  const p=prefab('TMF_A_802');
  assert.deepEqual(p.weaponKits.map(k=>k.id),['standard','missile']);
  for(const [index,shots] of [2,7].entries()) {
    const kit=p.weaponKits[index], model=G.models[p.id+'__'+kit.id];
    const weapon=model.weapons.find(w=>w.type!=='melee');
    assert.equal(weapon.shotCount,shots);
    assert.equal(model.weapons.filter(w=>w.type!=='melee').length,1);
    assert(p.layers.some(l=>l.bone==='BackTurret'+index && l.visibleWhen.kit===kit.id));
    assert(weapon.muzzle.mounts.every(m=>m.bone==='BackTurret'+index));
  }
});

test('requested final SEED numbers survive shared global conversion and manual adjustments', () => {
  for(const [id,cost] of [['ZGMF_515',375],['ZGMF_600',400],['ZGMF_LRR704B',300]])assert.equal(prefab(id).stats.cost,cost);
  assert.equal(prefab('GAT_X207').stats.hp,37500);
  assert.equal(prefab('ZGMF_1017_H').weapons.ZAFT_ZGMF_1017_LBR.hit,60);
  const gun=prefab('ZGMF_515').weapons.ZAFT_ZGMF_515_Minigun;
  assert.equal(gun.attackRounds,1);assert.equal(gun.damagePerShot,200);
  assert.equal(gun.attack.steps.reduce((n,s)=>n+(s.shots||0)*(s.repeat||1),0),30);
  const sniper=prefab('ZGMF_LRR704B').weapons.ZGMF_LRR704B_LBR_Sniper_Aim;
  assert.equal(sniper.damagePerShot,7500);assert.equal(sniper.min,3);assert.equal(sniper.max,6);
  const buster=prefab('GAT_X103').weapons.OMNI_GAT_X103_BR_HyperSniper;
  assert.equal(buster.name,'组合式步枪[狙击]');assert.equal(buster.min,4);assert.equal(buster.max,6);
});

test('Duel preserves composite rifle/grenade attack and removes its duplicate ballistic menu entry', () => {
  for(const id of ['GAT_X102','GAT_X102_AS']){
    const p=prefab(id);
    assert(!p.weapons.OMNI_GAT_X102_BR_GL);
    assert(p.weapons.OMNI_GAT_X102_BR.attack.steps.some(s=>s.damageComponents?.shell>0));
    assert(p.weaponKits.every(k=>k.weapons.every(w=>!!p.weapons[w])));
  }
});

test('rail ammunition restores native speed without misclassifying the desert GM missile tube', () => {
  for(const p of G.catalog.prefabs)for(const w of Object.values(p.weapons)){
    if(!w.projectile?.texture.endsWith('/RailShell_1.png'))continue;
    if(w.nativePayload?.ProjectileSpeed && !w.special) {
      assert.equal(w.projectile.nativeSpeed,w.nativePayload.ProjectileSpeed,p.id+'/'+w.sourceName);
      assert.equal(w.projectile.speed,(w.projectile.presentationSpeed ?? w.nativePayload.ProjectileSpeed)*Conversion.read().weapons.projectileSpeed,p.id+'/'+w.sourceName);
    }
    if(/Railgun|RailBazooka/i.test(w.sourceName))assert.match(w.name,/磁轨炮/);
  }
  const missile=prefab('RGM_79_D').weapons.EF_Railgun_79_D_MS;
  assert(!missile.projectile.texture.endsWith('/RailShell_1.png'));
  assert(!missile.name.includes('磁轨炮'));
});

test('camouflage is authoritative, improves evasion and sensor stealth, and attacks disable it', () => {
  const g=battle(),[a,b]=g.units;
  Object.assign(a,{x:2,y:4});Object.assign(b,{x:4,y:4});
  const weapon={...G.modelOf(b).weapons.find(w=>w.type!=='melee'),hitScale:.5};
  const before=G.estimate(g,b,a,weapon).hit;
  G.useSkill(g,a,'OpticalCamouflage',a.x,a.y);
  assert(G.opticalCamouflageActive(a));assert(G.sensors.ranges(a,g).stealth);
  assert(G.estimate(g,b,a,weapon).hit<before);
  assert.equal(a.en,G.modelOf(a).en);
  assert(!G.canUseSkill(g,a,'OpticalCamouflage'));
  G.spendWeapon(a,G.modelOf(a).weapons.find(w=>w.type!=='melee'));
  assert(!G.opticalCamouflageActive(a));assert(!G.sensors.ranges(a,g).stealth);
});

test('camouflage upkeep charges only incoming own turns and cannot stay enabled at zero energy', () => {
  const g=battle(),a=g.units[0];
  G.useSkill(g,a,'OpticalCamouflage',a.x,a.y);
  const en=a.en;
  G.end(g);assert.equal(a.en,en);
  G.end(g);assert.equal(a.en,en-200);
  a.en=100;G.end(g);G.end(g);
  assert(!G.opticalCamouflageActive(a));assert(!a.opticalCamouflage);
  assert(!G.canUseSkill(g,a,'OpticalCamouflage'));
});
