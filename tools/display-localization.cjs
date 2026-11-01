/* Curated display-only overlays survive native MOD reimports. Never alter IDs or stats. */
const fs = require("node:fs");
const path = require("node:path");
function createLocalizer() {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
  const units = read("assets/localization/units.json");
  const pilots = read("assets/localization/pilots.json");
  const weapons = read("assets/localization/weapons.json");
  const dictionaries = { en: read("client/locales/en.json"), ja: read("client/locales/ja.json") };
  function record(value, override = {}) {
    if (!value) return value;
    if (value.name && /Leg[RL]/.test(value.name)) {
      value.name = value.name.replace(/LegR/g, "右腿").replace(/LegL/g, "左腿");
      if (value.localization?.zh?.name)
        value.localization.zh.name = value.localization.zh.name
          .replace(/LegR/g, "右腿")
          .replace(/LegL/g, "左腿");
    }
    for (const language of ["en", "ja"]) {
      for (const field of ["name", "description"]) {
        const original = value[field];
        if (typeof original !== "string" || !original.trim()) continue;
        const translated =
          override[language]?.[field] ||
          value.localization?.[language]?.[field] ||
          dictionaries[language][original];
        if (translated) {
          value.localization ??= {};
          value.localization[language] ??= {};
          value.localization[language][field] = translated;
        }
      }
    }
    return value;
  }
  function prefab(value) {
    record(value, units[value.id]);
    for (const [id, weapon] of Object.entries(value.weapons || {})) {
      const names = weapons[id];
      // Fill imported fallback names without overwriting an administrator's custom label.
      const original = weapon.name.replace(/\s+Lv\.\d+/g, "");
      if (names && (original === id.replaceAll("_", " ") || original === names.zh)) {
        const suffix = weapon.level > 1 ? " Lv." + weapon.level : "";
        weapon.localization ??= {};
        for (const [language, name] of Object.entries(names)) {
          weapon.localization[language] ??= {};
          weapon.localization[language].name = name + suffix;
        }
        weapon.name = names.zh + suffix;
      }
      record(weapon);
    }
    for (const item of [...(value.weaponKits || []), ...(value.skills || [])]) record(item);
    return value;
  }
  function pilotCatalog(value) {
    for (const item of [...value.named, ...value.portraits, ...(value.aces || [])]) {
      record(item, pilots[item.id]);
      for (const skill of item.skills || []) record(skill);
    }
    for (const skill of value.customSkills || []) record(skill);
    return value;
  }
  return { record, prefab, pilotCatalog };
}
module.exports = { createLocalizer };
