const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id,
});
test("reconnaissance is a server-side action: marks enemies, offsets concealment, expires and survives JSON snapshots", () => {
  const g = G.create(false, 2, [[entry("Type74"), entry("RGM_79")], [entry("MS_06E")]], false, {
    costLimit: 5000,
    unitCostLimit: 2000,
  });
  const [a, b, c] = g.units;
  Object.assign(a, { x: 4, y: 4 });
  Object.assign(b, { x: 5, y: 4 });
  Object.assign(c, { x: 7, y: 4 });
  g.tiles.forEach((r) => r.fill("plain"));
  const skill = G.unitSkills(a).find((s) => s.type === "recon");
  const weapon = G.modelOf(b).weapons[0],
    before = G.estimate(g, b, c, weapon).hit;
  const event = G.useSkill(g, a, skill.id, a.x, a.y);
  assert.ok(event.spottedIds.includes(c.id));
  assert.equal(a.en, G.modelOf(a).en - 15);
  assert.equal(a.acted, true);
  assert.ok(G.estimate(g, b, c, weapon).hit > before);
  assert.equal(c.spottedUntilRound, g.round + 1);
  const snapshot = JSON.parse(JSON.stringify(g));
  assert.equal(snapshot.units.find((u) => u.id === c.id).spottedUntilRound, c.spottedUntilRound);
  G.end(g);
  G.end(g);
  assert.equal(G.estimate(g, b, c, weapon).hit, before);
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
