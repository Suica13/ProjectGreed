const test = require("node:test");
const assert = require("node:assert/strict");
const Classes = require("../shared/weapon-classes.js");
const Conversion = require("../shared/conversion-rules.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const config = Conversion.read();
const catalog = loadCatalog({ embedAssets: false,
  adjustmentsOverride: { schemaVersion: 1, units: {}, weapons: {}, prices: {} } });

test("handheld cannon bonus excludes mounted cannons; kit discount never stacks or goes negative", () => {
  const sources = new Set();
  for (const prefab of catalog.prefabs) {
    for (const weapon of Object.values(prefab.weapons)) if (Classes.handheldCannon(weapon)) {
      sources.add(weapon.sourceName);
      assert.equal(weapon.hit, 70);
      assert(weapon.attack.steps.every(step => step.accuracy === undefined || step.accuracy === 70));
    }
    for (const kit of prefab.weaponKits) {
      const primary = prefab.weapons[kit.weapons[0]];
      const lightBeam = /Beam(?:Spray)?Gun/i.test(primary?.sourceName || kit.weapons[0] || "") && !/BeamRifle/i.test(primary?.sourceName || "");
      assert.equal(kit.cost, Math.max(0, kit.conversionBaseCost - 25 - (lightBeam ? 25 : 0)));
    }
  }
  for (const sourceName of ["EF_180mmCannon", "EF_180mmCannon_PR", "EF_170mmCannon", "ZN_MagellaCannon"]) assert(sources.has(sourceName));
  for (const sourceName of ["Common_Cannon", "EF_Type61_Cannon", "PegasusClass_Turret_Cannon", "ZN_MS_06V_Cannon"]) assert(!Classes.handheldCannon({sourceName,category:"cannon",type:"shell"}));
  const prefab = structuredClone(catalog.prefabs.find(p=>Object.values(p.weapons).some(Classes.handheldCannon)));
  const costs = prefab.weaponKits.map(k=>k.cost);
  Conversion.globals(prefab, config);Conversion.globals(prefab, config);
  assert.deepEqual(prefab.weaponKits.map(k=>k.cost), costs);
  assert(Object.values(prefab.weapons).filter(Classes.handheldCannon).every(w=>w.hit===70));
});

test("all specified types use fixed accuracy, including levels, mounts and firing steps", () => {
  const seen = new Set();
  let ships = 0;
  for (const prefab of catalog.prefabs)
    for (const weapon of Object.values(prefab.weapons)) {
      const kind = Classes.classify(weapon);
      if (!Object.hasOwn(Classes.baseHits, kind)) continue;
      seen.add(kind);
      const cannon = Classes.shipCannon(weapon, prefab.stats.ship);
      const expected = Math.round(((weapon.baseHitOverride ?? Classes.baseHits[kind]) + (!["melee", "ram"].includes(kind) ? config.weapons.shootingHitOffset : 0) + (Classes.handheldCannon(weapon) ? config.weapons.handheldCannonHitOffset : 0)) * (cannon ? 0.85 : 1));
      assert.equal(weapon.hit, expected, prefab.id + "/" + weapon.id);
      for (const step of weapon.attack?.steps || [])
        if (step.accuracy !== undefined) assert.equal(step.accuracy, expected);
      if (cannon) ships++;
    }
  assert.equal(seen.size, Object.keys(Classes.baseHits).length);
  assert(ships > 20);
  for (const kind of seen) assert.equal(config.weaponClasses[kind].accuracy, 1);
});

test("ship trait excludes non-cannons and non-ships, and reloading does not stack it", () => {
  for (const kind of Object.keys(Classes.labels)) {
    const cannon = ["cannon", "beam_cannon", "mortar"].includes(kind);
    assert.equal(Classes.shipCannon({ weaponClass: kind }, true), cannon);
    assert.equal(Classes.shipCannon({ weaponClass: kind }, false), false);
    assert.equal(Classes.shipCannon({ weaponClass: kind, rangeRole: "ship_anti_air" }, true), false);
  }
  const prefab = structuredClone(catalog.prefabs.find(p => p.stats.ship &&
    Object.values(p.weapons).some(w => Classes.shipCannon(w, true))));
  const before = structuredClone(prefab);
  Conversion.globals(prefab, config);
  assert.deepEqual(prefab, before);
  const changed = structuredClone(config);
  changed.weapons.shipCannonAccuracy = 0.8;
  Conversion.globals(prefab, changed);
  for (const weapon of Object.values(prefab.weapons))
      assert.equal(weapon.hit, Math.round((Classes.baseHits[Classes.classify(weapon)] + (!["melee", "ram"].includes(Classes.classify(weapon)) ? config.weapons.shootingHitOffset : 0) + (Classes.handheldCannon(weapon) ? config.weapons.handheldCannonHitOffset : 0)) * (Classes.shipCannon(weapon, true) ? 0.8 : 1)));
});

test("unspecified classes inherit native accuracy; shooting offset includes both irradiation types", () => {
  assert.equal(config.weaponClasses.beam.baseHit, -1);
  assert.equal(config.weaponClasses.other.baseHit, -1);
  const skills = catalog.prefabs.flatMap(p => p.skills || []).filter(s => s.type === "irradiation");
  assert(skills.length > 0);
  assert(skills.every(s => s.baseHit === (s.areaWidth === 3 ? 40 : 50)));
});
