const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules");
test("deployment rotation checks final footprint and permits repeated turns", () => {
  const game=G.create(false,71,Array.from({length:G.getMap("outer_orbit_5v5").spawns.length},(_,i)=>i===0?[{unitId:"SalamisClass",kitId:"standard"}]:i===1?[{unitId:"RGM_79",kitId:"machine_gun"}]:null),true,{mapId:"outer_orbit_5v5",costLimit:99999});
  game.tiles.forEach(row=>row.fill("plain"));
  game.deployment=[false,false];
  game.spawns=G.getMap(game.mapId).spawns;
  game.deploymentAreas=Array.from({length:game.spawns.length},()=>({x:0,y:0,width:G.mapWidth(game),height:G.mapHeight(game)}));
  const [ship,other]=game.units;
  Object.assign(ship,{x:20,y:20,angle:0});
  Object.assign(other,{x:45,y:30});
  ship.deploymentStaged=true;
  const stagedAngle=ship.angle;
  for(let i=0;i<4;i++) { assert(G.canRotate(game,ship,1));G.rotate(game,ship,1); }
  assert.equal(ship.angle,stagedAngle);
  assert.equal(ship.deploymentStaged,true);
  delete ship.deploymentStaged;
  delete ship.rotationPivot;
  Object.assign(ship,{x:20,y:20});
  const original=G.cells(ship), startAngle=ship.angle;
  G.rotate(game,ship,1);
  const rotated=G.cells(ship);
  G.rotate(game,ship,-1);
  const occupied=new Set([...original,...rotated].map(p=>p.x+","+p.y));
  const xs=[...original,...rotated].map(p=>p.x),ys=[...original,...rotated].map(p=>p.y);
  let obstacle;
  for(let y=Math.min(...ys);y<=Math.max(...ys);y++)
    for(let x=Math.min(...xs);x<=Math.max(...xs);x++)
      if(!occupied.has(x+","+y))obstacle={x,y};
  assert(obstacle);
  Object.assign(other,obstacle);
  assert(G.canRotate(game,ship,1));
  game.deployment.fill(true);
  game.team=ship.team;
  assert.equal(G.canRotate(game,ship,1),false);
  game.deployment.fill(false);
  G.rotate(game,ship,1);
  Object.assign(other,{x:45,y:30});
  for(let i=0;i<3;i++) { assert(G.canRotate(game,ship,1));G.rotate(game,ship,1); }
  assert.equal(ship.angle,startAngle);
  assert(!ship.rotated && !ship.moved);
  Object.assign(other,rotated.find(p=>!original.some(q=>q.x===p.x&&q.y===p.y)));
  assert.equal(G.canRotate(game,ship,1),false);
});
