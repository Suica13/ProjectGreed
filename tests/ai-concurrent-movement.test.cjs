const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const Timing = require("../shared/movement-timing.js");
const {createRoomEngine} = require("../shared/room-engine.js");

test("movement accelerates long paths, caps duration and preserves quick-mode timing",()=>{
  assert.equal(Timing.duration(1),80);
  assert.equal(Timing.duration(4),320);
  for(const count of [5,10,20,50,100]) {
    assert(Timing.duration(count)<=800);
    assert(Timing.step(count)<80);
    assert(Math.abs(Timing.duration(count,true)-Timing.duration(count)*50/120)<1e-10);
  }
  assert(Timing.duration(20)>Timing.duration(10));
  assert.equal(Timing.duration([]),0);
});

test("different AI players stagger independently without waiting for another animation",async t=>{
  let sequence=0;
  const seen=new Set(),moves=[];
  const offsets=[0,240];
  const engine=createRoomEngine({rules:G,randomId:()=>"id"+(++sequence),randomSeed:()=>1,
    randomAIMoveDelay:()=>offsets.shift() ?? 0,
    randomToken:()=>"token"+(++sequence),aiDelayMs:30,
    send:(ws,frame)=>{
      const event=frame.lastEvent;
      if(event?.type==="move"&&!seen.has(event.id)) {
        seen.add(event.id);moves.push({event,time:Date.now()});
      }
    }});
  t.after(()=>engine.close());
  const clients=Array.from({length:4},()=>({readyState:1}));
  engine.join(clients[0],{mode:"create",room:"CONCURRENT",characterFaction:"PMC",licenses:{Type61:true}});
  const room=engine.rooms.get("CONCURRENT");
  function act(seat,action,fields={}) {
    engine.action(clients[seat],{id:"action"+(++sequence),revision:room.revision,
      round:room.game?.round,action,...fields});
  }
  act(0,"configure_room",{...G.defaultRoomSettings(),mapId:"crossroads_2v2",fogMode:"disabled"});
  for(const ws of clients.slice(1))
    engine.join(ws,{mode:"join",room:room.code,characterFaction:"PMC",licenses:{Type61:true}});
  const formation=[{unitId:"Type61",kitId:"standard"}];
  for(let seat=0;seat<4;seat++)act(seat,"set_ready",{ready:true,formation});
  act(0,"start_game",{formation});
  for(let seat=0;seat<4;seat++)act(seat,"confirm_formation");
  for(let seat=0;seat<3;seat++)act(seat,"confirm_deployment");
  room.seats[0].bot=room.seats[2].bot=true;
  act(3,"confirm_deployment");
  room.game.tiles.forEach(row=>row.fill("plain"));
  for(const unit of room.game.units) {
    const seat=G.ownerOf(unit);
    Object.assign(unit,{x:unit.team===0?5:25,y:5+Math.floor(seat/2)*8});
  }
  room.turnNotBefore=0;
  const deadline=Date.now()+4000;
  while(moves.length<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(moves.length,2);
  const owners=moves.map(({event})=>G.ownerOf(room.game.units.find(u=>u.id===event.unitId)));
  assert.deepEqual(owners,[0,2]);
  assert(moves[1].time-moves[0].time>=150);
  // Random player delays stay unchanged; animations must still overlap at the faster rate.
  assert(moves[1].time-moves[0].time<Timing.duration(moves[0].event.path));
  assert.notDeepEqual(moves[0].event.path.at(-1),moves[1].event.path.at(-1));
});


test("all movement lengths and combat playback use a single 1.5x presentation rate",()=>{
 assert.equal(Timing.presentationSpeed,1.5);
 for(const count of [1,4,5,10,50,200]) {
  const before=Math.min(1200,count<=4?count*120:480+Math.sqrt(count-4)*90);
  assert.equal(Timing.duration(count),before/1.5);
  assert.equal(Timing.step(count)*count,Timing.duration(count));
 }
 assert.equal(Timing.combatRate(),1.5);
 assert.equal(Timing.combatRate(true),1.5/0.35);
 assert.equal(Timing.combatRate(true,true),1.5,"replay speed is already applied by its virtual clock");
});
