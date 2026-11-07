const {test}=require("node:test"), assert=require("node:assert/strict");
const dialogue=require("../client/battle-dialogue.js");
test("dialogue is deterministic and respects pilot personality",()=>{
 const speaker={id:"u1",pilot:{id:"p1",name:"驾驶员",faction:"TITANS",personality:"cautious"}};
 const a=dialogue.generate({event:"kill",speaker,sequence:3});
 const b=dialogue.generate({event:"kill",speaker,sequence:3});
 assert.deepEqual(a,b);
 assert.equal(a.personality,"cautious");
 assert.equal(a.faction,"TITANS");
 assert.match(dialogue.format(a),/^\[战场对话\]/);
});
test("dialogue does not invent combat results",()=>{
 assert.equal(dialogue.generate({event:"unknown",speaker:{id:"a"}}),null);
 assert.equal(dialogue.generate({event:"kill"}),null);
});
