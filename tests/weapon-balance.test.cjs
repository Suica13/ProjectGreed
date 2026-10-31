const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const Sequence = require("../shared/weapon-sequence.js");
const catalog = loadCatalog();
test("machine guns use their one native-based reduction; ship weapons never stack another reduction", () => {
  let count = 0,
    arms = 0,
    ships = 0;
  for (const prefab of catalog.prefabs) {
    const raw = require("../tools/weapon-store.cjs").parse(
      fs.readFileSync(path.join(__dirname, "../assets/units", prefab.id, "unit.json")),
    );
    for (const [id, before] of Object.entries(raw.weapons)) {
      const after = prefab.weapons[id];
      const wristScale =
        ["RX_78_4", "RX_78_4_Bst"].includes(prefab.id) && id === "Common_ArmBR_Pink_L"
          ? raw.weapons.Common_ArmBR_Pink.damagePerShot / before.damagePerShot
          : 1;
      const eligibleBeam =
        before.category === "beam_rifle" &&
        !/Arm|Hand/i.test(id + " " + (before.sourceName || ""));
      const melee = before.type === "melee" || before.category === "melee";
      if (before.category !== "machine_gun" || /^Common_ArmGL(?:_|$)/.test(id)) {
        assert.equal(
          after.damagePerShot,
          before.damagePerShot *
            wristScale *
            (melee
              ? id.startsWith("Common_Push_")
                ? 1
                : 1.1
              : before.category === "bazooka" ? 1.25
              : (before.type === "beam" ||
                    Object.entries(before.damageComponents).some(
                      ([k, v]) => /beam/i.test(k) && v > 0,
                    )) &&
                  eligibleBeam &&
                  !prefab.stats.ship &&
                  !prefab.unitTags.includes("MA")
                ? 1.5
                : 1),
        );
        assert.equal(after.actionCost, require("../shared/conversion-rules.cjs").isHeadOrWrist(before, id) ? 3 : before.actionCost * 2);
        continue;
      }
      count++;
      if (/ArmMG/.test(id)) arms++;
      if (prefab.stats.ship) ships++;
      assert.equal(after.actionCost, require("../shared/conversion-rules.cjs").isHeadOrWrist(before, id) ? 3 : 4, `${prefab.id}/${id}`);
      const expected =
        before.attack.steps.reduce(
          (sum, step) =>
            sum +
            Sequence.roundDamage(
              Object.values(step.damageComponents || before.damageComponents).reduce(
                (n, v) => n + v,
                0,
              ) *
                (step.damageMultiplier ?? 1) *
                (prefab.stats.ship ? 1 : 0.75 / (before.machineGunDamageScale ?? 1)) *
                ((before.type === "beam" ||
                  Object.entries(before.damageComponents).some(
                    ([k, v]) => /beam/i.test(k) && v > 0,
                  )) &&
                eligibleBeam &&
                !prefab.stats.ship &&
                !prefab.unitTags.includes("MA")
                  ? 1.5
                  : 1),
            ) *
              (step.shots || 0) *
              (step.repeat || 1),
          0,
        ) * (before.hitsPerShot || 1);
      assert.equal(Sequence.compile(after).damage, expected, `${prefab.id}/${id}`);
      assert.deepEqual(after.nativePayload, before.nativePayload);
      assert.equal(after.en, before.en);
      assert.equal(Sequence.compile(after).shotCount, Sequence.compile(before).shotCount);
    }
    const snapshot = structuredClone(prefab);
    applyWeaponBalance(prefab);
    assert.deepEqual(prefab, snapshot, "reloading must not compound damage reduction");
  }
  assert.ok(count > 250 && arms > 0 && ships > 0);
});
test("compiled paired/kit machine guns retain the unified AP policy", () => {
  for (const model of Object.values(catalog.models))
    for (const weapon of model.weapons)
      if (weapon.category === "machine_gun" && !/^Common_ArmGL(?:_|$)/.test(weapon.id)) {
        assert.equal(weapon.actionCost, require("../shared/conversion-rules.cjs").isHeadOrWrist(weapon) ? 3 : 4);
        assert.equal(weapon.machineGunDamageScale, model.ship ? undefined : 0.75);
      }
});
