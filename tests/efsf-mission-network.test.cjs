const test=require('node:test'),assert=require('node:assert/strict'),{WebSocket,WebSocketServer}=require('ws');
const G=require('../shared/rules'),{createRoomEngine}=require('../shared/room-engine');
test('real sockets enforce mission acceptance, reject hidden stages',async t=>{
 let seq=0;const clients=[],sockets=[],wire=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>wire.once('listening',r));
 const engine=createRoomEngine({rules:G,randomId:()=>String(++seq),randomToken:()=>String(++seq),randomSeed:()=>77,aiDelayMs:999999,send:(ws,m)=>{if(ws?.readyState===1)ws.send(JSON.stringify(m));}});
 wire.on('connection',ws=>{sockets.push(ws);ws.on('message',raw=>{const m=JSON.parse(raw);try{if(m.action==='join')engine.join(ws,m);else engine.action(ws,m);ws.send(JSON.stringify({ack:m.id}));}catch(e){ws.send(JSON.stringify({ack:m.id,error:e.message}));}});});
 t.after(async()=>{engine.close();clients.forEach(w=>w.terminate());sockets.forEach(w=>w.terminate());await new Promise(r=>wire.close(r));});
 const ws=new WebSocket('ws://127.0.0.1:'+wire.address().port);clients.push(ws);await new Promise(r=>ws.once('open',r));
 const send=data=>new Promise((resolve,reject)=>{const id='req-'+ ++seq,timer=setTimeout(()=>{ws.off('message',read);reject(Error('timeout'));},10000);function read(raw){const m=JSON.parse(raw);if(m.ack!==id)return;clearTimeout(timer);ws.off('message',read);resolve(m);}ws.on('message',read);ws.send(JSON.stringify({...data,id}));});
 const join={action:'join',mode:'create',room:'SPECIAL',roomMode:'mission',characterFaction:'PMC',inventory:{ColumbusClass:2},licenses:{ColumbusClass:true}};
 assert.match((await send(join)).error,/接取/);
 const accepted=[{id:'efsf-19',status:'accepted',progressVersion:2}];assert(!(await send({...join,contactTasks:accepted})).error);
 const room=engine.rooms.get('SPECIAL');assert.equal(room.settings.mapId,'mission_efsf_19');
 const configure=async mapId=>send({action:'configure_room',...room.settings,mapId,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId});
 assert.match((await configure('mission_efsf_29')).error,/接取/);assert.equal(room.settings.mapId,'mission_efsf_19');
 assert.match((await configure('mission_white_base')).error,/未开放/);assert.equal(room.settings.mapId,'mission_efsf_19');
 const updated=await send({action:'set_ready',ready:false,contactTasks:[...accepted,{id:'efsf-29',status:'accepted',progressVersion:2}],revision:room.revision});assert(!updated.error,updated.error);
 const changed=await send({action:'configure_room',...room.settings,mapId:'mission_efsf_29',contactTasks:[...accepted,{id:'efsf-29',status:'accepted',progressVersion:2}],revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId});assert(!changed.error,changed.error);assert.equal(room.settings.mapId,'mission_efsf_29');
});
