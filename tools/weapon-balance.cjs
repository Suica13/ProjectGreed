const Classes = require("../shared/weapon-classes.js");
// Applied before timeline/paired-weapon compilation in both server and client builds.
// Raw MOD payloads stay intact for auditing and future imports.
function applyWeaponBalance(prefab, rules = require("../shared/conversion-rules.cjs").read()) {
  // The native Unit 4 Lv2 left wrist file disagrees with its same-grade right copy.
  // Keep nativePayload intact while normalizing this explicit source-data exception.
  if (["RX_78_4", "RX_78_4_Bst"].includes(prefab.id)) {
    const right = prefab.weapons?.Common_ArmBR_Pink;
    const left = prefab.weapons?.Common_ArmBR_Pink_L;
    if (right && left && right.level === left.level) {
      const targetScale = right.damagePerShot / (left.damagePerShot / (left.wristDamageScale ?? 1));
      const ratio = targetScale / (left.wristDamageScale ?? 1);
      for (const payload of [left, ...(left.attack?.steps || [])]) {
        for (const field of ["damage", "damagePerShot"])
          if (Number.isFinite(payload[field])) payload[field] *= ratio;
        if (payload.damageComponents)
          payload.damageComponents = Object.fromEntries(
            Object.entries(payload.damageComponents).map(([key, value]) => [key, value * ratio]),
          );
      }
      left.wristDamageScale = targetScale;
    }
  }

  const Conversion = require("../shared/conversion-rules.cjs");
  for (const [id, weapon] of [
    ...Object.entries(prefab.weapons || {}),
    ...(prefab.skills || [])
      .filter((skill) => skill.sourceWeapon)
      .map((skill) => [skill.id, skill]),
  ]) {
    let target = Classes.rule(weapon, rules, id).damage;
    // Native warship policy already includes its machine-gun reduction.
    if (prefab.stats?.ship && Classes.machineGun(weapon, id)) target /= 0.75;
    if (
      (prefab.stats?.ship || prefab.unitTags?.includes("MA")) &&
      Classes.mainClass(weapon, id) === "hand" &&
      Classes.classify(weapon, id) === "beam"
    )
      target = 1;
    Conversion.scaleDamage(weapon, target / (weapon.classDamageScale ?? 1));
    if (target !== 1 || weapon.classDamageScale !== undefined) weapon.classDamageScale = target;
  }
  return Conversion.globals(prefab, rules);
}
module.exports = { applyWeaponBalance };
