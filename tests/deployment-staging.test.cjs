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
