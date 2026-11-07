const {test}=require("node:test"), assert=require("node:assert/strict");
const light=require("../client/map-shadow-lighting.js");
test("map direction and unit height control projection",()=>{
  assert.deepEqual(light.projection({direction:"center",distance:10},3),{x:0,y:0,alpha:0.5});
  assert.deepEqual(light.projection({direction:"lower",distance:2},3),{x:0,y:-6,alpha:0.5});
  assert.equal(light.projection({enabled:false},1).alpha,0);
  const p=light.projection({horizontalAngle:90,distance:2,intensity:9},2);
  assert.ok(p.x>0 && p.y>0);assert.equal(p.alpha,1);
});
