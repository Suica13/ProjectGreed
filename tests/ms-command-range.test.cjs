const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const G=require("../shared/rules");
function fixture() {
  const entry={unitId:"RGM_79",kitId:"machine_gun"};
  const game=G.create(false,1,[[entry,entry],[entry]],false,{costLimit:99999,unitCostLimit:99999,fogMode:"disabled"});
  game.tiles.forEach(row=>row.fill("plain"));
  const [a,b,enemy]=game.units;
  game.units.forEach((u,i)=>Object.assign(u,{x:5+i,y:5,pilot:{stats:{shooting:100,melee:100,defense:100,speed:100,accuracy:100,reaction:100,leadership:100,awakening:0}}}));
  return {game,a,b,enemy};
}
test("MS command activates strictly above 100 and its painted cells match actual distance and effects",()=>{
  const {game,a,b}=fixture();
  assert.equal(G.commandAura(a).active,false);
  assert.deepEqual(G.commandCells(game,a),[]);
  a.pilot.stats.leadership=101;
  const aura=G.commandAura(a),cells=G.commandCells(game,a),effect=G.commandEffects(game,b);
  assert.equal(aura.active,true);assert.equal(aura.radius,2);
  assert(Object.values(effect).some(value=>value===.1));
  for(let y=0;y<G.mapHeight(game);y++)for(let x=0;x<G.mapWidth(game);x++)
    assert.equal(cells.some(cell=>cell.x===x&&cell.y===y),G.dist(a,{x,y})<=aura.radius);
  a.embarked={carrierId:b.id};
  assert.deepEqual(G.commandCells(game,a),[]);
});
test("MS command range draws for its selection or an affected ally and leaves supply visuals independent",()=>{
  const {game,a,b,enemy}=fixture();
  const context=vm.createContext({Rules:G,game});
  vm.runInContext(fs.readFileSync("client/unit-identity.js","utf8")+";globalThis.identity=UnitIdentity;",context);
  let fills=0;
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){fills++;}};
  const draw=selected=>{fills=0;context.identity.drawCommandAura(ctx,a,{x:0,y:0},32,selected);return fills;};
  assert.equal(draw(a),0);
  a.pilot.stats.leadership=101;
  assert.equal(draw(a),G.commandCells(game,a).length);
  assert.equal(draw(b),G.commandCells(game,a).length);
  assert.equal(draw(enemy),0);assert.equal(draw(null),0);
  b.x=20;assert.equal(draw(b),0);
});
