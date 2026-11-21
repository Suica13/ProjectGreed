const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../shared/pilots.js'),G=require('../shared/rules.js');
test('ordinary PMC profiles ignore supplied stats and retain stable random portraits',()=>{
 const p=P.generalPMC('pmc-general-unit-1',false);
 assert.equal(p.name,'一般PMC驾驶员');assert.equal(p.faction,'PMC');assert.equal(P.cost(p),0);
 assert.deepEqual(P.custom({...p,stats:Object.fromEntries(Object.keys(P.labels).map(k=>[k,9999])),portraitId:'forged'}),p);
 assert.equal(P.portrait(p),P.portrait(P.generalPMC(p.id,false)));
 assert(new Set(Array.from({length:32},(_,i)=>P.generalPMC('pmc-general-unit-'+i,false).portraitId)).size>1);
 for(const [key,range] of Object.entries(P.catalog.defaultRanges))assert(p.stats[key]>=range[0]&&p.stats[key]<=range[1],key);
});
test('battle rolls PMC attributes from the authoritative seed and corrects commander role',()=>{
 const modelId=Object.keys(G.models).find(k=>k.startsWith('RGM_79__')),model=G.models[modelId],entry={unitId:'RGM_79',kitId:model.kitId,customPilot:P.generalPMC('pmc-general-pilot',true)};
 entry.kitId=modelId.slice('RGM_79__'.length);
 const clean=G.validateFormation([entry],Infinity,72)[0];assert.equal(clean.customPilot.commander,false);
 const unit=G.makeUnit(clean,0,3,{x:0,y:0},0,1234567);
 assert.deepEqual(unit.pilot.stats,P.roll(null,1234567,0,3,model).stats);
 assert.notDeepEqual(unit.pilot.stats,G.makeUnit(clean,0,3,{x:0,y:0},0,7654321).pilot.stats);
});
test('development is read-only and technology rewards no longer accrue',()=>{
 const D=require('../shared/development.js'),B=require('../shared/battle-economy.js'),before=JSON.stringify(D.exportProgress());
 assert.equal(D.creditAward({id:'disabled-tech',matchId:'test',faction:'EFSF',points:10000}),false);
 assert.equal(D.research('EFSF',D.nodes('EFSF')[0].id),false);assert.equal(JSON.stringify(D.exportProgress()),before);
 const bonus=B.rewardMultipliers({technology:5,money:2,experience:3});assert.equal(bonus.technology,0);assert.equal(bonus.money,2);assert.equal(bonus.experience,3);
});
