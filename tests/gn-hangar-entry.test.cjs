const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules');
const ids=['GN_001','GN_002','GN_003','GN_005'];
const carrier={unitId:'PegasusClass',kitId:'standard'};
const hangar=G.models.PegasusClass__standard.hangars.find(h=>h.kind!=='sfs');
const entries=[carrier,...ids.map(unitId=>({unitId,kitId:'default',preload:{carrierIndex:0,hangarId:hangar.id}}))];
test('all CB forms can use ordinary carrier hangars as well as SFS',()=>{
 for(const id of [...ids,'GN_003_MA']){
  const m=G.models[id+'__default'];
  assert(G.hangarAllowsModel(hangar,m),id);
  assert(m.transport.loadTags.includes('CanUseSFS'),id);
 }
 assert.deepEqual(G.planFormation(entries,99999,{requiresCarriers:true,fleetLimit:1}).disabled,[]);
});
test('CB units enter on a warship and launch without an intermediate SFS',()=>{
 const g=G.create(false,1,[entries,[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999});
 g.tiles.forEach(row=>row.fill('plain'));
 const ship=g.units.find(u=>G.modelOf(u).prefabId==='PegasusClass');
 Object.assign(ship,{x:10,y:10});g.deployment=null;G.hangars.sync(g);
 for(const id of ids){
  const u=g.units.find(u=>G.modelOf(u).prefabId===id);
  assert.equal(u.embarked?.carrierId,ship.id,id);
  const hp=u.hp,en=u.en,target=G.hangars.launchCells(g,u)[0];assert(target,id);
  G.hangars.launch(g,u,target.x,target.y);
  assert(!u.embarked,id);assert(G.onMap(u),id);
  assert.equal(u.hp,hp);assert.equal(u.en,en);
 }
});
