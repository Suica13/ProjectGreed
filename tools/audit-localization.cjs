/* Run after adding UI text or importing units: node tools/audit-localization.cjs */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const dictionaries = { en: read("client/locales/en.json"), ja: read("client/locales/ja.json") };
const { createLocalizer } = require("./display-localization.cjs");
const localizer = createLocalizer(),
  catalog = require("./load-catalog.cjs").loadCatalog();
const errors = [],
  counts = {
    units: 0,
    weapons: 0,
    kits: 0,
    skills: 0,
    aces: 0,
    uiKeys: Object.keys(dictionaries.en).length,
  };
function check(record, label, fields = ["name"]) {
  for (const language of ["en", "ja"])
    for (const field of fields) {
      const value = record.localization?.[language]?.[field];
      if (!value?.trim()) errors.push(`${label}/${language}/${field}`);
      else if (language === "en" && /[\u3400-\u9fff]/.test(value))
        errors.push(`${label}/en/${field}: untranslated Han characters`);
    }
}
for (const unit of catalog.prefabs) {
  counts.units++;
  check(unit, unit.id, ["name", "description"]);
  for (const [kind, items] of [
    ["weapons", Object.values(unit.weapons)],
    ["kits", unit.weaponKits],
    ["skills", unit.skills || []],
  ])
    for (const item of items) {
      counts[kind]++;
      check(item, unit.id + "/" + (item.id || item.name));
    }
}
for (const map of Object.values(catalog.maps)) check(map, map.id, ["name", "description"]);
const pilots = localizer.pilotCatalog(read("shared/pilots.json"));
for (const ace of pilots.aces) {
  counts.aces++;
  check(ace, ace.id, ["name", "description"]);
  for (const skill of ace.skills) check(skill, ace.id + "/" + skill.id, ["name", "description"]);
}
for (const nodes of Object.values(read("shared/development-tree.json")))
  for (const node of nodes) check(localizer.record(node), node.id, ["name", "description"]);
for (const language of ["en", "ja"])
  for (const [key, value] of Object.entries(dictionaries[language])) {
    if (!dictionaries[language === "en" ? "ja" : "en"][key])
      errors.push("Missing dictionary key: " + key);
    const tokens = (t) => (t.match(/\{\w+\}/g) || []).sort().join("|");
    if (tokens(key) !== tokens(value)) errors.push("Placeholder mismatch: " + key + "/" + language);
  }
// Simple quoted UI/error literals. Templates require rendered browser checks.
for (const dir of ["client", "shared"])
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!/\.(?:js|html)$/.test(name)) continue;
    const source = fs.readFileSync(path.join(root, dir, name), "utf8");
    for (const match of source.matchAll(/(["'])([^\n"']*[\u3400-\u9fff][^\n"']*)\1/g)) {
      const key = match[2].trim();
      if (!/[<>\\{;]/.test(key) && !dictionaries.en[key]) errors.push(`${dir}/${name}: ${key}`);
    }
  }
console.log(JSON.stringify({ counts, errors: [...new Set(errors)] }, null, 2));
if (errors.length) process.exitCode = 1;
