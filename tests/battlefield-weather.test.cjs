const test=require("node:test"),assert=require("node:assert/strict");
const Climate=require("../shared/battlefield-climate.js");
test("weather weights, allowed set and deterministic duration",()=>{
 const map={environment:"ground",climate:{weather:{allowed:["rain","fog"],weights:{rain:1,fog:3},durationRounds:2},time:{allowed:["dawn","noon","evening"],durationRounds:4}}};
 const a=Climate.resolve(map,{},1,42);
 assert.ok(["rain","fog"].includes(a.weather));
 assert.deepEqual(Climate.resolve(map,{},1,42),Climate.resolve(map,{},2,42));
 assert.equal(Climate.resolve(map,{},1,42).time,"dawn");
 assert.equal(Climate.resolve(map,{},5,42).time,"noon");
 assert.equal(Climate.resolve(map,{},9,42).time,"evening");
 assert.equal(Climate.resolve(map,{timeCycle:false},9,42).time,"dawn");
});
test("weather and night sensor multipliers stack, buffs can be disabled",()=>{
 const map={environment:"ground"};
 const heavy=Climate.resolve(map,{weather:"heavy_rain",dayNight:"late_night"},1);
 assert.equal(heavy.sight,.75*.75);
 assert.equal(heavy.radar,.75*.75);
 const rain=Climate.resolve(map,{weather:"rain",dayNight:"noon"},1);
 assert.equal(rain.sight,.75);
 assert.equal(rain.radar,1);
 const fog=Climate.resolve(map,{weather:"fog",dayNight:"noon"},1);
 assert.equal(fog.sight,.75);
 assert.equal(fog.radar,1);
 const disabled=Climate.resolve(map,{weather:"blizzard",dayNight:"pre_dawn",climateBuffs:false},1);
 assert.equal(disabled.sight,1);assert.equal(disabled.radar,1);
});
test("space has no weather, time or penalties",()=>{
 const state=Climate.resolve({environment:"space"},{weather:"sandstorm",dayNight:"late_night"},12);
 assert.equal(state.weather,"none");assert.equal(state.time,"none");
 assert.equal(state.sight,1);assert.equal(state.radar,1);
});
