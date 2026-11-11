const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules");
test("staged units leave the map and can be auto-placed before confirmation",()=>{
 const map=G.getMap();
 const formations=map.spawns.map(()=>null);
 formations[0]=[{unitId:"Type61",kitId:require("../shared/production-data.cjs").defaultKits.Type61}];
 const game=G.create(false,1,formations,true,{mapId:map.id});
 const actor=game.units[0];
 G.stageDeployment(game,0,actor.id);
 assert.equal(G.onMap(actor),false);
 assert.throws(()=>G.confirmDeployment(game,0),/未部署/);
 G.autoPlaceDeployment(game,0);
 assert.equal(G.onMap(actor),true);
 assert.equal(actor.deploymentStaged,undefined);
});

test("auto deployment fills legal squads while preserving embarked passengers and ownership",()=>{
 const tank={unitId:"Type61",kitId:"standard"},carrier={unitId:"Medea",kitId:"standard"};
 const formations=G.getMap().spawns.map(()=>null);
 formations[0]=[carrier,{...tank,preload:{carrierIndex:0,hangarId:"Hangar_1"}},...Array.from({length:7},()=>({...tank}))];
 formations[1]=[{...tank}];
 const game=G.create(false,1,formations,true,{costLimit:99999,unitCostLimit:99999,unitLimit:72});
 const passenger=game.units.find(u=>u.ownerSeat===0&&u.formationIndex===1);
 const embarked=structuredClone(passenger.embarked);
 const troops=game.units.filter(u=>u.ownerSeat===0&&!u.embarked);
 for(const actor of troops)G.stageDeployment(game,0,actor.id);
 G.autoPlaceDeployment(game,0);
 assert.deepEqual(passenger.embarked,embarked);
 assert(troops.every(u=>G.onMap(u)&&!u.deploymentStaged));
 const soldiers=troops.filter(u=>G.squadEligible(u));
 const squads=[...new Set(soldiers.map(u=>u.squadId||u.id))].map(id=>soldiers.filter(u=>(u.squadId||u.id)===id));
 assert(squads.some(s=>s.length>1));
 assert(squads.length<soldiers.length);
 for(let i=0;i<squads.length;i++)for(let j=i+1;j<squads.length;j++)assert(!G.squadFits([...squads[i],...squads[j]],game));
 for(const squad of squads){assert(G.squadFits(squad,game));assert(squad.every(u=>u.ownerSeat===0));}
 G.confirmDeployment(game,0);
 const before=JSON.stringify(game.units.map(u=>[u.id,u.squadId,u.embarked]));
 assert.throws(()=>G.autoPlaceDeployment(game,0),/已确认/);
 assert.equal(JSON.stringify(game.units.map(u=>[u.id,u.squadId,u.embarked])),before);
});
