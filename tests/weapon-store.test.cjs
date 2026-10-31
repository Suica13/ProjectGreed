const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const Store = require('../tools/weapon-store.cjs');
const library = JSON.parse(fs.readFileSync('assets/weapons.json', 'utf8'));

test('all unit files reference common weapons and round-trip without losing unit overrides', () => {
  let count = 0;
  for (const folder of fs.readdirSync('assets/units')) {
    const file = `assets/units/${folder}/unit.json`;
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const entry of Object.values(raw.weapons)) {
      assert.ok(entry.ref && Object.hasOwn(library.definitions, entry.ref), folder);
      assert.ok(!entry.attack && !entry.damageComponents, 'shared payload belongs in the library');
      count++;
    }
    for (const skill of raw.skills || []) {
      if (skill.ref) assert.ok(library.definitions[skill.ref].sourceWeapon);
      else assert.ok(!skill.sourceWeapon, 'weapon-derived skills also use shared definitions');
    }
    const expanded = Store.expandPrefab(raw);
    assert.deepEqual(Store.expandPrefab(Store.packPrefab(expanded)), expanded);
  }
  assert.ok(count > 1000);
});

test('common edits propagate, local muzzle overrides stay isolated, and removals are lossless', () => {
  const definitions = { gun: { name: 'Gun', damagePerShot: 100, max: 3 } };
  const a = { id: 'a', weapons: { gun: { ref: 'gun', overrides: { muzzle: { x: 5 } }, remove: ['max'] } } };
  const b = { id: 'b', weapons: { gun: { ref: 'gun', overrides: { muzzle: { x: 10 } } } } };
  definitions.gun.damagePerShot = 200;
  const first = Store.expandPrefab(a, definitions), second = Store.expandPrefab(b, definitions);
  assert.equal(first.weapons.gun.damagePerShot, 200);
  assert.equal(second.weapons.gun.damagePerShot, 200);
  assert.equal(first.weapons.gun.max, undefined);
  first.weapons.gun.muzzle.x = 99;
  assert.equal(second.weapons.gun.muzzle.x, 10);
  assert.equal(a.weapons.gun.overrides.muzzle.x, 5);
  assert.throws(() => Store.expandPrefab({ id: 'bad', weapons: { gun: { ref: 'missing' } } }, definitions));
});

test('Python importer codec and Node runtime codec resolve the same unit without modifying shared definitions', () => {
  const source = fs.readFileSync('assets/units/RX_78_4_Bst/unit.json', 'utf8');
  const before = fs.readFileSync('assets/weapons.json', 'utf8');
  const result = spawnSync('python', ['-c', "import sys;sys.path.insert(0,'tools');from weapon_store import loads,dumps;print(dumps(loads(sys.stdin.read()),ensure_ascii=True))"], { input: source, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Store.parse(result.stdout), Store.parse(source));
  assert.equal(fs.readFileSync('assets/weapons.json', 'utf8'), before);
});
