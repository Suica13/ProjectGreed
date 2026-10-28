const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const entry = { unitId: "RGM_79", kitId: "machine_gun" };
function fixture(carrierId = "DodaiYS") {
  const g = G.create(false, 73, [[entry, entry, entry], [entry]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  const [carrier, u, extra, enemy] = g.units;
  carrier.model = Object.keys(G.models).find((id) => id.startsWith(carrierId + "__"));
  Object.assign(carrier, { x: 10, y: 8, hp: G.modelOf(carrier).hp, en: G.modelOf(carrier).en });
  Object.assign(u, { x: 9, y: 8 });
  Object.assign(extra, { x: 8, y: 9 });
  Object.assign(enemy, { x: 12, y: 8 });
  return { g, carrier, u, extra, enemy, h: G.hangars.of(carrier)[0] };
}
test("native SFS platforms have one exposed MS slot with original offsets", () => {
  const platforms = G.catalog.prefabs.filter((p) => p.hangars.some((h) => h.kind === "sfs"));
  assert.deepEqual(platforms.map((p) => p.id).sort(), [
    "Burstliner",
    "DodaiYS",
    "FFB_7Bst",
    "FF_X7Bst",
    "Skiure",
  ]);
  for (const p of platforms) {
    assert.equal(p.hangars[0].capacity, 1);
    assert(p.mechanics.filter((m) => m.id === "SFS").every((m) => m.status === "adapted"));
  }
  assert.equal(platforms.find((p) => p.id === "DodaiYS").hangars[0].offset.y, -7.5);
  assert.equal(platforms.find((p) => p.id === "Burstliner").hangars[0].offset.y, -2);
});
test("SFS passenger remains targetable and can fire, follows carrier, occupies no extra cell", () => {
  const { g, carrier, u, extra, enemy, h } = fixture();
  G.hangars.embark(g, u, carrier, h.id);
  assert(G.onMap(u));
  assert.equal(G.hangars.used(g, carrier, h.id), 1);
  assert(!G.hangars.canEmbark(g, extra, carrier, h.id));
  assert.equal(G.at(g, 10, 8), carrier);
  assert(G.canAttack(g, u, enemy, G.modelOf(u).weapons[0]));
  assert(G.canAttack(g, enemy, u, G.modelOf(enemy).weapons[0]));
  G.previewMove(g, carrier, 10, 7);
  assert.equal(u.y, 8, "preview must not move sensors or rider");
  G.confirmMove(g, carrier);
  assert.equal(u.y, 7);
  assert.equal(carrier.y, u.y);
  assert.equal(carrier.x, u.x);
});
test("moving onto SFS or an enclosed hangar requires mutation-free preview and supports cancellation", () => {
  for (const id of ["DodaiYS", "PegasusClass"]) {
    const { g, carrier, u, h } = fixture(id);
    const x = G.cells(carrier)[0].x,
      y = G.cells(carrier)[0].y;
    Object.assign(u, { x: x - 1, y });
    const before = structuredClone(u),
      intel = G.sensors.view(g, 0);
    G.previewMove(g, u, x, y);
    assert(u.pendingMove.boarding);
    assert(!u.embarked);
    assert.equal(u.x, before.x);
    assert.deepEqual(G.sensors.view(g, 0), intel);
    G.cancelMove(g, u);
    assert.deepEqual(u, before);
    G.previewMove(g, u, x, y);
    G.confirmMove(g, u);
    assert.equal(u.embarked.carrierId, carrier.id);
    assert.equal(u.embarked.hangarId, h.id);
    assert.equal(G.onMap(u), id === "DodaiYS");
    assert(u.moved && u.acted);
  }
});
test("SFS accepts MS only, enforces range, revalidates full slots at confirmation", () => {
  const { g, carrier, u, extra, h } = fixture();
  extra.model = Object.keys(G.models).find((id) => id.startsWith("Type61__"));
  Object.assign(extra, { x: 10, y: 9 });
  assert(!G.hangars.canEmbark(g, extra, carrier, h.id));
  assert(!G.reachable(g, extra).get(G.key(10, 8)));
  G.previewMove(g, u, 10, 8);
  extra.model = u.model;
  G.hangars.embark(g, extra, carrier, h.id);
  const before = structuredClone(u);
  assert.throws(() => G.confirmMove(g, u));
  assert.deepEqual(u, before);
  G.cancelMove(g, u);
  Object.assign(u, { x: 0, y: 0 });
  assert.throws(() => G.previewMove(g, u, 10, 8));
});
test("boarding confirmation never turns into a normal move when its carrier leaves", () => {
  const { g, carrier, u } = fixture();
  G.previewMove(g, u, 10, 8);
  G.move(g, carrier, 11, 7);
  const before = structuredClone(u);
  assert.throws(() => G.confirmMove(g, u));
  assert.deepEqual(u, before);
});
test("SFS dismount preview can be cancelled, then confirmed with existing launch AP rules", () => {
  const { g, carrier, u, h } = fixture();
  G.hangars.embark(g, u, carrier, h.id);
  G.end(g);
  G.end(g);
  const hp = u.hp,
    en = u.en;
  const p = G.hangars.launchCells(g, u)[0];
  assert(p);
  G.previewMove(g, u, p.x, p.y);
  assert(u.embarked);
  assert(u.pendingMove.launch);
  G.cancelMove(g, u);
  assert(u.embarked);
  assert.equal(u.x, carrier.x);
  G.previewMove(g, u, p.x, p.y);
  G.confirmMove(g, u);
  assert(!u.embarked);
  assert(u.moved && !u.acted);
  assert.equal(u.hp, hp);
  assert.equal(u.en, en);
  assert.equal(G.actionPoints(u), Math.ceil(G.actionBudget(u) * 0.75));
});
test("SFS does not repair passengers; carrier destruction uses hangar evacuation once", () => {
  const { g, carrier, u, h } = fixture();
  G.hangars.embark(g, u, carrier, h.id);
  u.hp = 1000;
  u.en = 0;
  G.end(g);
  G.end(g);
  assert.equal(u.hp, 1000);
  assert.equal(u.en, 0);
  u.hp = G.modelOf(u).hp;
  carrier.hp = 0;
  const exits = G.hangars.evacuate(g);
  assert.equal(exits.length, 1);
  assert(!u.embarked);
  assert.equal(G.hangars.evacuate(g).length, 0);
});
test("formation SFS preload counts one slot and creates an exposed passenger at carrier position", () => {
  const platform = G.catalog.prefabs.find((p) => p.id === "DodaiYS");
  const army = [
    { unitId: platform.id, kitId: platform.weaponKits[0].id },
    { ...entry, preload: { carrierIndex: 0, hangarId: "SFS01" } },
  ];
  const g = G.create(false, 4, [army, [entry]], true, { costLimit: 99999, unitCostLimit: 99999 });
  const [carrier, u] = g.units;
  assert(u.embarked.exposed);
  assert.equal(u.x, carrier.x);
  assert.equal(u.y, carrier.y);
  G.confirmDeployment(g, 0);
});


test("Burstliner irradiation requires a living MS in its own SFS slot",()=>{
  const {g,carrier,u,extra,enemy,h}=fixture("Burstliner");
  const skill=G.unitSkills(carrier).find(s=>s.type === "irradiation");assert.equal(skill.requiresSfsMS,true);
  assert.equal(G.canUseSkill(g,carrier,skill.id),false);
  G.hangars.embark(g,u,carrier,h.id);assert.equal(G.canUseSkill(g,carrier,skill.id),true);
  u.hp=0;assert.equal(G.canUseSkill(g,carrier,skill.id),false);
  u.hp=1;u.embarked.hangarId="forged-slot";assert.equal(G.canUseSkill(g,carrier,skill.id),false);
  u.embarked.hangarId=h.id;u.model=Object.keys(G.models).find(id=>G.models[id].prefabId === "Type61");
  assert.equal(G.canUseSkill(g,carrier,skill.id),false);
  u.model=extra.model;u.embarked.carrierId=extra.id;assert.equal(G.canUseSkill(g,carrier,skill.id),false);
});
