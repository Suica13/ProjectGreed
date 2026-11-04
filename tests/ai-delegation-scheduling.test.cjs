const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),{createRoomEngine}=require('../shared/room-engine');
test('frequent delegated-player broadcasts do not starve either AI team',async t=>{
 let id=0;const moved=new Set(),errors=[];
 t.mock.method(console,'error',(...args)=>errors.push(args));
 const engine=createRoomEngine({rules:G,randomId:()=>`fair-${++id}`,randomToken:()=>`token-${++id}`,
 randomSeed:()=>1,aiDelayMs:1,randomAIMoveDelay:()=>0,
 send:(ws,frame)=>{if(frame.lastEvent?.type==='move')moved.add(frame.lastEvent.unitId);}});
 t.after(()=>engine.close());const clients=Array.from({length:4},()=>({readyState:1}));
 engine.join(clients[0],{mode:'create',room:'FAIRAI',characterFaction:'PMC'});
 const room=engine.rooms.get('FAIRAI');
 const act=(seat,action,fields={})=>engine.action(clients[seat],{id:`request-${++id}`,revision:room.revision,round:room.game.round,action,...fields});
 act(0,'configure_room',{...G.defaultRoomSettings(),mapId:'crossroads_2v2',fogMode:'disabled'});
 for(const ws of clients.slice(1))engine.join(ws,{mode:'join',room:room.code,characterFaction:'PMC'});
 const entry={unitId:'Type61',kitId:'standard'};
 room.game=G.create(false,1,[[entry],[entry],[entry],[entry]],false,{...room.settings,fogMode:'disabled'});
 room.game.tiles.forEach(row=>row.fill('plain'));room.game.deployment=null;
 room.game.units.forEach((u,i)=>Object.assign(u,{x:u.team===0?3:20,y:4+Math.floor(i/2)*8}));
 Object.assign(room,{started:true,matchId:'fairness',phase:'idle',activeSeats:[true,true,true,true],turnDone:[false,false,false,false],
 turnNotBefore:0,plans:[],planSequence:0,responses:[],reactions:[],pending:null,delegatedSeats:[0,2]});
 room.seats[1].bot=room.seats[3].bot=true;
 const chatter=setInterval(()=>engine.broadcast(room),15);t.after(()=>clearInterval(chatter));
 engine.broadcast(room);
 const deadline=Date.now()+6000;
 while(Date.now()<deadline&&!room.game.units.filter(u=>u.team===1).some(u=>moved.has(u.id)))
  await new Promise(resolve=>setTimeout(resolve,15));
 assert(room.game.units.filter(u=>u.team===0).every(u=>moved.has(u.id)),'both delegated players get movement slots');
 assert(room.game.units.filter(u=>u.team===1).some(u=>moved.has(u.id)),'enemy AI proceeds after delegated players finish');
 assert.deepEqual(errors,[]);
});
