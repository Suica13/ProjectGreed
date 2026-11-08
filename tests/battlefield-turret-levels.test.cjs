const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../shared/rules');
const S=require('../shared/weapon-sequence');
const Fire=require('../shared/automatic-fire');
const B=G.battlefieldMode;
test('each era creates authoritative turret tiers with independent durability, damage and accuracy growth',()=>{
  const baseline=structuredClone(G.models.Facility_MG__standard);
  for(const [index,era] of B.eras.entries()){
    const faction=era.startsWith('0087')?'AEUG':'EFSF';
    const settings={mode:'battlefield',mapId:B.defaultMapId,battlefieldTeams:[{faction,era},{faction,era}]};
    const game=G.create(false,7319,Array(12).fill(null),false,settings);
    const level=index+1,factor=1.25**index;
    for(const unit of game.units.filter(u=>u.facility)){
      const original=G.models[unit.model],model=G.modelOf(unit);
      if(['base','radar'].includes(unit.facility.type)){
        assert.equal(unit.hp,original.hp);assert.equal(model.accuracy,G.modelOf({...unit,facility:null}).accuracy);continue;
      }
      assert.equal(unit.facility.level,level);
      assert.equal(unit.hp,Math.round(original.hp*factor));assert.equal(model.hp,unit.hp);
      assert.equal(model.accuracy,Math.round(Math.round(original.accuracy*1.1**index)*G.pilots.modifiers(unit,original).accuracy));
      assert.equal(model.move,original.move);assert.equal(model.en,original.en);
      assert.equal(G.modelOf(structuredClone(unit)).hp,model.hp);
      for(const [i,w] of model.weapons.entries()){
        assert.equal(w.hit,original.weapons[i].hit);
        assert.equal(w.damagePerShot,S.roundDamage(original.weapons[i].damagePerShot*factor));
        assert.equal(w.max,original.weapons[i].max);
        assert(w.attack.strikes.every(s=>Object.values(s.damageComponents||w.damageComponents).every(v=>v%25===0)));
        assert.deepEqual(G.weaponStats(w,unit).damageComponents,w.damageComponents);
      }
    }
    assert(game.units.filter(u=>u.facility?.type==='base').every(u=>u.hp===300000));
  }
  assert.deepEqual(G.models.Facility_MG__standard,baseline);
});
test('turret firing rounds and machine-gun emissions match actual automatic-fire plans',()=>{
  const game=G.create(false,1,Array(12).fill(null),false,{mode:'battlefield',mapId:B.defaultMapId});
  for(const [type,rounds,shots] of [['machineGun',2,12],['beam',3,2],['missile',2,4],['cannon',3,1]]){
    const unit=game.units.find(u=>u.facility?.type===type);
    const weapon=G.modelOf(unit).weapons[0];
    assert.equal(weapon.attackRounds,rounds);assert.equal(weapon.shotCount,shots);
    assert.equal(weapon.attack.strikes.length,shots);
    assert.equal(Fire.roundCount(G,game,unit,weapon),rounds);
  }
});
