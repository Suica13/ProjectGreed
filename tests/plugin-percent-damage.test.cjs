const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),P=require('../shared/unit-plugins');
const base=G.models.RGM_79__beam_spray;
function weapon(type,weaponClass,damageComponents){return {id:weaponClass,type,weaponClass,damageComponents,damagePerShot:10000,hitsPerShot:2,attack:{steps:[{damageComponents}],strikes:[{damageComponents,damageMultiplier:2}]}};}
test('percentage plugins stack once per applicable class and preserve multi-hit sequences',()=>{
 const w=weapon('melee','melee',{meleeBeam:8000,meleeBeamAP:2000});
 const m=P.apply({...base,weapons:[w],skills:[w]},['beam_melee','internal_arm','aiming_system']);
 for(const result of [m.weapons[0],m.skills[0]]){
  assert.deepEqual(result.damageComponents,{meleeBeam:9600,meleeBeamAP:2400});
  assert.deepEqual(result.attack.steps[0].damageComponents,result.damageComponents);
  assert.deepEqual(result.attack.strikes[0].damageComponents,result.damageComponents);
  assert.equal(result.damage,48000);assert.equal(result.hitsPerShot,2);
 }
 assert.deepEqual(w.damageComponents,{meleeBeam:8000,meleeBeamAP:2000});
});
test('beam cannon AP overlap applies once; fixed ammunition adds after percentage',()=>{
 const cannon=weapon('beam','beam_cannon',{beam:8000,beamAP:2000});
 const result=P.apply({...base,weapons:[cannon]},['focus_ring']).weapons[0];
 assert.equal(result.damagePerShot,10500);
 const rocket=weapon('shell','bazooka',{shell:10000});
 assert.equal(P.apply({...base,weapons:[rocket]},['rocket_head','aiming_system','luna_ammo']).weapons[0].damagePerShot,11050);
 assert.equal(P.apply({...base,weapons:[rocket]},['beam_melee','internal_arm']).weapons[0],rocket);
 const grenade=weapon('shell','grenade',{shell:10000});
 assert.equal(P.apply({...base,weapons:[grenade]},['special_explosives']).weapons[0].damagePerShot,11500);
});
