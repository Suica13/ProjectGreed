// Applied before timeline/paired-weapon compilation in both server and client builds.
// Raw MOD payloads stay intact for auditing and future imports.
function applyWeaponBalance(prefab) {
  for (const [id, weapon] of Object.entries(prefab.weapons || {})) {
    // These launchers inherited the machine-gun category from their animation.
    if (/^Common_ArmGL(?:_|$)/.test(id)) continue;
    if (weapon.category !== "machine_gun") continue;
    // Ships already have one native-based 25% damage reduction in their source policy.
    // Keep the AP rule, without stacking the general machine-gun damage reduction.
    if (prefab.stats?.ship) {
      weapon.actionCost = 2;
      continue;
    }
    const ratio = 0.75 / (weapon.machineGunDamageScale ?? 1);
    weapon.actionCost = 2;
    for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
      for (const field of ["damage", "damagePerShot"])
        if (Number.isFinite(payload[field])) payload[field] *= ratio;
      if (payload.damageComponents)
        payload.damageComponents = Object.fromEntries(
          Object.entries(payload.damageComponents).map(([key, value]) => [key, value * ratio]),
        );
    }
    weapon.machineGunDamageScale = 0.75;
  }
  // Native payloads remain intact; scale before the shared 25-point quantization.
  const beamScale = prefab.stats?.ship || prefab.unitTags?.includes("MA") ? 1 : 1.25;
  for (const weapon of Object.values(prefab.weapons || {})) {
    if (weapon.type !== "beam" && !Object.entries(weapon.damageComponents || {}).some(([key, value]) => /beam/i.test(key) && value > 0)) continue;
    const ratio = beamScale / (weapon.beamDamageScale ?? 1);
    if (ratio !== 1)
      for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
        for (const field of ["damage", "damagePerShot"])
          if (Number.isFinite(payload[field])) payload[field] *= ratio;
        if (payload.damageComponents)
          payload.damageComponents = Object.fromEntries(
            Object.entries(payload.damageComponents).map(([key, value]) => [key, value * ratio]),
          );
      }
    if (beamScale !== 1 || weapon.beamDamageScale !== undefined) weapon.beamDamageScale = beamScale;
  }
  for (const skill of prefab.skills || []) {
    if (!Object.entries(skill.damageComponents || {}).some(([key, value]) => /beam/i.test(key) && value > 0)) continue;
    const ratio = beamScale / (skill.beamDamageScale ?? 1);
    if (ratio !== 1) skill.damageComponents = Object.fromEntries(Object.entries(skill.damageComponents).map(([key, value]) => [key, value * ratio]));
    if (beamScale !== 1 || skill.beamDamageScale !== undefined) skill.beamDamageScale = beamScale;
  }
  return prefab;
}
module.exports = { applyWeaponBalance };
