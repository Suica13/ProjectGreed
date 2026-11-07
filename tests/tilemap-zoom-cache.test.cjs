const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), vm = require("node:vm");
test("zoom and pan reuse world chunks while maps and loaded images invalidate them", () => {
  let paints = 0, changed;
  const canvases = [], context = {save(){},restore(){},drawImage(){}};
  const sandbox = {
    TileMapView: {create(options) {changed=options.changed;return {draw(){paints++;}};}},
    document: {createElement() {const canvas={width:0,height:0,getContext:()=>context};canvases.push(canvas);return canvas;}},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("client/tilemap-renderer.js","utf8")+";globalThis.renderer=TileMapRenderer",sandbox);
  const map={id:"same-id",tileMap:{width:32,height:32,layers:[{visible:true,opacity:1,placement:"below"}]}};
  const draw=(tile,ox=0)=>sandbox.renderer.draw(context,map,"below",{tile,ox,oy:0},800,800);
  draw(10);assert.equal(paints,4);
  for(let i=0;i<20;i++)draw(10+i*.2,-i);
  assert.equal(paints,4,"camera changes must reuse the four overview chunks");
  draw(20);assert.equal(paints,8,"native resolution is rasterized only when changing detail tier");
  draw(21);assert.equal(paints,8);
  changed();draw(21);assert.equal(paints,12,"loaded textures invalidate partial images");
  map.tileMap={...map.tileMap};draw(21);assert.equal(paints,16,"document identity invalidates even when map ID is unchanged");
  assert(canvases.every(canvas=>canvas.width<=512&&canvas.height<=512));
});
