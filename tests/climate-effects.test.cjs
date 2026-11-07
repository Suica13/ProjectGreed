const test=require("node:test"),assert=require("node:assert/strict");
const Climate=require("../shared/battlefield-climate.js");
const Weather=require("../client/battlefield-weather.js");
test("surface state accumulates snow then retains it after weather changes",()=>{
 const map={environment:"ground",climate:{weather:{allowed:["snow"],weights:{snow:1},fixed:true},time:{allowed:["noon"],fixed:true}}};
 const before=Weather.surfaceState(map,{},1,1);
 const after=Weather.surfaceState(map,{},10,1);
 assert.ok(after.snow>before.snow);
 assert.equal(after.wet,0);
});
test("space maps have no accumulation or weather",()=>{
 const map={environment:"space"};
 assert.equal(Climate.resolve(map,{},12,1).weather,"none");
 assert.deepEqual(Weather.surfaceState(map,{},1,1),{snow:0,wet:0,dust:0});
});
