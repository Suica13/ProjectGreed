const {test}=require("node:test"),assert=require("node:assert/strict");
const dialogue=require("../client/battle-dialogue.js");
test("carrier speaks first when boarding and launching",()=>{
 const carrier={id:"ship",pilot:{name:"舰长",personality:"strategic",originFaction:"EFSF"}};
 const passenger={id:"unit",pilot:{name:"机师",personality:"aggressive",originFaction:"EFSF"}};
 const board=dialogue.transport({event:"board",speaker:carrier,target:passenger,sequence:3});
 const launch=dialogue.transport({event:"launch",speaker:carrier,target:passenger,sequence:3});
 const preload=dialogue.transport({event:"preload",speaker:carrier,target:passenger,sequence:3,preloaded:true});
 assert.equal(board.speakerId,"ship");
 assert.equal(launch.speakerId,"ship");
 assert.equal(preload.preloaded,true);
 assert.notEqual(board.text,launch.text);
 assert.notEqual(preload.text,board.text);
 assert.match(dialogue.format(launch),/舰长/);
});
test("passenger may respond, but is not forced to",()=>{
 const carrier={id:"ship",pilot:{personality:"calm"}},passenger={id:"unit",pilot:{personality:"cautious"}};
 const results=Array.from({length:60},(_,sequence)=>dialogue.transportReply({event:"launch",speaker:passenger,target:carrier,sequence}));
 assert.ok(results.some(Boolean));
 assert.ok(results.some(v=>v===null));
});
