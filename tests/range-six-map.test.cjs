const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/contract-mode');
const Plugins=require('../shared/unit-plugins'),Classes=require('../shared/weapon-classes');
test('ordinary range increase remains uncompressed and reversible before manual offsets',()=>{
 const conversion=require('../shared/conversion-rules.cjs'),rules=conversion.read();
 const prefab=structuredClone(G.catalog.prefabs.find(p=>p.id==='RX_78_2'));
 rules.weapons.formationRangeBonus=0;conversion.globals(prefab,rules);
 const weapon=Object.values(prefab.weapons).find(w=>Classes.classify(w)==='beam_rifle');
 assert(weapon);const original=weapon.max;
 rules.weapons.formationRangeBonus=1;conversion.globals(prefab,rules);assert.equal(weapon.max,original+1);
 conversion.globals(prefab,rules);assert.equal(weapon.max,original+1);
 rules.weapons.formationRangeBonus=0;conversion.globals(prefab,rules);assert.equal(weapon.max,original);
 assert(Object.values(G.models).some(m=>m.weapons.some(w=>w.max>4)));
 assert(Object.values(G.models).every(m=>m.weapons.every(w=>!w.formationRange)));
});
test('row restrictions are removed and range plugins work again',()=>{
 assert.equal(G.setSquadRow,undefined);assert.equal(G.formationWeaponAllowed,undefined);
 const model=G.models.RGM_79__machine_gun;
 const modified=Plugins.apply(model,['long_barrel']);
 const index=model.weapons.findIndex(w=>Classes.classify(w)==='machine_gun');assert(index>=0);
 assert(modified.weapons[index].max>model.weapons[index].max);
 const e={unitId:'RGM_79',kitId:'machine_gun'},game=G.create(false,7,[[e],[e]],false,{fogMode:'disabled'});
 game.tiles.forEach(row=>row.fill('plain'));const [a,b]=game.units;
 Object.assign(a,{x:5,y:5,squadSlot:5});Object.assign(b,{x:5,y:7});
 assert(G.canAttack(game,a,b,model.weapons[index]));
});
test('six exposed SFS actors fill a cell and a seventh cannot join',()=>{
 const e={unitId:'RGM_79',kitId:'machine_gun'},game=G.create(false,7,[[e],[e]],false,{fogMode:'disabled'});
 const source=game.units[0];
 const [id,model]=Object.entries(G.models).find(([,m])=>m.hangars?.some(h=>h.kind==='sfs')&&(m.footprint?.width??1)===1&&(m.footprint?.height??1)===1);
 const hulls=Array.from({length:3},(_,i)=>({...structuredClone(source),id:'sfs-'+i,model:id,hp:model.hp,x:5,y:5,squadId:'six',squadSlot:i}));
 const passengers=hulls.map((h,i)=>({...structuredClone(source),id:'passenger-'+i,embarked:{carrierId:h.id,hangarId:model.hangars.find(h=>h.kind==='sfs').id,exposed:true}}));
 game.units=[...hulls,...passengers];assert(G.squadFits(hulls,game));
 assert.equal(G.squadRow(game,passengers[0]),'rear');
 assert.equal(G.squadRow(game,structuredClone(passengers[0])),'rear');
 game.units.push({...structuredClone(passengers[0]),id:'seventh'});assert.equal(G.squadFits(hulls,game),false);
});
test('only contract maps halve their dimensions while cell display remains doubled',()=>{
 assert.equal(G.mapCellPixels,320);
 for(let n=1;n<=6;n++){
  const settings={sweepDifficulty:n,sweepEra:'UC_0079_T1',sweepEnvironment:'ground'};
  const full=C.config(n,'UC_0079_T1'),small=C.scenarioConfig(settings);
  assert.equal(small.width,Math.ceil(full.width/2));assert.equal(small.height,Math.ceil(full.height/2));
 }
 const sources=require('../assets/unit-catalog.json').maps;
 for(const reference of sources){const map=require('../assets/'+reference),id=map.id;
  if(!G.catalog.maps[id]||id.startsWith('contract_'))continue;
  assert.equal(G.catalog.maps[id].width,map.width,id);assert.equal(G.catalog.maps[id].height,map.height,id);
 }
});
