const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { loadCatalog } = require("../tools/load-catalog.cjs");
test("RGM-79 kits contain exactly one primary and both secondary weapons; local assets resolve", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.prefabs.length, 12);
  assert.equal(catalog.prefabs[0].id, "RGM_79");
  assert.deepEqual(
    Object.values(catalog.models)
      .filter((m) => m.prefabId === "RGM_79")
      .map((m) => m.weapons.map((w) => w.id)),
    [
      ["EF_BeamSprayGun", "EF_BeamSaber_A", "Common_DoubleVulcan_MS", "Common_Push_A"],
      ["EF_90mmMG", "EF_BeamSaber_A", "Common_DoubleVulcan_MS", "Common_Push_A"],
      ["EF_HypeBazooka", "EF_BeamSaber_A", "Common_DoubleVulcan_MS", "Common_Push_A"],
    ],
  );
  assert.ok(Object.values(catalog.assets).every((src) => src.startsWith("data:image/png;base64,")));
  for (const unit of catalog.units) {
    for (const weapon of catalog.models[unit.id].weapons)
      if (weapon.clip !== null) assert.ok(unit.animations[weapon.clip].duration > 0);
    if (unit.presentation.shield) assert.ok(unit.decals.some((d) => d.name === "Shield"));
    assert.ok(unit.decals.every((d) => catalog.assets[d.asset] && unit.bones[d.bone]));
  }
});
test("formations sanitize input and reject unknown, empty, oversized and over-budget squads", () => {
  const entry = { unitId: "RGM_79", kitId: "beam_spray" };
  assert.deepEqual(G.validateFormation([{ ...entry, hp: 999999, weapons: ["illegal"] }]), [entry]);
  for (const bad of [[], null, [{ ...entry, kitId: "all_weapons" }], Array(13).fill(entry)])
    assert.throws(() => G.validateFormation(bad));
  assert.deepEqual(G.randomFormation(42), G.randomFormation(42));
  const combinations = new Set(
    Array.from({ length: 20 }, (_, i) => JSON.stringify(G.randomFormation(i))),
  );
  assert.ok(combinations.size > 1);
  for (let seed = 0; seed < 30; seed++)
    assert.equal(G.validateFormation(G.randomFormation(seed)).length, 12);
  const nine = Array(12).fill({ unitId: "MS_06F", kitId: "machine_gun" });
  assert.equal(G.validateFormation(nine).length, 12);
  const full = G.create(false, 1, [nine, nine], true);
  assert.equal(full.units.length, 24);
  assert.equal(new Set(full.units.map((u) => u.x + "," + u.y)).size, 24);
  assert.equal(full.tiles.length, 18);
  assert.equal(full.tiles[0].length, 24);
  const before = G.catalog.formation.maxCost;
  try {
    G.catalog.formation.maxCost = 1;
    assert.throws(() => G.validateFormation([entry]));
  } finally {
    G.catalog.formation.maxCost = before;
  }
});
test("deployment cells surround separate spawn points and placements cannot overlap or escape", () => {
  const g = G.create(false, 12, undefined, true);
  assert.equal(g.units.length, 24);
  const u = g.units[0],
    other = g.units[1];
  assert.throws(() => G.deploy(g, 0, u.id, other.x, other.y));
  assert.throws(() => G.deploy(g, 1, u.id, 10, 4));
  assert.throws(() => G.deploy(g, 0, u.id, 6, 4));
  assert.throws(() => G.deploy(g, 0, u.id, 1.5, 4));
  const free = G.deploymentCells(g, 0).find((c) => !G.at(g, c.x, c.y));
  G.deploy(g, 0, u.id, free.x, free.y);
  assert.equal(G.confirmDeployment(g, 0), false);
  assert.throws(() => G.deploy(g, 0, u.id, 1, 4));
  assert.equal(G.confirmDeployment(g, 1), true);
});
