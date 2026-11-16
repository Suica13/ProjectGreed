const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const G = require("../shared/rules"),
  Store = require("../tools/weapon-store.cjs"),
  Balance = require("../tools/weapon-balance.cjs");
const p = (id) => G.catalog.prefabs.find((p) => p.id === id);
for (const id of ["MSZ_010S", "FA_010S"])
  test(id + " rifle matches standard ZZ after global conversion", () => {
    const base = p("MSZ_010").weapons.AEUG_MSZ_010_BR;
    const w = p(id).weapons.AEUG_MSZ_010S_BR;
    for (const field of [
      "damagePerShot",
      "damageComponents",
      "hit",
      "en",
      "min",
      "max",
      "attackRounds",
      "projectile",
      "targetModifiers",
      "sizeDamageModifiers",
      "sizeAccuracyModifiers",
    ])
      assert.deepEqual(w[field], base[field], field);
    assert.deepEqual(w.attack.steps, base.attack.steps);
    assert.equal(w.nativeTiming.projectiles, 4);
    assert.equal(w.balanceSource, "AEUG_MSZ_010_BR");
    assert.equal(w.nativeSourceData.payload.BeamDamage, 9000);
    assert.equal(w.nativeSourceData.timing.projectiles, 2);
  });
test("rifle inheritance preserves enhanced muzzle, source and independent weapon identities", () => {
  const raw = Store.parse(fs.readFileSync("assets/units/MSZ_010S/unit.json", "utf8"));
  const before = structuredClone(raw);
  Balance.synchronizeZZRifle(raw);
  for (const key of ["AEUG_MSZ_010S_BR", "AEUG_MSZ_010S_BR_R"]) {
    for (const field of [
      "sourceName",
      "source",
      "muzzle",
      "requiredParts",
      "availability",
      "mergedPositions",
    ])
      assert.deepEqual(raw.weapons[key][field], before.weapons[key][field], field);
  }
  const first = structuredClone(raw);
  Balance.synchronizeZZRifle(raw);
  assert.deepEqual(raw, first);
  for (const key of Object.keys(before.weapons).filter((k) => !k.startsWith("AEUG_MSZ_010S_BR")))
    assert.deepEqual(raw.weapons[key], before.weapons[key]);
  assert.equal(before.weapons.AEUG_MSZ_010S_BR.nativeTiming.projectiles, 2);
});
