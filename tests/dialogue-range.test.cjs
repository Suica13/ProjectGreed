const {test}=require("node:test"), assert=require("node:assert/strict");
const range=require("../shared/dialogue-range.js");
test("ten-cell boundary and out-of-range dialogue",()=>{
 const a={id:"a",x:0,y:0}, b={id:"b",x:6,y:8}, c={id:"c",x:11,y:0};
 assert.equal(range.eligible(a,b),true);
 assert.equal(range.eligible(a,c),false);
});
test("embarked pilot communicates from its carrier location",()=>{
 const carrier={id:"ship",x:5,y:5};
 const pilot={id:"pilot",embarked:{carrierId:"ship"},x:100,y:100};
 const enemy={id:"enemy",x:13,y:5};
 assert.equal(range.eligible(pilot,enemy,id=>id==="ship"?carrier:null),true);
 assert.equal(range.eligible(pilot,{id:"far",x:20,y:5},id=>id==="ship"?carrier:null),false);
});
