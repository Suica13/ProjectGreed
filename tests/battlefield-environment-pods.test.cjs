const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),B=G.battlefieldMode;
const suitable=(m,env)=>env==='space'?m.adaptability.space>=100:m.adaptability.ground>=100||m.adaptability.air>=100;
test('every fixed and random faction wave fits the battlefield environment in every era and stage',()=>{
 let cases=0;
 for(const environment of ['ground','space'])for(const faction of B.factions)for(const era of B.erasForFaction(G,faction).filter(e=>B.eras.includes(e)))for(const round of [1,31,71]){
  const selected={faction,era};
  const pool=B.pool(G,{teams:[selected,selected]},0,environment);
  assert(pool.choices.length,environment+'/'+faction+'/'+era);
  for(const entry of pool.choices)assert(suitable(G.models[entry.unitId+'__'+entry.kitId],environment),JSON.stringify(entry));
  for(const random of [()=>0,()=>.99999]){
   const wave=B.wavePlan(G,selected,round,1,random,environment);
   assert(wave.length);
   for(const entry of wave)assert(suitable(G.models[entry.unitId+'__'+entry.kitId],environment),environment+'/'+faction+'/'+era+'/'+round+'/'+entry.unitId);
  }
  cases++;
 }
 assert(cases>=48);
});
test('actual first and subsequent airdrops respect both map environments',()=>{
 for(const environment of ['ground','space']){
  const map=Object.values(G.catalog.maps).find(m=>m.battlefield && m.environment===environment);
  assert(map);
  const game=G.create(false,871,Array(G.getMap(map.id).spawns.length).fill(null),false,{mode:'battlefield',mapId:map.id,battlefieldTeams:[{era:'UC_0079_T1',faction:'EFSF'},{era:'UC_0079_T1',faction:'ZEON'}]});
  game.round=31;B.reinforce(G,game);
  const ai=game.units.filter(u=>!u.facility);
  assert(ai.length);
  for(const unit of ai)assert(suitable(G.modelOf(unit),environment),environment+'/'+unit.model);
  for(const entry of game.battlefield.reinforcementQueue)assert(suitable(G.models[entry.unitId+'__'+entry.kitId],environment));
 }
});
test('all six mobile pods receive movement +1 and COST -25 across all kits',()=>{
 const expected={RB_79K:[125,5],RB_79:[75,4],RB_79N:[75,4],RB_79M:[75,4],MP_02A:[75,4],RB_79_LateType:[100,5]};
 for(const [id,[cost,move]] of Object.entries(expected)){
  const p=G.catalog.prefabs.find(p=>p.id===id);
  for(const kit of p.weaponKits){
   const m=G.models[id+'__'+kit.id];
   assert.equal(m.cost,cost+kit.cost,id+'/'+kit.id);assert.equal(m.move,move,id+'/'+kit.id);
  }
 }
});
