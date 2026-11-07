const test=require("node:test"),assert=require("node:assert/strict");
const Lighting=require("../client/map-shadow-lighting.js");
test("daylight and weather change shadows without changing base map settings",()=>{
 const base={direction:"upper",horizontalAngle:-45,distance:.2,intensity:.6};
 const noon=Lighting.fromClimate(base,{time:"noon",weather:"clear"});
 const dusk=Lighting.fromClimate(base,{time:"dusk",weather:"clear"});
 const storm=Lighting.fromClimate(base,{time:"noon",weather:"heavy_rain"});
 assert.ok(dusk.distance>noon.distance);
 assert.ok(storm.intensity<noon.intensity);
 assert.equal(base.distance,.2);
});
test("space has no terrain shadows",()=>{
 assert.equal(Lighting.fromClimate({intensity:.5},{space:true,time:"none",weather:"none"}).enabled,false);
});
