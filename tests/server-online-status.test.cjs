const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),WebSocket=require('ws');
const {createServer}=require('../server');
test('server status counts unique players, excluding probes and duplicate lobby/game connections',async t=>{
 const app=createServer({host:'127.0.0.1',port:0});const address=await app.listen();
 const peers=[];t.after(async()=>{for(const ws of peers)ws.terminate();await app.close();});
 async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${address.port}/ws`);peers.push(ws);await new Promise(r=>ws.once('open',r));return ws;}
 function request(ws,payload,type){return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{ws.off('message',receive);reject(Error('status timeout'));},3000);
  function receive(raw){const data=JSON.parse(raw);if(data.type!==type)return;clearTimeout(timeout);ws.off('message',receive);resolve(data);}
  ws.on('message',receive);ws.send(JSON.stringify(payload));
 });}
 const probe=await connect(),status=()=>request(probe,{type:'list_rooms',statusOnly:true},'rooms');
 assert.equal((await status()).onlinePlayers,0);
 const identity={id:randomUUID(),secret:'a'.repeat(64)};
 const lobby=await connect();
 lobby.send(JSON.stringify({type:'activity_hello',version:require('../project.json').version,identity,name:'status player'}));
 assert.equal((await request(lobby,{type:'list_rooms'},'rooms')).onlinePlayers,1);
 const game=await connect();
 game.send(JSON.stringify({type:'activity_hello',version:require('../project.json').version,identity,name:'status player'}));
 assert.equal((await request(game,{type:'ping'},'pong')).onlinePlayers,1);
 assert.equal((await status()).onlinePlayers,1);
 const other=await connect();assert.equal((await request(other,{type:'list_rooms'},'rooms')).onlinePlayers,2);
 lobby.close();await new Promise(r=>lobby.once('close',r));
 assert.equal((await status()).onlinePlayers,2);
 game.close();await new Promise(r=>game.once('close',r));
 const info=await status();assert.equal(info.onlinePlayers,1);
 assert(!JSON.stringify(info).includes(identity.id));assert(!JSON.stringify(info).includes(identity.secret));
 const health=await(await fetch(`http://127.0.0.1:${address.port}/health`)).json();assert.equal(health.onlinePlayers,1);
});
