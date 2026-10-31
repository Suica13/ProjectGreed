const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const Codec = require("../tools/weapon-store.cjs"),
  Classes = require("../shared/weapon-classes.js");
// Policy invariants exclude administrator offsets, which are applied afterwards.
const catalog = loadCatalog({ adjustmentsOverride: { schemaVersion: 1, units: {}, weapons: {}, prices: {} } });

test("all main/subclass damage rules preserve source payloads and do not stack on reload", () => {
  let count = 0,
    wrists = 0,
    ships = 0;
  for (const prefab of catalog.prefabs) {
    const raw = Codec.parse(
      fs.readFileSync(path.join(__dirname, "../assets/units", prefab.id, "unit.json")),
    );
    for (const [id, before] of Object.entries(raw.weapons)) {
      const after = prefab.weapons[id];
      let base = before.damagePerShot;
      if (["RX_78_4", "RX_78_4_Bst"].includes(prefab.id) && id === "Common_ArmBR_Pink_L")
        base = raw.weapons.Common_ArmBR_Pink.damagePerShot;
      let factor = Classes.rule(before, catalog.conversionRules, id).damage;
      if (prefab.stats.ship && Classes.machineGun(before, id)) {
        factor = 1;
        ships++;
      }
      if (
        (prefab.stats.ship || prefab.unitTags.includes("MA")) &&
        Classes.mainClass(before, id) === "hand" &&
        Classes.classify(before, id) === "beam"
      )
        factor = 1;
      assert.equal(after.damagePerShot, base * factor, prefab.id + "/" + id);
      assert.deepEqual(after.nativePayload, before.nativePayload);
      assert.equal(after.en, before.en);
      assert.deepEqual(
        after.attack.steps.map((s) => [s.shots, s.repeat, s.delay]),
        before.attack.steps.map((s) => [s.shots, s.repeat, s.delay]),
      );
      if (Classes.wristBeam(before, id)) wrists++;
      count++;
    }
    const saved = structuredClone(prefab);
    applyWeaponBalance(prefab);
    assert.deepEqual(prefab, saved, prefab.id);
  }
  assert(count > 1000 && wrists > 0 && ships > 0);
});

test("head/wrist and machine-gun costs remain consistent after paired-weapon compilation", () => {
  for (const model of Object.values(catalog.models))
    for (const weapon of model.weapons) {
      if (Classes.headOrWrist(weapon)) assert.equal(weapon.actionCost, 3);
      else if (Classes.machineGun(weapon)) assert.equal(weapon.actionCost, 4);
    }
});
