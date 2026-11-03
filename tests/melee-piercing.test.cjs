const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../shared/rules'), Sequence = require('../shared/weapon-sequence');
const Conversion = require('../shared/conversion-rules.cjs');

test('native B and F keep distinct clips and per-strike effects, including event slices', () => {
  const [modelId, model] = Object.entries(G.models).find(([,m]) => m.prefabId === 'RGM_79L');
  const weapon = model.weapons.find(w => w.id === 'EF_BeamSaber_BF');
  assert.equal(Sequence.pose(weapon, .2).clip, 'Common_Melee_B');
  assert.equal(Sequence.pose(weapon, 1.1).clip, 'Common_Melee_F');
  assert.deepEqual(weapon.attack.strikes.map(s=>s.swingEffects),
    [['Cqb_Fire_2_Pink_R'], ['Cqb_Fire_1_Pink_L']]);
  const sliced = G.eventWeapon({model:modelId}, {weapon:weapon.id,shotIndices:[1]});
  assert.deepEqual(sliced.attack.strikes[0].swingEffects,['Cqb_Fire_1_Pink_L']);
  assert.equal(Sequence.pose(sliced,1.1).clip,'Common_Melee_F');
  for (const id of weapon.attack.strikes.flatMap(s=>s.swingEffects))
    assert(G.catalog.effects[id]?.duration > 0);
});

function fixture(type='beam', count=3, decay=.5) {
  const weapon={type,weaponClass:'other',hit:100,en:10,min:1,max:5,
    damagePerShot:1300,damageComponents:{beam:1000,shell:200,beamAP:100},
    nativePayload:{ProjectileAttackTimes:count,ProjectileAttackTimesDamageModifier:decay},
    attack:{steps:[{delay:0,shots:1},{delay:.5,shots:1,damageComponents:{shell:500}}]}};
  return {id:'test',stats:{},weapons:{test:weapon}};
}
test('native decaying penetration adds count times 15 percent to matching channels only, once',()=>{
  const p=fixture(),rules=Conversion.read(); rules.weapons.damage=1;
  Conversion.globals(p,rules);
  const w=p.weapons.test;
  assert.deepEqual(w.damageComponents,{beam:1000,shell:200,beamAP:550,shellAP:90});
  assert.deepEqual(w.attack.steps[1].damageComponents,{shell:500,shellAP:225});
  const once=structuredClone(p); Conversion.globals(p,rules); assert.deepEqual(p,once);
  rules.weapons.damage=.5; Conversion.globals(p,rules);
  assert.deepEqual(w.damageComponents,{beam:500,shell:100,beamAP:275,shellAP:45});
  const compiled=Sequence.compile({...w,attack:{...w.attack,startAnimation:null}});
  assert(Object.values(compiled.damageComponents).every(n=>n%25===0));
});
test('melee hit counts, single-hit projectiles and nondecaying bullets gain no bonus',()=>{
  for (const p of [fixture('melee'),fixture('beam',1),fixture('shell',3,1)]) {
    const before=structuredClone(p.weapons.test.damageComponents),rules=Conversion.read();rules.weapons.damage=1;
    Conversion.globals(p,rules);assert.deepEqual(p.weapons.test.damageComponents,before);
  }
});
test('all catalog piercing bonuses retain native count and proper damage channels',()=>{
  let checked=0;
  for (const m of Object.values(G.models)) for (const w of m.weapons) {
    if (!w.penetrationBonus || !Object.keys(w.penetrationBonus).length) continue;
    assert.notEqual(w.type,'melee'); assert(w.penetrationCount>1);
    assert(w.nativePayload.ProjectileAttackTimesDamageModifier<1);
    assert(Object.keys(w.penetrationBonus).every(k=>['beamAP','shellAP'].includes(k)));
    checked++;
  }
  assert(checked>100,checked);
});
