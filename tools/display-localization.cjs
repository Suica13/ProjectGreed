/* Curated display-only overlays survive native MOD reimports. Never alter IDs or stats. */
const fs = require("node:fs");
const path = require("node:path");
function createLocalizer() {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
  const units = read("assets/localization/units.json");
  const pilots = read("assets/localization/pilots.json");
  const dictionaries = { en: read("client/locales/en.json"), ja: read("client/locales/ja.json") };
  function record(value, override = {}) {
    if (!value) return value;
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
    for (const item of [
      ...Object.values(value.weapons || {}),
      ...(value.weaponKits || []),
      ...(value.skills || []),
    ])
      record(item);
    return value;
  }
  function pilotCatalog(value) {
    for (const item of [...value.named, ...value.portraits, ...(value.aces || [])]) {
      record(item, pilots[item.id]);
      for (const skill of item.skills || []) record(skill);
    }
    return value;
  }
  return { record, prefab, pilotCatalog };
}
module.exports = { createLocalizer };
