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

  for (const [id, weapon] of Object.entries(prefab.weapons || {})) {
    // These launchers inherited the machine-gun category from their animation.
    const gun = Classes.machineGun(weapon, id);
    if (!gun && weapon.machineGunDamageScale === undefined) continue;
    // Ships already have one native-based 25% damage reduction in their source policy.
    // Keep the AP rule, without stacking the general machine-gun damage reduction.
    if (prefab.stats?.ship && gun) {
      weapon.actionCost = rules.weapons.machineGunAP;
      continue;
    }
    const target = gun ? rules.weapons.machineGunDamage : 1;
    const ratio = target / (weapon.machineGunDamageScale ?? 1);
    if (gun) weapon.actionCost = rules.weapons.machineGunAP;
    for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
      for (const field of ["damage", "damagePerShot"])
        if (Number.isFinite(payload[field])) payload[field] *= ratio;
      if (payload.damageComponents)
        payload.damageComponents = Object.fromEntries(
          Object.entries(payload.damageComponents).map(([key, value]) => [key, value * ratio]),
        );
    }
    weapon.machineGunDamageScale = target;
  }
  // Native payloads remain intact; scale before the shared 25-point quantization.
  const beamScale =
    prefab.stats?.ship || prefab.unitTags?.includes("MA") ? 1 : rules.weapons.beamRifleDamage;
  for (const [id, weapon] of Object.entries(prefab.weapons || {})) {
    const kind = Classes.classify(weapon, id);
    const melee = kind === "melee" || kind === "ram";
    const beamFamily = kind === "beam_rifle";
    const bazookaScale = kind === "bazooka" ? rules.weapons.bazookaDamage : 1;
    const armMounted = kind === "wrist";
    const targetBeamScale = !melee && beamFamily && !armMounted ? beamScale : 1;
    const meleeScale = kind === "melee" ? rules.weapons.meleeDamage : 1;
    const ratio =
      (targetBeamScale / (weapon.beamDamageScale ?? 1)) *
      (meleeScale / (weapon.meleeDamageScale ?? 1)) *
      (bazookaScale / (weapon.bazookaDamageScale ?? 1));
    if (ratio !== 1)
      for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
        for (const field of ["damage", "damagePerShot"])
          if (Number.isFinite(payload[field])) payload[field] *= ratio;
        if (payload.damageComponents)
          payload.damageComponents = Object.fromEntries(
            Object.entries(payload.damageComponents).map(([key, value]) => [key, value * ratio]),
          );
      }
    if (bazookaScale !== 1 || weapon.bazookaDamageScale !== undefined)
      weapon.bazookaDamageScale = bazookaScale;
    if (targetBeamScale !== 1 || weapon.beamDamageScale !== undefined)
      weapon.beamDamageScale = targetBeamScale;
    if (meleeScale !== 1 || weapon.meleeDamageScale !== undefined)
      weapon.meleeDamageScale = meleeScale;
  }
  for (const weapon of Object.values(prefab.weapons || {})) {
    if (Classes.classify(weapon) !== "mortar" && weapon.mortarAccuracyScale === undefined) continue;
    const scale = Classes.classify(weapon) === "mortar" ? rules.weapons.mortarAccuracy : 1;
    const ratio = scale / (weapon.mortarAccuracyScale ?? 1);
    weapon.hit *= ratio;
    for (const step of weapon.attack?.steps || [])
      if (Number.isFinite(step.accuracy)) step.accuracy *= ratio;
    // Advance the unscaled hit retained by globals, so reloading stays idempotent.
    if (weapon.conversionMultipliers?.hit !== undefined) weapon.conversionMultipliers.hit *= ratio;
    weapon.mortarAccuracyScale = scale;
  }
  for (const skill of prefab.skills || []) {
    if (
      !Object.entries(skill.damageComponents || {}).some(
        ([key, value]) => /beam/i.test(key) && value > 0,
      )
    )
      continue;
    const kind = Classes.classify(skill);
    const target = !skill.sourceWeapon
      ? 1
      : kind === "beam_rifle"
        ? beamScale
        : kind === "bazooka"
          ? rules.weapons.bazookaDamage
          : kind === "melee"
            ? rules.weapons.meleeDamage
            : Classes.machineGun(skill) && !prefab.stats?.ship
              ? rules.weapons.machineGunDamage
              : 1;
    const ratio = target / (skill.beamDamageScale ?? 1);
    if (ratio !== 1)
      skill.damageComponents = Object.fromEntries(
        Object.entries(skill.damageComponents).map(([key, value]) => [key, value * ratio]),
      );
    if (target !== 1 || skill.beamDamageScale !== undefined) skill.beamDamageScale = target;
  }
  return require("../shared/conversion-rules.cjs").globals(prefab, rules);
}
module.exports = { applyWeaponBalance };
