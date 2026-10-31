/* One-time lossless migration; importer saves use weapon-store afterwards. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { core, referenceId, expandPrefab, packPrefab } = require('./weapon-store.cjs');
const root = path.resolve(__dirname, '../assets');
const entries = fs.readdirSync(path.join(root, 'units')).filter(id => fs.existsSync(path.join(root, 'units', id, 'unit.json')))
  .map(id => { const file = path.join(root, 'units', id, 'unit.json'); return { file, unit: JSON.parse(fs.readFileSync(file, 'utf8')) }; });
if (entries.some(({ unit }) => Object.values(unit.weapons).some(w => w.ref))) {
  if (!process.argv.includes('--rebase')) throw Error('Weapons already extracted; use --rebase to rebuild defaults losslessly.');
  for (const entry of entries) entry.unit = expandPrefab(entry.unit);
}
const groups = new Map();
for (const { unit } of entries) for (const [id, weapon] of [...Object.entries(unit.weapons), ...(unit.skills || []).filter(s => s.sourceWeapon).map(s => [s.id, s])]) {
  const ref = referenceId(id, weapon);
  if (!groups.has(ref)) groups.set(ref, []);
  groups.get(ref).push(core(weapon));
}
const definitions = {};
for (const [ref, candidates] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const counts = new Map();
  for (const weapon of candidates) { const key = JSON.stringify(weapon); if (!counts.has(key)) counts.set(key, { weapon, count: 0 }); counts.get(key).count++; }
  definitions[ref] = [...counts.values()].sort((a, b) => b.count - a.count)[0].weapon;
}
const packed = entries.map(({ file, unit }) => {
  const result = packPrefab(unit, definitions, false);
  assert.deepEqual(expandPrefab(result, definitions), unit, unit.id);
  return { file, result };
});
fs.writeFileSync(path.join(root, 'weapons.json'), JSON.stringify({ schemaVersion: 1, definitions }, null, 2) + '\n');
for (const { file, result } of packed) fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
console.log(`Extracted ${definitions && Object.keys(definitions).length} common weapons from ${entries.length} units; all round trips match.`);
