const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const Adjust = require("../shared/catalog-adjustments.cjs");
const Schema = require("../shared/catalog-editor-schema.js");
const write = (f, file, value) =>
  fs.writeFileSync(path.join(f.root, file), JSON.stringify(value, null, 2) + "\n");

test("unit, weapon and license edits preserve numeric source baselines and rebase after source updates", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const file = "assets/units/RX_78_2/unit.json";
  const raw = f.read(file),
    prices = f.read("shared/production-catalog.json");
  const d = f.store.getUnit("RX_78_2");
  d.id = d.unit.id;
  const weapon = "EF_HypeBazooka",
    original = structuredClone(d);
  d.unit.stats.hp += 500;
  d.unit.weapons[weapon].hit -= 5;
  d.price.money += 50;
  f.store.saveUnit(d);
  assert.equal(f.read(file).stats.hp, raw.stats.hp);
  assert.equal(
    f.read("shared/production-catalog.json").licenseOffers[d.id].money,
    prices.licenseOffers[d.id].money,
  );
  const registry = f.read(Adjust.file);
  assert.equal(registry.units[d.id]["/stats/hp"], 500);
  assert.equal(registry.units[d.id]["/weapons/" + weapon + "/hit"], -5);
  assert.equal(registry.prices[d.id]["/money"], 50);
  // Simulate a normal importer refreshing the original source file and its prices.
  raw.stats.hp += 1000;
  write(f, file, raw);
  prices.licenseOffers[d.id].money += 100;
  write(f, "shared/production-catalog.json", prices);
  const updated = f.store.getUnit(d.id);
  assert.equal(updated.unit.stats.hp, original.unit.stats.hp + 1500);
  assert.equal(updated.unit.weapons[weapon].hit, original.unit.weapons[weapon].hit - 5);
  assert.equal(updated.price.money, original.price.money + 150);
  assert.equal(f.catalog().prefabs.find((u) => u.id === d.id).stats.hp, updated.unit.stats.hp);
  assert.equal(Adjust.production(prices, registry).licenseOffers[d.id].money, updated.price.money);
});

test("AP and damage offsets apply after global balance changes without duplicating on repeated saves", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const balance = require("../tools/weapon-balance.cjs"),
    originalBalance = balance.applyWeaponBalance;
  t.after(() => {
    balance.applyWeaponBalance = originalBalance;
  });
  const d = f.store.getUnit("RX_78_2");
  d.id = d.unit.id;
  const beam = Object.keys(d.unit.weapons).find(
    (id) => d.unit.weapons[id].category === "beam_rifle",
  );
  const machine = Object.keys(d.unit.weapons).find(
    (id) => d.unit.weapons[id].category === "machine_gun",
  );
  const baseDamage = d.unit.weapons[beam].damagePerShot;
  Schema.setDamage(d.unit.weapons[beam], baseDamage + 500);
  d.unit.weapons[machine].actionCost += 1;
  const originalAP = d.unit.weapons[machine].actionCost;
  f.store.saveUnit(d);
  const registry = f.read(Adjust.file);
  const again = f.store.getUnit(d.id);
  again.id = d.id;
  assert.equal(f.store.saveUnit(again).noChanges, true);
  assert.deepEqual(f.read(Adjust.file), registry);
  assert.equal(again.unit.weapons[beam].damagePerShot, baseDamage + 500);
  balance.applyWeaponBalance = (prefab) => {
    originalBalance(prefab);
    prefab.weapons[machine] && (prefab.weapons[machine].actionCost += 1);
    const gun = prefab.weapons[beam];
    if (gun)
      for (const value of [gun, ...gun.attack.steps]) {
        if (value.damagePerShot !== undefined) value.damagePerShot *= 2;
        if (value.damageComponents)
          for (const key of Object.keys(value.damageComponents)) value.damageComponents[key] *= 2;
      }
    return prefab;
  };
  const updated = f.store.getUnit(d.id);
  assert.equal(updated.unit.weapons[beam].damagePerShot, baseDamage * 2 + 500);
  assert.equal(updated.unit.weapons[machine].actionCost, originalAP + 1);
  const compiled = Object.values(f.catalog().models).filter((m) => m.prefabId === d.id);
  assert(
    compiled.some((m) =>
      m.weapons.some((w) => w.id === beam && w.damagePerShot === baseDamage * 2 + 500),
    ),
  );
  assert(
    compiled.some((m) =>
      m.weapons.some((w) => w.id === machine && w.actionCost === originalAP + 1),
    ),
  );
});

test("resetting a numeric field to its current baseline removes its offset and renames preserve offsets", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  let d = f.store.getUnit("Type61");
  d.id = d.unit.id;
  d.unit.stats.hp += 500;
  f.store.saveUnit(d);
  d = f.store.getUnit(d.id);
  d.id = d.unit.id;
  d.unit.id = "Renamed_Type61";
  f.store.saveUnit(d);
  assert(!f.read(Adjust.file).units.Type61);
  assert.equal(f.read(Adjust.file).units.Renamed_Type61["/stats/hp"], 500);
  d = f.store.getUnit(d.unit.id);
  d.id = d.unit.id;
  d.unit.stats.hp = d.baselines.unit.stats.hp;
  f.store.saveUnit(d);
  assert(!f.read(Adjust.file).units[d.id]);
});

test("offset helper rejects unsafe paths and invalid values without silently accepting schema drift", () => {
  assert.throws(() => Adjust.apply({}, { "/__proto__/polluted": 1 }));
  assert.throws(() => Adjust.apply({}, { "/hp": NaN }));
  assert.throws(() => Adjust.apply({ hp: "invalid" }, { "/hp": 1 }));
  const obj = { hit: 75, targetModifiers: { air: 1 } };
  assert.deepEqual(Adjust.apply(obj, { "/hit": -5, "/targetModifiers/air": 0.25 }), {
    hit: 70,
    targetModifiers: { air: 1.25 },
  });
});


test("common numeric edits leave the template unchanged and follow a later native template refresh", t => {
  const f = editorFixture(); t.after(f.cleanup);
  const ref = "EF_HypeBazooka__lv2", library = f.read("assets/weapons.json");
  const original = f.store.getWeapon(ref);
  const draft = structuredClone(original);
  Schema.setHit(draft.weapon, original.weapon.hit + 5);
  f.store.saveWeapon(draft);
  assert.deepEqual(f.read("assets/weapons.json"), library);
  assert.equal(f.read(Adjust.file).weapons[ref]["/hit"], 5);
  const beforeUnit = f.store.getUnit("RX_78_2").unit.weapons.EF_HypeBazooka.hit;
  library.definitions[ref].hit += 10;
  for (const step of library.definitions[ref].attack.steps) if (step.accuracy !== undefined) step.accuracy += 10;
  write(f, "assets/weapons.json", library);
  assert.equal(f.store.getWeapon(ref).weapon.hit, original.weapon.hit + 15);
  assert.equal(f.store.getUnit("RX_78_2").unit.weapons.EF_HypeBazooka.hit, beforeUnit + 10);
});
