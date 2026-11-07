const test=require("node:test"),assert=require("node:assert/strict");
const Weather=require("../client/battlefield-weather.js");
test("map defaults and room overrides",()=>{
 assert.deepEqual(Weather.resolve({weather:{weather:"rain",dayNight:"night"}},{},0),{weather:"rain",phase:"night",cycleRounds:12});
 assert.equal(Weather.resolve({weather:{weather:"rain"}},{weather:"snow",dayNight:"day"},0).weather,"snow");
});
test("round-based day/night cycle is stable and bounded",()=>{
 const map={weather:{weather:"clear",dayNight:"cycle",cycleRounds:4}};
 assert.equal(Weather.resolve(map,{},0).phase,"day");
 assert.equal(Weather.resolve(map,{},4).phase,"night");
 assert.equal(Weather.resolve(map,{},8).phase,"day");
});
