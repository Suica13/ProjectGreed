const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const G = require("../shared/rules.js");
const {createServer} = require("../server.js");

test("WebSocket launch preview preserves cargo and intel, rejects other intents, confirms only once",async t=>{
 const app=createServer({host:"127.0.0.1",port:0});const address=await app.listen();
 const clients=[];t.after(async()=>{for(const c of clients)c.ws.terminate();await app.close();});
 let sequence=0;
 async function connect(mode){
  const ws=new WebSocket(`ws://127.0.0.1:${address.port}/ws`),frames=[],listeners=new Set();
  ws.on("message",data=>{const frame=JSON.parse(data);frames.push(frame);for(const notify of listeners)notify();});
  const wait=predicate=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{listeners.delete(check);reject(Error("Message timeout"));},3000);
   function check(){const frame=frames.find(predicate);if(frame){clearTimeout(timer);listeners.delete(check);resolve(frame);}}
   listeners.add(check);check();
  });
  await new Promise((resolve,reject)=>{ws.once("open",resolve);ws.once("error",reject);});
  const client={ws,frames,wait};clients.push(client);
  ws.send(JSON.stringify({type:"hello",version:require("../project.json").version,mode,room:"LAUNCH",characterFaction:"PMC",inventory:{Medea:3,Type61:24}}));
  await wait(frame=>frame.type==="joined");await wait(frame=>frame.type==="state");return client;
 }
 const first=await connect("create"),second=await connect("join"),room=app.rooms.get("LAUNCH");
 async function act(client,action,fields={},id=`launch-request-${++sequence}`){
  client.ws.send(JSON.stringify({type:"action",action,id,revision:room.revision,round:room.game.round,matchId:room.matchId,...fields}));
  const frame=await client.wait(frame=>(frame.type==="state"&&frame.ack===id)||(frame.type==="error"&&frame.id===id));
  return frame;
 }
 async function ok(client,action,fields){const frame=await act(client,action,fields);assert.equal(frame.type,"state",JSON.stringify(frame));return frame;}
 await ok(first,"configure_room",{costLimit:99999,unitCostLimit:99999});
 const formation=[{unitId:"Medea",kitId:"standard"},{unitId:"Type61",kitId:"standard",preload:{carrierIndex:0,hangarId:"Hangar_1"}}];
 await ok(first,"set_ready",{ready:true,formation});await ok(second,"set_ready",{ready:true,formation:[{unitId:"Type61",kitId:"standard"}]});
 await ok(first,"start_game",{formation});await ok(first,"confirm_formation");await ok(second,"confirm_formation");
 assert.equal(room.phase,"deployment");
 const cargo=room.game.units.find(unit=>unit.embarked),carrier=room.game.units.find(unit=>unit.id===cargo.embarked.carrierId);
 const destination=G.hangars.launchCells(room.game,cargo)[0];assert(destination);
 const before=JSON.stringify(cargo),intelBefore=JSON.stringify(G.sensors.view(room.game,0));
 await ok(first,"launch",{unitId:cargo.id,x:destination.x,y:destination.y});
 assert(cargo.embarked);assert(cargo.pendingMove.launch);assert.equal(JSON.stringify(G.sensors.view(room.game,0)),intelBefore);
 assert.equal((await act(first,"confirm_deployment")).type,"error");
 assert.equal((await act(second,"confirm_move",{unitId:cargo.id})).type,"error");
 await ok(first,"cancel_move",{unitId:cargo.id});assert.equal(JSON.stringify(cargo),before);
 await ok(first,"launch",{unitId:cargo.id,x:destination.x,y:destination.y});
 const confirmId="launch-confirm-once";
 assert.equal((await act(first,"confirm_move",{unitId:cargo.id},confirmId)).type,"state");
 assert(!cargo.embarked);assert(!cargo.pendingMove);assert(G.onMap(cargo));
 const confirmed=JSON.stringify(room.game);
 await act(first,"confirm_move",{unitId:cargo.id},confirmId);assert.equal(JSON.stringify(room.game),confirmed);
 assert.equal(G.hangars.cargo(room.game,carrier).length,0);
});
