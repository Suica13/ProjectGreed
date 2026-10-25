const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  manifest = require("../tools/0079-page-one-manifest.json");
const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id,
});
const settings = { mapId: "coastal_supply_2v2", costLimit: 50000, unitCostLimit: 10000 };
function game(army) {
  return G.create(false, 2, [army, [entry("RGM_79")], null, null], false, settings);
}
test("all 135 Page_00 combat entries are present, while ACE pilots, buildings, radars and turrets are excluded", () => {
  const combat = manifest.filter((r) => !r.tags.split(",").includes("Pilot"));
  assert.equal(combat.length, 135);
  for (const row of combat) {
    const p = G.catalog.prefabs.find((p) => p.id === row.id);
    assert.ok(p, row.id);
    assert.equal(p.faction, row.faction);
    assert.ok(p.layers.length > 0, row.id);
    assert.ok(p.description.length > 0);
    assert.equal(p.stats.cost % 25, 0);
  }
  for (const p of G.catalog.prefabs) {
    const tags = p.sourceStats.nativeTags || [];
    assert.ok(!tags.some((t) => ["Building", "Radar", "Turret", "Pilot"].includes(t)));
    for (const m of p.mechanics || [])
      assert.ok(["implemented", "adapted", "review", "not_applicable"].includes(m.status));
  }
});
test("all newly imported warships use their configured compact footprints and retain independently damageable native modules", () => {
  for (const p of G.catalog.prefabs.filter((p) => p.stats.ship)) {
    assert.deepEqual(
      p.stats.footprint,
      ["PegasusClass", "ZanzibarClass"].includes(p.id)
        ? { width: 3, height: 6 }
        : ["GallopClass", "MiniTrayClass"].includes(p.id)
          ? { width: 1, height: 2 }
          : { width: 2, height: 3 },
    );
    assert.ok(Array.isArray(p.stats.modules));
    for (const w of Object.values(p.weapons)) {
      for (const id of w.moduleIds || []) assert.ok(p.stats.modules.some((m) => m.id === id));
    }
  }
});
test("air, amphibious, hover and naval movement use distinct terrain rules", () => {
  const g = game([entry("MSM_03"), entry("EF_Heli"), entry("Type74"), entry("RGM_79")]);
  const own = g.units.filter((u) => u.team === 0);
  g.tiles[10][10] = "water";
  for (const u of own)
    assert.equal(G.movementCost(g, u, 10, 10), G.modelOf(u).prefabId === "RGM_79" ? Infinity : 1);
  g.tiles[10][10] = "rock";
  assert.equal(G.movementCost(g, own[1], 10, 10), 1);
  assert.equal(G.movementCost(g, own[0], 10, 10), Infinity);
  const ship = game([entry("BurkeClass")]).units[0];
  assert.equal(G.modelOf(ship).movementType, "naval");
  g.tiles[10][10] = "plain";
  assert.equal(G.movementCost(g, ship, 10, 10), Infinity);
  g.tiles[10][10] = "water";
  assert.equal(G.movementCost(g, ship, 10, 10), 1);
});
test("naval deployment occupies water only and ordinary ground maps reject naval formations", () => {
  const g = G.create(
    false,
    1,
    [[entry("BurkeClass")], [entry("RGM_79")], null, null],
    true,
    settings,
  );
  const ship = g.units[0];
  assert.ok(G.cells(ship).every((c) => g.tiles[c.y][c.x] === "water"));
  assert.ok(G.deploymentCells(g, 0, ship).every((c) => g.tiles[c.y][c.x] === "water"));
  G.confirmDeployment(g, 0);
  assert.throws(() =>
    G.create(false, 1, [[entry("BurkeClass")], [entry("RGM_79")]], false, {
      costLimit: 50000,
      unitCostLimit: 10000,
    }),
  );
});
test("native supply sources passively restore nearby living allies without EN or action cost", () => {
  const g = game([entry("Type74"), entry("RGM_79"), entry("RGM_79")]);
  const [a, b, c] = g.units;
  Object.assign(a, { x: 6, y: 12, en: 50 });
  Object.assign(b, { x: 7, y: 12, hp: 100, en: 0, brokenParts: { head: true } });
  Object.assign(c, { x: 20, y: 12, hp: 0, en: 0 });
  const before = a.en;
  assert.ok(G.modelOf(a).supplyAura);
  assert.equal(
    G.unitSkills(a).some((s) => s.type === "repair"),
    false,
  );
  G.end(g);
  G.end(g);
  assert.equal(a.en, before + G.modelOf(a).en * 0.1);
  assert.equal(b.en, G.modelOf(b).en * 0.1);
  assert.equal(b.hp, 100 + Math.round(G.modelOf(b).hp * 0.05));
  assert.deepEqual(b.brokenParts, { head: true });
  assert.equal(c.hp, 0);
});

test("unarmed transports render a real hull, retain legal movement, and have no invented attack weapon", () => {
  for (const id of ["Medea", "MedeaKai", "FatUncle", "FatUncleKai"]) {
    const g = game([entry(id)]),
      u = g.units[0];
    assert.deepEqual(G.modelOf(u).weapons, []);
    assert.equal(u.heldWeapon, null);
    assert.ok(G.hasActions(g));
    assert.ok(G.reachable(g, u).size > 1);
  }
});
test("helicopters retain the source rotor loop, not an MS idle animation", () => {
  for (const id of ["EF_Heli", "ZN_Heli"]) {
    const p = G.catalog.prefabs.find((p) => p.id === id);
    assert.equal(p.stats.movementType, "air");
    assert.ok(
      p.layers.some((l) => l.rotationSpeed > 0),
      id,
    );
  }
});

test("Page_00 Gundam, Guncannon and Guntank eject through the same explicit core-fighter configuration", () => {
  for (const id of ["RX_78_2", "RX_77_2", "RX_75"]) {
    const g = G.create(false, 1, [[entry(id)], [entry("RGM_79")]], false, {
      costLimit: 50000,
      unitCostLimit: 10000,
    });
    const u = g.units[0];
    const skill = G.unitSkills(u).find((s) => s.type === "escape");
    assert.ok(skill, id);
    const target = G.skillTargets(g, u, skill.id)[0];
    assert.ok(target);
    const event = G.useSkill(g, u, skill.id, target.x, target.y);
    const craft = g.units.find((u) => u.id === event.resultId);
    assert.equal(craft.model, "FF_X7__standard");
    assert.equal(craft.hp, G.modelOf(craft).hp);
    assert.equal(craft.en, G.modelOf(craft).en);
    assert.equal(craft.ownerSeat, 0);
    assert.equal(craft.acted, true);
  }
});
