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

test("taunts are deterministic and replies are conditional",()=>{
  const attacker={id:"attacker",pilot:{id:"p1",name:"攻击者",personality:"sarcastic",originFaction:"ZEON"}};
  const defender={id:"defender",pilot:{id:"p2",name:"防御者",personality:"strict",originFaction:"EFSF"}};
  let taunt=null, reply=null;
  for(let i=0;i<120;i++){
    const candidate=dialogue.generate({event:"taunt",speaker:attacker,target:defender,sequence:i});
    if(!candidate) continue;
    taunt=candidate;
    reply=dialogue.generate({event:"reply",speaker:defender,target:attacker,sequence:i+1});
    if(reply) break;
  }
  assert.ok(taunt);
  assert.equal(taunt.publicToOpponent,true);
  assert.equal(taunt.faction,"ZEON");
  assert.ok(reply);
  assert.equal(reply.publicToOpponent,true);
  assert.equal(reply.targetId,"attacker");
  assert.deepEqual(dialogue.generate({event:"taunt",speaker:attacker,target:defender,sequence:taunt.sequence}),taunt);
});
