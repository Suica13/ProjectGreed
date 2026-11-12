const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules");
test("ordinary AI uses standard total budget and capacity, carries competitive units aboard ships",()=>{
  for(const mode of ["regular","battlefield"]) for(const seed of [1,7319,98765]) {
    const settings={...G.defaultRoomSettings(),mapId:null,mode,costLimit:10000,unitLimit:18,
      unitCostLimit:250,battlefieldEra:"0079T2",technologyCaps:Object.fromEntries(G.factions.map(f=>[f,999999]))};
    const player={bot:true,seat:0,characterFaction:"EFSF",researched:[]};
    const rules=G.armyRestrictions(settings,player);
    assert.equal(rules.unitCostLimit,Infinity);
    assert.equal(G.armyUnitLimit(settings,player),18);
    const army=G.randomFormation(seed,10000,rules,18);
    assert(army.some(e=>G.formationModel(e).ship));
    assert(army.some(e=>!G.isFleetCarrier(G.formationModel(e))&&G.formationModel(e).cost>500));
    assert(army.every(e=>G.isFleetCarrier(G.formationModel(e))||e.preload));
    assert(G.formationPoints(army)<=18);
    assert.deepEqual(G.planFormation(army,10000,rules,18).reasons,{});
    assert.deepEqual(G.randomFormation(seed,10000,rules,18),army);
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
