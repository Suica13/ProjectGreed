const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules");
test("ordinary AI uses total budget and at most three carriers, with competitive cargo",()=>{
  for(const mode of ["regular","battlefield"]) for(const seed of [1,7319,98765]) {
    const settings={...G.defaultRoomSettings(),mapId:null,mode,costLimit:10000,unitLimit:18,
      unitCostLimit:250,battlefieldEra:"0079T2",technologyCaps:Object.fromEntries(G.factions.map(f=>[f,999999]))};
    const player={bot:true,seat:0,characterFaction:"EFSF",researched:[]};
    const rules=G.armyRestrictions(settings,player);
    assert.equal(rules.unitCostLimit,Infinity);
    const candidateLimit=G.armyUnitLimit(settings,player);
    assert.equal(candidateLimit,G.catalog.formation.maxUnits);
    const army=G.randomFormation(seed,10000,rules,candidateLimit);
    assert(army.some(e=>G.formationModel(e).ship));
    assert(army.some(e=>!G.isFleetCarrier(G.formationModel(e))&&G.formationModel(e).cost>500));
    assert(army.every(e=>G.isFleetCarrier(G.formationModel(e))||e.preload));
    assert(army.filter(e=>!e.preload&&G.isFleetCarrier(G.formationModel(e))).length<=3);
    assert.deepEqual(G.planFormation(army,10000,rules,candidateLimit).reasons,{});
    assert.deepEqual(G.randomFormation(seed,10000,rules,candidateLimit),army);
  }
  const free=G.armyRestrictions({...G.defaultRoomSettings(),mode:"quick",formationStyle:"free",unitCostLimit:250},{bot:true});
  assert.equal(free.unitCostLimit,250);
  assert(!free.requiresCarriers);
});
test("all mercenary maps expose five player positions per side plus separate faction allies",()=>{
  for(const raw of Object.values(G.catalog.maps).filter(m=>m.battlefield)) {
    const map=G.getMap(raw.id);
    assert.equal(map.spawns.length,12);
    for(const team of [0,1]) assert.deepEqual(map.spawns.filter(s=>s.team===team&&!s.fixedAlly).map(s=>s.position),[1,2,3,4,5]);
  }
});
