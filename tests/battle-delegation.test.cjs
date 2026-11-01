const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules.js');
const Timing = require('../shared/movement-timing.js');
const {createRoomEngine} = require('../shared/room-engine.js');

function fixture(t, {count=1, delay=10000, offsets=[], campaign=false}={}) {
  let sequence=0;
  const frames=[], moves=[], seen=new Set();
  const rules=Object.create(G);
  // Isolate scheduling from tactical scoring; actions still use real movement validation.
  rules.aiChoice=(_game, unit)=>({x:unit.x+1,y:unit.y});
  const engine=createRoomEngine({rules, randomId:()=>`id-${++sequence}`,
    randomSeed:()=>1, randomToken:()=>`token-${++sequence}`, aiDelayMs:delay,
    randomAIMoveDelay:()=>offsets.shift() ?? 0,
    send:(ws, frame)=>{
      frames.push({ws,frame});
      if(frame.lastEvent?.type==='move'&&!seen.has(frame.lastEvent.id)) {
        seen.add(frame.lastEvent.id); moves.push({event:frame.lastEvent,time:Date.now()});
      }
    }});
  t.after(()=>engine.close());
  const clients=Array.from({length:4},()=>({readyState:1}));
  engine.join(clients[0],{mode:'create',room:'DELEGATE',characterFaction:'PMC'});
  const room=engine.rooms.get('DELEGATE');
  const act=(seat, action, fields={})=>engine.action(clients[seat],{
    id:`request-${++sequence}`,revision:room.revision,matchId:room.matchId,
    round:room.game.round,action,...fields});
  act(0,'configure_room',{...G.defaultRoomSettings(),mapId:'crossroads_2v2',fogMode:'disabled'});
  for(const ws of clients.slice(1)) engine.join(ws,{mode:'join',room:room.code,characterFaction:'PMC'});
  const entry={unitId:'Type61',kitId:'standard'};
  room.game=G.create(false,1,[Array(count).fill(entry),[entry],Array(count).fill(entry),[entry]],false,
    {mapId:'crossroads_2v2',fogMode:'disabled'});
  room.game.tiles.forEach(row=>row.fill('plain'));
  for(let seat=0;seat<4;seat++) {
    room.game.units.filter(u=>G.ownerOf(u)===seat).forEach((u,index)=>{
      Object.assign(u,{x:seat%2?25:3,y:2+index*2+(seat===2?1:0)});
    });
  }
  room.started=true;room.matchId='delegation-match';room.phase='idle';
  room.turnDone=[false,false,false,false];room.turnNotBefore=0;
  if(campaign) room.campaignBattle={delegatedSeats:[0,2]};
  engine.broadcast(room);
  return {engine,room,act,clients,frames,moves};
}

test('encounter delegation is personal, idempotent, reversible and forbids manual commands',t=>{
  const {room,act,frames}=fixture(t);
  const unit=room.game.units.find(u=>G.ownerOf(u)===0);
  act(0,'set_ai_delegate',{delegate:true,id:'same-request'});
  act(0,'set_ai_delegate',{delegate:true,id:'same-request'});
  assert.deepEqual(room.delegatedSeats,[0]);
  assert(!room.seats[0].bot);
  assert.deepEqual(frames.at(-1).frame.delegatedSeats,[0]);
  assert.throws(()=>act(0,'wait',{unitId:unit.id}),/委任AI/);
  assert.throws(()=>act(2,'wait',{unitId:unit.id}),/委任AI/);
  assert.throws(()=>act(2,'set_ai_delegate',{delegate:'yes'}),/状态无效/);
  assert.throws(()=>act(2,'set_ai_delegate',{delegate:true,matchId:'old'}),/战局已更新/);
  act(0,'set_ai_delegate',{delegate:false});
  assert.deepEqual(room.delegatedSeats,[]);
  act(0,'wait',{unitId:unit.id});
  assert.equal(unit.acted,true);
});

for(const campaign of [false,true]) test(`delegated players move independently (${campaign?'local campaign':'encounter'})`,async t=>{
  const {room,act,moves}=fixture(t,{delay:20,offsets:[0,240],campaign});
  if(!campaign) {
    act(0,'set_ai_delegate',{delegate:true});
    act(2,'set_ai_delegate',{delegate:true});
  }
  const end=Date.now()+4000;
  while(moves.length<2&&Date.now()<end) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(moves.length,2);
  assert.deepEqual(moves.map(({event})=>G.ownerOf(room.game.units.find(u=>u.id===event.unitId))),[0,2]);
  assert(moves[1].time-moves[0].time<Timing.duration(moves[0].event.path)+300);
});

test('large delegated armies overlap units without ending their turn during movement',async t=>{
  const {room,act,moves}=fixture(t,{count:8,delay:20});
  act(0,'set_ai_delegate',{delegate:true});
  act(2,'set_ai_delegate',{delegate:true});
  const end=Date.now()+4000;
  while(moves.length<4&&Date.now()<end) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(moves.length,4);
  const first=moves.slice(0,4);
  assert.equal(new Set(first.map(m=>m.event.unitId)).size,4);
  assert.deepEqual(first.map(({event})=>G.ownerOf(room.game.units.find(u=>u.id===event.unitId))),[0,2,0,2]);
  assert(first.at(-1).time-first[0].time<Timing.duration(first[0].event.path));
  assert.equal(room.turnDone[0],false);
  assert.equal(room.turnDone[2],false);
  for(const {event} of first) {
    const unit=room.game.units.find(u=>u.id===event.unitId);
    assert(!unit.acted,'moving actors must not attack/wait until their own movement ends');
  }
});

test('all six selectable rates scale movement and combat without accepting zero',()=>{
  try {
    for(const speed of Timing.speeds) {
      Timing.setPresentationSpeed(speed);
      assert.equal(Timing.duration(1),120/speed);
      assert.equal(Timing.combatRate(),speed);
    }
    assert.throws(()=>Timing.setPresentationSpeed(0));
  } finally { Timing.setPresentationSpeed(1.5); }
});
