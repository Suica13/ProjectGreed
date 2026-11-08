const test = require('node:test');
const assert = require('node:assert/strict');
const Conversion = require('../shared/conversion-rules.cjs');
const Classes = require('../shared/weapon-classes.js');
const {applyWeaponBalance} = require('../tools/weapon-balance.cjs');
const config = Conversion.read();
function fixture(ship = false) {
  const weapon = kind => ({id:kind,weaponClass:kind,type:['melee','ram'].includes(kind)?'melee':'shell',hit:80,damagePerShot:10000,damageComponents:{shell:8000,shellAP:2000},antiSize:{medium:{accuracy:0.75,damage:1}},attack:{steps:[{accuracy:80,damagePerShot:10000,damageComponents:{shell:8000,shellAP:2000}}]}});
  return {stats:{ship},weapons:Object.fromEntries(['bazooka','beam_bazooka','panzerfaust','rifle','melee','ram','other'].map(k=>[k,weapon(k)])),skills:[{id:'irradiation',type:'irradiation',baseHit:60,damageComponents:{beam:10000}}]};
}
test('additive bazooka and shooting coefficients scale every payload without changing melee',()=>{
  const p = fixture(); applyWeaponBalance(p,config);
  for (const kind of ['bazooka','beam_bazooka','panzerfaust']) {
    assert.equal(p.weapons[kind].damagePerShot,5750);
    assert.equal(p.weapons[kind].attack.steps[0].damagePerShot,5750);
    assert.equal(p.weapons[kind].damageComponents.shellAP,1150);
  }
  assert.equal(p.weapons.rifle.damagePerShot,5000);
  assert.equal(p.weapons.melee.damagePerShot,7500);
  assert.equal(p.weapons.ram.damagePerShot,5625);
  assert.equal(p.skills[0].damageComponents.beam,5000);
  assert.equal(p.skills[0].baseHit,50);
  const first = structuredClone(p); applyWeaponBalance(p,config); assert.deepEqual(p,first);
});
test('shooting subtracts percentage points and ship compensation is bounded and repeatable',()=>{
  const p = fixture(true); applyWeaponBalance(p,config);
  for (const [kind,w] of Object.entries(p.weapons)) {
    assert.equal(w.hit,(Classes.baseHits[kind] ?? 80) - (['melee','ram'].includes(kind)?0:10));
    assert.equal(w.attack.steps[0].accuracy,w.hit);
    assert.equal(w.antiSize.medium.accuracy,0.9);
  }
  const first = structuredClone(p); applyWeaponBalance(p,config); assert.deepEqual(p,first);
  const q=fixture();applyWeaponBalance(q,config);assert.equal(q.weapons.rifle.antiSize.medium.accuracy,0.75);
  const capped=structuredClone(config);capped.weapons.shipMediumAccuracyBonus=0.5;
  applyWeaponBalance(p,capped);assert.equal(p.weapons.rifle.antiSize.medium.accuracy,1);
  const restored=structuredClone(config);
  restored.weapons.shootingDamageOffset=restored.weapons.shootingHitOffset=restored.weapons.shipMediumAccuracyBonus=0;
  applyWeaponBalance(p,restored);
  assert.equal(p.weapons.other.hit,80);assert.equal(p.weapons.other.attack.steps[0].accuracy,80);
  assert.equal(p.weapons.rifle.damagePerShot,7500);assert.equal(p.weapons.rifle.antiSize.medium.accuracy,0.75);
  assert.equal(p.skills[0].baseHit,60);
});
