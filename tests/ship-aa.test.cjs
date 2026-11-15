const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const entry = id => ({unitId:id,kitId:require('../shared/economy').defaultKit(id)});

test('ship AA batteries become one physical area skill and keep native ports', () => {
  let count=0;
  for(const model of Object.values(G.models)) {
    const skill=model.skills.find(s=>s.id==='ShipAntiAirVolley');
    if(!skill)continue;
    count++;
    assert(model.ship);
    assert.equal(skill.range,2);
    assert.equal(skill.baseHit,75);
    assert.deepEqual(skill.damageComponents,{shell:3500});
    assert.equal(skill.cooldownTurns,0);
    assert(!model.weapons.some(w=>w.rangeRole==='ship_anti_air'));
    assert.equal(skill.muzzle.mounts.length,skill.barrageProjectiles.length);
    for(const p of skill.barrageProjectiles)assert(G.catalog.assets[p.asset]);
    require('../shared/unit-skills').validate([skill],model.prefabId);
  }
  assert(count>=48);
});

test('ship barrage hits nearby allies and enemies once, costs EN once and respects destroyed AA modules', () => {
  const g=G.create(false,17,[[entry('SalamisClass'),entry('RGM_79')],[entry('RGM_79'),entry('RGM_79')]],false,
    {mapId:'asteroid_crossing_1v1',costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
  g.deployment=null;
  g.tiles.forEach(r=>r.fill('plain'));
  const [a,friend,enemy,far]=g.units;
  Object.assign(a,{x:10,y:10});
  Object.assign(friend,{x:8,y:10});
  Object.assign(enemy,{x:12,y:10});
  Object.assign(far,{x:18,y:10});
  const skill=G.unitSkills(a).find(s=>s.id==='ShipAntiAirVolley');
  a.moduleHp=Object.fromEntries(skill.moduleIds.map(id=>[id,0]));
  assert(!G.canUseSkill(g,a,skill.id));
  a.moduleHp[skill.moduleIds[0]]=1;
  assert(G.canUseSkill(g,a,skill.id));
  const en=a.en;
  const event=G.useSkill(g,a,skill.id,a.x,a.y);
  assert.deepEqual(event.hits.map(h=>h.unitId).sort(),[friend.id,enemy.id].sort());
  assert.equal(a.en,en-skill.enCost);
  assert(!G.canUseSkill(g,a,skill.id));
  assert.equal(event.barrageProjectiles.length,skill.muzzle.mounts.length);
  assert(a.acted);
});
