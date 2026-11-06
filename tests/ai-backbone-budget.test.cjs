const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),D=require('../shared/development');
test('AI buys current main-line MS instead of reserving budget for cheap slot fillers',()=>{
 const saved={...G.models},nodes=D.nodes,base=G.models.RGM_79__machine_gun;
 try{
  for(const key of Object.keys(G.models))delete G.models[key];
  for(const [id,cost,tags] of [['obsolete',100,['MS']],['core-a',400,['MS']],['core-b',450,['MS']],['fighter',50,['Aircraft']]])
   G.models[id+'__standard']={...base,prefabId:id,kitId:'standard',cost,ship:false,unitTags:tags,hangars:[],skills:[],commandAuras:[],supplyAura:null};
  D.nodes=f=>f==='EFSF'?[
   {row:'mid',era:'0079T1',page:0,column:1,unlocks:['obsolete','fighter']},
   {row:'mid',era:'0079T2',page:1,column:3,unlocks:['core-a','core-b']},
  ]:[];
  for(let seed=1;seed<=30;seed++){
   const army=G.randomFormation(seed,1500,{},32);
   assert.equal(army.length,3);assert(army.every(e=>e.unitId.startsWith('core-')));
   assert(G.formationPoints(army)<32);
   assert(army.reduce((sum,e)=>sum+G.formationModel(e).cost,0)<=1500);
   assert.deepEqual(army,G.randomFormation(seed,1500,{},32));
  }
 }finally{D.nodes=nodes;for(const key of Object.keys(G.models))delete G.models[key];Object.assign(G.models,saved);}
});
