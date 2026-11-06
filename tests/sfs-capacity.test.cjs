const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules');
const entry=id=>{const m=Object.values(G.models).find(m=>m.prefabId===id);return {unitId:id,kitId:m.kitId};};
function fixture(){const g=G.create(false,4,[['DodaiKai','DodaiYS','RGM_79','RGM_79','RGM_79'].map(entry),[entry('Type61')]],false,{fogMode:'disabled',costLimit:99999,unitCostLimit:99999});g.deployment=null;g.tiles.forEach(row=>row.fill('plain'));g.units.forEach((u,i)=>Object.assign(u,{x:4+i,y:5,en:10000}));return g;}
function attach(g,u,carrier,index=0){u.embarked={carrierId:carrier.id,hangarId:G.hangars.of(carrier)[index].id,exposed:true};u.x=carrier.x;u.y=carrier.y;}
test('SFS squad points count one hull and every living carried MS, independently of ship cargo cost',()=>{
 const g=fixture(),[dual,single,a,b]=g.units;
 assert.equal(G.squadCapacity(dual,g),1);assert.equal(G.squadCapacity(single,g),1);
 assert.equal(G.modelOf(dual).transport.slotCost,4);
 attach(g,a,dual);assert.equal(G.squadCapacity(dual,g),3);
 attach(g,b,dual,1);assert.equal(G.squadCapacity(dual,g),5);
 assert(G.squadFits([dual],g));assert(!G.squadFits([dual,single],g));
 assert(!G.squadFits([dual,g.units[4]],g));
 b.hp=0;assert.equal(G.squadCapacity(dual,g),3);
 delete a.embarked;assert.equal(G.squadCapacity(dual,g),1);
});
test('two single-MS SFS formations use six points and reject an additional MS',()=>{
 const g=fixture(),[dual,single,a,b,extra]=g.units;
 attach(g,a,dual);attach(g,b,single);
 assert(G.squadFits([dual,single],g));assert(!G.squadFits([dual,single,extra],g));
});
test('a five-point double-MS SFS cannot merge with an empty SFS despite fitting the numeric ceiling',()=>{
 const g=fixture(),[dual,single,a,b]=g.units;attach(g,a,dual);attach(g,b,dual,1);
 Object.assign(single,{x:dual.x+1,y:dual.y,flying:dual.flying});
 assert(G.squadEligible(dual));assert(G.squadEligible(single));
 assert.equal(G.squadJoinTarget(g,single,dual.x,dual.y),null);
 assert.throws(()=>G.joinSquad(g,single,dual));
});
test('boarding cannot increase an existing SFS squad beyond its carried-unit capacity',()=>{
 const g=fixture(),[dual,single,a,b,extra]=g.units;
 Object.assign(single,{x:dual.x,y:dual.y,squadId:'loaded',squadSlot:1});Object.assign(dual,{squadId:'loaded',squadSlot:0});
 attach(g,a,dual);attach(g,b,single);Object.assign(extra,{x:dual.x,y:dual.y+1});
 assert.equal(G.squadMembers(g,dual).length,2);assert(G.squadFits([dual,single],g));
 const before=JSON.stringify(g.units);
 assert(!G.hangars.canEmbark(g,extra,dual,G.hangars.of(dual)[1].id));
 assert.throws(()=>G.hangars.embark(g,extra,dual,G.hangars.of(dual)[1].id));
 assert.equal(JSON.stringify(g.units),before);
});

test('bulk launch includes MS nested inside an SFS even while the carrier is hidden in a ship',()=>{
 const g=fixture(),[dual,single,a,b]=g.units;attach(g,a,dual);attach(g,b,dual,1);
 const ship=G.create(false,8,[[entry('Medea')],[entry('Type61')]],false,{costLimit:99999,unitCostLimit:99999}).units[0];
 Object.assign(ship,{id:'outer-ship',x:10,y:10});g.units.push(ship);
 const hangar=G.hangars.of(ship)[0];
 dual.embarked={carrierId:ship.id,hangarId:hangar.id};single.embarked={carrierId:ship.id,hangarId:hangar.id};
 G.hangars.sync(g);
 assert.equal(a.embarked.exposed,false);assert.equal(G.squadCapacity(dual,g),5);
 assert.deepEqual(G.hangars.launchSquadCells(g,[dual,single]),[]);
 assert(G.hangars.launchSquadCells(g,[dual]).length>0);
});
