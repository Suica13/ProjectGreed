const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id,
});
function scoutGame() {
  const g = G.create(false, 2, [[entry("MS_06E")], [entry("RGM_79")]], false, {costLimit:50000,unitCostLimit:10000});
  g.tiles=Array.from({length:40},()=>Array(70).fill("plain"));
  Object.assign(g.units[0],{x:2,y:10});Object.assign(g.units[1],{x:25,y:10});
  return g;
}
test("active scan is a single 100 EN use, marks without revealing bodies, expires and never drains automatically", () => {
  const g=scoutGame(), [a,b]=g.units, skill=G.unitSkills(a).find(s=>s.reconMode==="scan");
  assert(!G.sensors.detected(g,a.team,b));
  const before=a.en;
  G.useSkill(g,a,skill.id,a.x,a.y);
  assert.equal(a.en,before-100);
  assert.equal(a.actionPoints,4);
  assert.equal(a.acted,false);
  assert(G.sensors.detected(g,a.team,b));
  assert(!G.sensors.visible(g,a.team,b));
  assert(!G.canUseSkill(g,a,skill.id));
  const copy=JSON.parse(JSON.stringify(g));
  assert(G.sensors.detected(copy,a.team,copy.units[1]));
  assert(!G.sensors.detected(copy,2,copy.units[1]),"other teams cannot use this scan");
  G.end(g);G.end(g);
  assert(!G.sensors.detected(g,a.team,b));
  assert.equal(a.en,before-100);
  assert(G.canUseSkill(g,a,skill.id));
  a.en=99;assert(!G.canUseSkill(g,a,skill.id));
  a.en=100;a.actionPoints=0;assert(!G.canUseSkill(g,a,skill.id));
});
test("camera gun costs 30 EN, scouts chosen ground, retains relative detection range and expires next own turn", () => {
  const g=scoutGame(),[a,b]=g.units,skill=G.unitSkills(a).find(s=>s.reconMode==="camera");
  assert(!G.sensors.visible(g,a.team,b));
  const en=a.en, hp=b.hp;
  const event=G.useSkill(g,a,skill.id,25,10);
  assert.equal(a.en,en-30);assert.equal(b.hp,hp);assert.equal(a.actionPoints,4);
  assert.equal(event.sound.file,"../../sounds/Detect_4.ogg");
  assert.equal(event.weaponDisplayIndex,2);
  assert(G.sensors.visible(g,a.team,b));assert(G.sensors.detected(g,a.team,b));
  assert(!G.sensors.visible(g,2,b));
  b.x=34;
  assert(!G.sensors.visible(g,a.team,b));assert(G.sensors.detected(g,a.team,b));
  const copy=JSON.parse(JSON.stringify(g));
  assert.equal(copy.visionAreas[0].sight,7.5);
  assert.equal(copy.visionAreas[0].radar,9.375);
  G.end(g);assert(G.sensors.detected(g,a.team,b));G.end(g);
  assert(!G.sensors.detected(g,a.team,b));assert.equal(g.visionAreas.length,0);
});
test("scan accounts for anti-detection and airborne separation", () => {
  const g=scoutGame(),[a,b]=g.units,skill=G.unitSkills(a).find(s=>s.reconMode==="scan");
  b.flying=true;
  G.useSkill(g,a,skill.id,a.x,a.y);
  assert(!G.sensors.detected(g,a.team,b));
  const raw=G.models[b.model].sensors, saved={...raw};
  try {
    delete b.flying; raw.antiDetection=20;
    assert.equal(G.sensors.scanTargets(g,a,skill.range).length,0);
    raw.antiDetection=0;raw.antiDetect=true;
    assert.equal(G.sensors.scanTargets(g,a,skill.range).length,0);
  } finally {Object.assign(raw,saved);}
});

test("passive supply never resurrects a dead ship and does not consume EN", () => {
  const g = G.create(
    false,
    2,
    [[entry("ColumbusClass"), entry("RGM_79")], [entry("RGM_79")]],
    false,
    { mapId: "asteroid_crossing_1v1", costLimit: 50000, unitCostLimit: 10000 },
  );
  const u = g.units[0],
    m = G.modelOf(u);
  assert.ok(m.supplyAura);
  u.hp = 1;
  u.en = 50;
  G.end(g);
  G.end(g);
  assert.equal(u.hp, 1 + Math.round(m.hp * 0.05));
  assert.equal(u.en, 50 + m.en * 0.1);
  u.hp = 0;
  G.end(g);
  G.end(g);
  assert.equal(u.hp, 0);
});


test("supply overlay matches footprint range in both ship orientations", () => {
  const g = G.create(false, 2, [[entry("ColumbusClass")], [entry("RGM_79")]], false,
    {mapId:"asteroid_crossing_1v1",costLimit:50000,unitCostLimit:10000});
  const u = g.units[0];
  Object.assign(u,{x:10,y:10});
  for (const angle of [0,90]) {
    u.angle=angle;
    const area=new Set(G.supplyCells(g,u).map(c=>G.key(c.x,c.y)));
    for(let y=0;y<G.mapHeight(g);y++) for(let x=0;x<G.mapWidth(g);x++)
      assert.equal(area.has(G.key(x,y)),G.inSupplyRange(u,{x,y}));
    const size=G.dimensions(u), range=G.modelOf(u).supplyAura.range;
    assert(area.has(G.key(u.x+size.width-1+range,u.y)));
    assert(!area.has(G.key(u.x+size.width+range,u.y)));
  }
});
