/* Source codec: common weapon definitions plus explicit per-unit overrides. */
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const libraryFile = path.resolve(__dirname, '../assets/weapons.json');
const localFields = new Set(['source', 'muzzle', 'chargeMuzzle', 'requiredParts', 'anyParts', 'availability', 'moduleId', 'moduleIndex']);
let cache, stamp;
function library() {
  const stat = fs.statSync(libraryFile), next = stat.mtimeMs + ':' + stat.size;
  if (next !== stamp) {
    cache = JSON.parse(fs.readFileSync(libraryFile, 'utf8'));
    if (cache.schemaVersion !== 1 || !cache.definitions) throw Error('Invalid weapon library');
    stamp = next;
  }
  return cache;
}
function expandPrefab(value, definitions = library().definitions) {
  if (!value?.id || !value.weapons) return value;
  const result = structuredClone(value);
  const expand = entry => {
    if (!entry.ref) return entry;
    if (!Object.hasOwn(definitions, entry.ref)) throw Error('Unknown weapon reference: ' + entry.ref);
    const weapon = structuredClone(definitions[entry.ref]);
    for (const key of entry.remove || []) delete weapon[key];
    for (const [key, field] of Object.entries(entry.overrides || {})) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('Invalid weapon override');
      Object.defineProperty(weapon, key, { value: field, enumerable: true, writable: true, configurable: true });
    }
    return weapon;
  };
  for (const [id, entry] of Object.entries(result.weapons)) result.weapons[id] = expand(entry);
  if (result.skills) result.skills = result.skills.map(expand);
  return result;
}
function core(weapon) {
  return Object.fromEntries(Object.entries(weapon).filter(([key]) => !localFields.has(key)));
}
function referenceId(id, weapon) { return (weapon.sourceWeapon ? weapon.sourceWeapon + '__skill_' + weapon.type : weapon.sourceName || id) + '__lv' + (weapon.level || 1); }
function packPrefab(value, definitions = library().definitions, persist = true) {
  if (!value?.id || !value.weapons) return value;
  const result = structuredClone(value);
  let changed = false;
  const pack = (id, weapon) => {
    if (weapon.ref) return structuredClone(weapon);
    const ref = referenceId(id, weapon);
    if (!Object.hasOwn(definitions, ref)) { definitions[ref] = core(weapon); changed = true; }
    const base = definitions[ref], overrides = {}, remove = [];
    for (const [key, field] of Object.entries(weapon))
      if (!Object.hasOwn(base, key) || !isDeepStrictEqual(field, base[key])) overrides[key] = field;
    for (const key of Object.keys(base)) if (!Object.hasOwn(weapon, key)) remove.push(key);
    return { ref, ...(Object.keys(overrides).length ? { overrides } : {}), ...(remove.length ? { remove } : {}) };
  };
  for (const [id, weapon] of Object.entries(value.weapons)) result.weapons[id] = pack(id, weapon);
  if (value.skills) result.skills = value.skills.map(skill => skill.sourceWeapon || skill.ref ? pack(skill.id, skill) : structuredClone(skill));
  if (changed && persist) {
    const tmp = libraryFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, definitions }, null, 2) + '\n');
    fs.renameSync(tmp, libraryFile);
    stamp = undefined;
  }
  return result;
}
function parse(text, reviver) {
  const value = JSON.parse(text, reviver);
  return value?.id && value.weapons ? expandPrefab(value) : value;
}
function stringify(value, replacer, space) {
  return JSON.stringify(value?.id && value.weapons ? packPrefab(value) : value, replacer, space);
}
module.exports = { expandPrefab, packPrefab, parse, stringify, core, referenceId };
