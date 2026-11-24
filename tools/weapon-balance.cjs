const Classes = require("../shared/weapon-classes.js");
// Enhanced ZZ's identically equipped rifle uses the standard ZZ firing profile.
// Keep the imported values separately, so future imports and audits retain provenance.
function synchronizeZZRifle(prefab, definitions) {
  for (const weapon of Object.values(prefab.weapons || {})) {
    if (!/^AEUG_MSZ_010S_BR(?:_R)?$/.test(weapon.sourceName || "")) continue;
    const sourceName = weapon.sourceName.replace("MSZ_010S", "MSZ_010");
    const base = require("./weapon-store.cjs").expandPrefab(
      { id: prefab.id, weapons: { base: { ref: sourceName + "__lv1" } } },
      definitions,
    ).weapons.base;
    if (!base) throw Error("Missing standard ZZ rifle: " + sourceName);
    weapon.nativeSourceData ||= structuredClone({
      payload: weapon.nativePayload,
      timing: weapon.nativeTiming,
      projectile: weapon.projectile,
    });
    for (const field of [
      "type",
      "min",
      "max",
      "hit",
      "en",
      "sourceHit",
      "hitMultiplier",
      "hitBonus",
      "damagePerShot",
      "damageComponents",
      "hitsPerShot",
      "attack",
      "partBreakModifier",
      "targetModifiers",
      "sizeDamageModifiers",
      "sizeAccuracyModifiers",
      "projectile",
      "nativePayload",
      "nativeTiming",
      "attackRounds",
    ])
      if (Object.hasOwn(base, field)) weapon[field] = structuredClone(base[field]);
    weapon.balanceSource = sourceName;
  }
  return prefab;
}
// Applied before timeline/paired-weapon compilation in both server and client builds.
// Raw MOD payloads stay intact for auditing and future imports.
function applyWeaponBalance(
  prefab,
  rules = require("../shared/conversion-rules.cjs").read(),
  definitions,
  options = {},
) {
  const TB = require("./thunderbolt-balance.cjs");
  TB.prepare(prefab);
  const Gbo2 = require("./gbo2-import-policy.cjs");
  Gbo2.prepare(prefab, definitions);
  synchronizeZZRifle(prefab, definitions);
  // Published 145-point pilot gates include the boundary; native sources remain archived.
  for (const ability of [...Object.values(prefab.weapons || {}), ...(prefab.skills || [])])
    for (const requirement of ability.pilotRequirements || [])
      if (requirement.operator === ">" && requirement.value === 145) requirement.operator = ">=";
  const production = require("../shared/native-production.json")[prefab.id];
  if (production)
    prefab.sourceStats = { ...prefab.sourceStats, nativeProductionQuantity: production.quantity };
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
      Classes.classify(weapon, id) === "beam_rifle"
    )
      target = 1;
    Conversion.scaleDamage(weapon, target / (weapon.classDamageScale ?? 1));
    if (target !== 1 || weapon.classDamageScale !== undefined) weapon.classDamageScale = target;
  }
  Conversion.globals(prefab, rules);
  Gbo2.apply(prefab, rules, options.adjustments);
  return TB.apply(prefab, rules, definitions, options.adjustments || require("../shared/catalog-adjustments.cjs").read());
}
module.exports = { applyWeaponBalance, synchronizeZZRifle };
