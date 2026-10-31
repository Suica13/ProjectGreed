// Grades belong to weapon data; all localized names carry the same suffix.
function labelWeapon(weapon, unitId) {
    if (!Number.isInteger(weapon.level) || weapon.level < 1)
      throw Error('Invalid weapon level: ' + unitId + '/' + weapon.sourceName);
    const suffix = weapon.level >= 2 ? ' Lv.' + weapon.level : '';
    const label = name => name.replace(/\s+Lv\.\d+/g, '') + suffix;
    weapon.name = label(weapon.name);
    for (const localized of Object.values(weapon.localization || {}))
      if (localized.name) localized.name = label(localized.name);
  return weapon;
}
function applyWeaponLevelLabels(prefab) {
  for (const weapon of Object.values(prefab.weapons || {})) labelWeapon(weapon, prefab.id);
  for (const skill of prefab.skills || []) if (skill.level !== undefined) labelWeapon(skill, prefab.id);
  return prefab;
}
module.exports = { applyWeaponLevelLabels, labelWeapon };
