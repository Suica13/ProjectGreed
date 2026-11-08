const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules');
function fixture(){
 const g=G.create(false,7319,[[{unitId:'Medea',kitId:'standard'},...Array.from({length:4},()=>({unitId:'RGM_79',kitId:'machine_gun'}))],[{unitId:'Type61',kitId:'standard'}]],true,{costLimit:99999,unitCostLimit:99999});
 g.tiles.forEach(row=>row.fill('plain'));
 const carrier=g.units[0],u=g.units[1],hangar=G.hangars.of(carrier)[0];
 Object.assign(carrier,{x:2,y:2});Object.assign(u,{x:8,y:8});
 return {g,carrier,u,hangar};
}
test('deployment drag boarding accepts a remote passenger in the shared deployment area without changing resources',()=>{
 const {g,carrier,u,hangar}=fixture();
 assert(!G.hangars.boardingPlan(g,[u],carrier,hangar.id));
 assert(G.hangars.boardingPlan(g,[u],carrier,hangar.id,true));
 const resources={hp:u.hp,en:u.en,shield:u.shield};
 G.hangars.embarkSquad(g,u,carrier,hangar.id,true,true);
 assert.equal(u.embarked.carrierId,carrier.id);
 assert.deepEqual({hp:u.hp,en:u.en,shield:u.shield},resources);
 assert.equal(u.embarked.boardRound,null);
});
test('deployment drop preserves capacity, type, confirmed deployment and area restrictions',()=>{
 const {g,carrier,u,hangar}=fixture();
 for(const passenger of g.units.filter(actor=>actor.team===0&&actor!==carrier&&actor!==u))
  G.hangars.embarkSquad(g,passenger,carrier,hangar.id,true,true);
 const before=JSON.stringify(u);
 assert.throws(()=>G.hangars.embarkSquad(g,u,carrier,hangar.id,true,true));
 assert.equal(JSON.stringify(u),before);
 const other=fixture();other.carrier.x=20;
 assert(!G.hangars.boardingPlan(other.g,[other.u],other.carrier,other.hangar.id,true));
 const locked=fixture();locked.g.deployment[0]=true;
 assert(!G.hangars.boardingPlan(locked.g,[locked.u],locked.carrier,locked.hangar.id,true));
 const hostile=fixture();hostile.carrier.team=1;
 assert(!G.hangars.boardingPlan(hostile.g,[hostile.u],hostile.carrier,hostile.hangar.id,true));
});
test('deployment drag flag never bypasses ordinary battle boarding distance',()=>{
 const {g,carrier,u,hangar}=fixture();g.deployment=[true,true];
 assert(!G.hangars.boardingPlan(g,[u],carrier,hangar.id,true));
 assert.throws(()=>G.hangars.embarkSquad(g,u,carrier,hangar.id,true,true));
 assert(!u.embarked);
});

test('deployment places preloaded passengers directly and preserves resources',()=>{
 const {g,carrier,u,hangar}=fixture();
 G.hangars.embarkSquad(g,u,carrier,hangar.id,true,true);
 const before={hp:u.hp,en:u.en,shield:u.shield,moved:u.moved,acted:u.acted};
 const cell=G.deploymentCells(g,0,u).find(p=>G.fits(g,u,p.x,p.y,u.angle,false,0));
 assert(cell);G.deploy(g,0,u.id,cell.x,cell.y);
 assert(!u.embarked);assert.deepEqual({x:u.x,y:u.y},cell);
 assert.equal(G.hangars.cargo(g,carrier).some(actor=>actor.id===u.id),false);
 assert.deepEqual({hp:u.hp,en:u.en,shield:u.shield,moved:u.moved,acted:u.acted},before);
});

test('invalid or unauthorized passenger deployment keeps the transport manifest unchanged',()=>{
 const {g,carrier,u,hangar}=fixture();
 G.hangars.embarkSquad(g,u,carrier,hangar.id,true,true);
 const before=JSON.stringify(g);
 assert.throws(()=>G.deploy(g,1,u.id,2,4));assert.equal(JSON.stringify(g),before);
 assert.throws(()=>G.deploy(g,0,u.id,-1,-1));assert.equal(JSON.stringify(g),before);
 g.deployment[0]=true;const locked=JSON.stringify(g);
 assert.throws(()=>G.deploy(g,0,u.id,2,4));assert.equal(JSON.stringify(g),locked);
});
