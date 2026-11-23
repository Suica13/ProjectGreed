const test=require('node:test'),assert=require('node:assert/strict');
const {WebSocket,WebSocketServer}=require('ws');
const G=require('../shared/rules'),{createRoomEngine}=require('../shared/room-engine');

test('two WebSocket players advance after A ends with hangar cargo and B extracts last',async t=>{
 let serial=0;
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise(resolve=>server.once('listening',resolve));
 const sockets=[],clients=[];
 const engine=createRoomEngine({rules:G,randomId:()=>`extract-${++serial}`,
  randomToken:()=>`token-${++serial}`,randomSeed:()=>11,aiDelayMs:0,
  send:(socket,message)=>socket.send(JSON.stringify(message))});
 server.on('connection',socket=>{
  sockets.push(socket);
  socket.on('message',data=>{
   const message=JSON.parse(data);
   try{engine.action(socket,message);}catch(error){socket.send(JSON.stringify({type:'error',message:error.message}));}
  });
 });
 t.after(async()=>{
  engine.close();for(const socket of clients)socket.terminate();for(const socket of sockets)socket.terminate();
  await new Promise(resolve=>server.close(resolve));
 });
 for(let i=0;i<2;i++){
  const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const client={socket,state:null,errors:[]};clients.push(socket);
  socket.on('message',data=>{
   const message=JSON.parse(data);if(message.type==='state')client.state=message;
   if(message.type==='error')client.errors.push(message.message);
  });
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  clients[i].view=client;
  engine.join(sockets[i],{mode:i?'join':'create',room:'EXTRACTWIRE',roomMode:'sweep',characterFaction:'PMC',
   inventory:{Medea:1},licenses:{Medea:true},
   storedUnits:[{id:'stock',unitId:'Medea',kitId:'standard',hp:G.models.Medea__standard.hp,en:G.models.Medea__standard.en}]});
 }
 const room=engine.rooms.get('EXTRACTWIRE');
 async function until(predicate){
  const deadline=Date.now()+7000;
  while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert(predicate(),JSON.stringify({phase:room.phase,turnDone:room.turnDone,errors:clients.map(c=>c.view.errors)}));
 }
 async function act(index,action,fields={}){
  const id=`action-${++serial}`;
  clients[index].send(JSON.stringify({id,revision:room.revision,round:room.game.round,phase:room.phase,
   matchId:room.matchId,action,...fields}));
  await until(()=>clients[index].view.state?.ack===id || clients[index].view.errors.length);
  assert.deepEqual(clients[index].view.errors,[]);
 }
 const formation=[{unitId:'Medea',kitId:'standard',stockId:'stock'}];
 await act(0,'configure_room',{...room.settings,sweepDifficulty:1,sweepEra:'UC_0079_T1',sweepFaction:'ZEON',sweepEnvironment:'ground'});
 await act(1,'set_ready',{ready:true,formation});await act(0,'start_game',{formation});
 for(let i=0;i<2;i++)await act(i,'confirm_formation');
 for(let i=0;i<2;i++){await act(i,'auto_place_deployment');await act(i,'confirm_deployment');}
 const game=room.game,carrier=game.units.find(u=>G.ownerOf(u)===0),departing=game.units.find(u=>G.ownerOf(u)===2);
 const passenger=G.makeUnit({unitId:'RGM_79',kitId:'machine_gun'},0,'wire-cargo',{x:carrier.x,y:carrier.y});
 passenger.ownerSeat=0;passenger.acted=false;
 passenger.embarked={carrierId:carrier.id,hangarId:G.hangars.of(carrier)[0].id};game.units.push(passenger);G.hangars.sync(game);
 Object.assign(departing,game.contract.extraction,{acted:false,moved:false});
 assert(G.hangars.launchCells(game,passenger).length);
 const round=game.round;
 await act(0,'end_turn');assert.equal(room.turnDone[0],true);assert.equal(game.round,round);
 departing.acted=true;
 await new Promise(resolve=>setTimeout(resolve,1300));
 assert.equal(game.round,round,'B must still explicitly end or extract even when their unit has waited');
 await act(1,'contract_extract',{unitId:departing.id});
 assert(departing.contractExtracted);
 await until(()=>clients.every(c=>c.view.state?.game.round>round));
 assert(clients.every(c=>!c.view.errors.length));
 assert(passenger.embarked,'ending plans does not launch or discard cargo');
});
