// Applied before timeline/paired-weapon compilation in both server and client builds.
// Raw MOD payloads stay intact for auditing and future imports.
function applyWeaponBalance(prefab) {
  for (const [id, weapon] of Object.entries(prefab.weapons || {})) {
    // These launchers inherited the machine-gun category from their animation.
    if (/^Common_ArmGL(?:_|$)/.test(id)) continue;
    if (weapon.category !== "machine_gun") continue;
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
  return prefab;
}
module.exports = { applyWeaponBalance };
