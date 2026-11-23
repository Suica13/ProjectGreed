const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules"),{applyWeaponBalance}=require("../tools/weapon-balance.cjs");
test("every published 145-point ability gate is inclusive",()=>{
  let count=0;
  for(const p of G.catalog.prefabs)
    for(const ability of [...Object.values(p.weapons),...(p.skills||[])])
      for(const requirement of ability.pilotRequirements||[])
        if(requirement.value===145){assert.equal(requirement.operator,">=",p.id+"/"+ability.id);count++;}
  assert(count>=38);
});
test("145 satisfies the dual-saber gate while 144 does not",()=>{
  const g=G.create(false,1,[[{unitId:"RX_78_2",kitId:"kit_1"}],
    [{unitId:"RGM_79",kitId:"machine_gun"}]],false,{costLimit:99999,unitCostLimit:99999});
  const actor=g.units[0],weapon=G.modelOf(actor).weapons.find(w=>w.id==="EF_BeamSaber_Double_AALDF");
  actor.pilot={stats:{shooting:100,melee:144,defense:100,speed:100,accuracy:100,reaction:100,leadership:100,awakening:0}};
  assert.equal(G.pilotWeaponAllowed(actor,weapon),false);
  actor.pilot.stats.melee=145;assert.equal(G.pilotWeaponAllowed(actor,weapon),true);
});
test("skills use the same boundary policy and unrelated comparison operators stay intact",()=>{
  const requirements=[{stat:"melee",operator:">",value:145},{stat:"shooting",operator:">",value:150},
    {stat:"defense",operator:"<",value:145},{stat:"awakening",operator:">=",value:100}];
  const prefab={id:"gate-fixture",stats:{},weapons:{},skills:[{id:"skill",pilotRequirements:structuredClone(requirements)}]};
  applyWeaponBalance(prefab);
  assert.deepEqual(prefab.skills[0].pilotRequirements,[{...requirements[0],operator:">="},...requirements.slice(1)]);
});
