const test=require('node:test'),assert=require('node:assert/strict');
const {createStateOutbox}=require('../tools/state-outbox.cjs'),Wire=require('../shared/state-wire');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function state(revision){return {type:'state',room:'weak',matchId:'m',viewTeam:0,you:{id:'p',seat:0},revision,game:{units:[{id:'a',hp:revision}],tiles:Array.from({length:32},()=>Array(32).fill('plain'))}};}
function peer(){return {readyState:1,bufferedAmount:0,sent:[],send(raw){this.sent.push(JSON.parse(raw));},terminate(){this.readyState=3;}};}
test('congested states coalesce before delta encoding, preserve receipts and freeze the last private snapshot',async t=>{
 const encoder=Wire.createEncoder(),decoder=Wire.createDecoder(),socket=peer();
 const outbox=createStateOutbox({highWater:100,pollMs:5,encode:(_,s)=>encoder.encode(s)});t.after(()=>outbox.close());
 outbox.send(socket,state(0));socket.bufferedAmount=200;
 for(let revision=1;revision<=100;revision++)outbox.send(socket,state(revision));
 const last=state(101);outbox.send(socket,last);last.game.units[0].hp=999;
 assert.equal(socket.sent.length,1);assert.equal(outbox.pending,1);
 socket.bufferedAmount=0;for(let i=0;i<100&&socket.sent.length<2;i++)await pause(5);
 assert.equal(socket.sent.length,2);assert.equal(socket.sent[1].type,'state_delta');
 decoder.decode(socket.sent[0]);const received=decoder.decode(socket.sent[1]);
 assert.equal(received.revision,101);assert.equal(received.game.units[0].hp,101);
 assert.equal(socket.sent[1].baseSequence,1);assert.equal(socket.sent[1].sequence,2);
});
test('slow recipients never block fast peers or reliable non-state replies',async t=>{
 const slow=peer(),fast=peer();slow.bufferedAmount=200;
 const box=createStateOutbox({highWater:100,pollMs:5,encode:(_,s)=>JSON.stringify(s)});t.after(()=>box.close());
 for(let i=0;i<30;i++){box.send(slow,state(i));box.send(fast,state(i));}
 box.send(slow,{type:'action_receipt',id:'once',revision:29});
 box.send(slow,{type:'chat',message:{text:'reliable'}});
 assert.equal(fast.sent.length,30);assert.deepEqual(slow.sent.map(m=>m.type),['action_receipt','chat']);
 slow.bufferedAmount=0;await pause(20);assert.equal(slow.sent.at(-1).revision,29);
});
test('disconnect and hard buffer limits release pending snapshots',async()=>{
 const socket=peer(),box=createStateOutbox({highWater:10,hardLimit:100,pollMs:5,encode:(_,s)=>JSON.stringify(s)});
 socket.bufferedAmount=20;box.send(socket,state(1));socket.readyState=3;await pause(20);assert.equal(box.pending,0);
 const overflow=peer();overflow.bufferedAmount=101;box.send(overflow,state(2));assert.equal(overflow.readyState,3);box.close();
});
