const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules");
const {createRoomEngine}=require("../shared/room-engine");
function fixture() {
  const mapId="outer_orbit_5v5", map=G.getMap(mapId);
  const formations=map.spawns.map((_,i)=>i===0?[{unitId:"SalamisClass",kitId:"standard"}]:i===1?[{unitId:"RGM_79",kitId:"machine_gun"}]:null);
  const game=G.create(false,21,formations,false,{mapId,costLimit:99999,fogMode:"disabled"});
  game.tiles.forEach(row=>row.fill("plain"));
  const [ship,enemy]=game.units;
  Object.assign(ship,{x:30,y:25,angle:90});
  Object.assign(enemy,{x:16,y:25});
  return {game,ship,enemy};
}
test("AI ship heading correction consumes its remaining movement",()=>{
  const {game,ship}=fixture(), before=ship.angle;
  const choice=G.aiChoice(game,ship);
  assert(choice.rotation);
  assert(G.canRotate(game,ship,choice.rotation));
  G.previewRotate(game,ship,choice.rotation,0);
  G.confirmMove(game,ship,0);
  assert.notEqual(ship.angle,before);
  assert(ship.rotated && ship.moved);
  assert(!G.aiChoice(game,ship)?.rotation);
  const point=[...G.reachable(game,ship).values()].find(point=>point.path.length===1);
  assert(point);assert.throws(()=>G.previewMove(game,ship,point.x,point.y));
});
test("already aligned ships advance without wasting their turn on rotation",()=>{
  const {game,ship}=fixture();ship.angle=270;
  assert(!G.aiChoice(game,ship)?.rotation);
});
test("AI facing preferences cannot rotate through a blocked swept area",()=>{
  const {game,ship}=fixture();
  const occupied=new Set(G.cells(ship).map(p=>p.x+","+p.y));
  for(let y=ship.y-5;y<ship.y+8;y++)
    for(let x=ship.x-5;x<ship.x+8;x++)
      if(!occupied.has(x+","+y)) game.tiles[y][x]="rock";
  assert(!G.canRotate(game,ship,-1) && !G.canRotate(game,ship,1));
  assert(!G.aiChoice(game,ship)?.rotation);
});
for (const recovering of [false,true]) test("room AI confirms ship turns with recovering passenger="+recovering,async(t)=>{
  let serial=0;const errors=[];
  t.mock.method(console,"error",(...args)=>errors.push(args));
  const engine=createRoomEngine({rules:G,randomId:()=>"heading-"+(++serial),randomToken:()=>"token-"+(++serial),randomSeed:()=>21,aiDelayMs:1,randomAIMoveDelay:()=>0,send:()=>{}});
  t.after(()=>engine.close());
  const clients=[{readyState:1},{readyState:1}];
  engine.join(clients[0],{mode:"create",room:"HEADING",characterFaction:"PMC"});
  engine.join(clients[1],{mode:"join",room:"HEADING",characterFaction:"PMC"});
  const room=engine.rooms.get("HEADING"),{game,ship,enemy}=fixture();
  if(recovering) {
    const ally={...structuredClone(enemy),id:"recovery-passenger",team:ship.team,owner:0,x:34,y:25,en:0,acted:true};
    game.units.push(ally);
    assert(G.hangars.needsRecovery(ally));
    assert(G.dist(ship,ally)<=Math.max(2,G.modelOf(ally).move*2));
  }
  Object.assign(room,{game,started:true,matchId:"ship-heading",phase:"idle",activeSeats:[true,true],turnDone:[false,false],turnNotBefore:0,plans:[],planSequence:0,responses:[],reactions:[],pending:null});
  room.settings={...room.settings,mapId:game.mapId,fogMode:"disabled"};
  room.seats[0].bot=true;
  engine.broadcast(room);
  const deadline=Date.now()+5000;
  while(!ship.rotated && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert(ship.rotated,"AI must execute and confirm its rotation");
  assert.notEqual(ship.angle,90);
  assert(!ship.pendingMove);
  assert.deepEqual(errors,[]);
});
