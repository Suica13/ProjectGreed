const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const entry = { unitId: "RGM_79", kitId: "machine_gun" };
test("unit names use fixed models plus serials and deployment fills missing codes deterministically", () => {
  const entries = [{...entry,customName:"任意改名[A12]"},{...entry,customName:"任意改名"},{...entry}];
  const clean=G.validateFormation(entries);
  assert.equal(clean[0].customName,G.models.RGM_79__machine_gun.name+"[A12]");
  assert.equal(clean[1].customName,undefined);
  const game=G.create(false,123,[clean,[entry]]);
  assert.equal(G.unitName(game.units[0]),G.models.RGM_79__machine_gun.name+"[A12]");
  for(const u of game.units)assert.match(G.unitName(u),/\[[A-Z]\d{2}\]$/);
  assert.equal(new Set(game.units.map(u=>u.customName)).size,game.units.length);
  assert.deepEqual(game,G.create(false,123,[clean,[entry]]));
  assert.equal(G.models.RGM_79__machine_gun.customName,undefined);
  assert.equal(G.unitName({...game.units[0],customName:"旧名称"}),G.models.RGM_79__machine_gun.name);
});

test("empty/reset names restore defaults and invalid names never enter authoritative formations", () => {
  for (const customName of ["", " \n\t "])
    assert.deepEqual(G.validateFormation([{ ...entry, customName }]), [entry]);
  for (const customName of [null, {}, 42, "x".repeat(25)])
    assert.throws(() => G.validateFormation([{ ...entry, customName }]), /单位名称/);
  assert.equal(G.normalizeUnitName("名".repeat(24)).length, 24);
});
test("automatic unit codes resolve random collisions, fit the name limit and keep AI squads deterministic", () => {
  const entries = [];
  for (let i = 0; i < 24; i++) {
    const customName = G.generateUnitName("吉姆", entries, () => 0);
    assert.match(customName, /^吉姆\[[A-Z]\d{2}\]$/);
    entries.push({ ...entry, customName });
  }
  assert.equal(entries[0].customName, "吉姆[A00]");
  assert.equal(entries[1].customName, "吉姆[A01]");
  assert.equal(new Set(entries.map((e) => e.customName)).size, 24);
  const long = G.generateUnitName("机".repeat(30), [], () => 0.999999);
  assert.equal(Array.from(long).length, 24);
  assert.match(long, /\[Z99\]$/);
  const army = G.randomFormation(1234);
  assert.deepEqual(army, G.randomFormation(1234));
  assert.ok(army.every((e) => /\[[A-Z]\d{2}\]$/.test(e.customName)));
  assert.equal(
    new Set(army.map((e) => e.customName.match(/\[([A-Z]\d{2})\]$/)[1])).size,
    army.length,
  );
});
