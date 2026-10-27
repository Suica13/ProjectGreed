const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const G = require("../shared/rules.js");
test("unit capacities follow the half-EN policy, including every form and the MS_06C exception", () => {
  for (const prefab of G.catalog.prefabs) {
    const source = prefab.sourceStats;
    assert.ok(source.enBeforeReduction > 0, prefab.id);
    assert.equal(source.enCapacityMultiplier, 0.5, prefab.id);
    const expected = source.enCapacityOverride ?? source.enBeforeReduction * 0.5;
    assert.equal(prefab.stats.en, expected, prefab.id);
    for (const kit of prefab.weaponKits)
      assert.equal(G.models[prefab.id + "__" + kit.id].en, expected, prefab.id);
  }
  const model = Object.values(G.models).find((model) => model.prefabId === "MS_06C");
  assert.equal(model.en, 350);
  const nuke = model.weapons.find((weapon) => weapon.special?.type === "nuke");
  assert.ok(nuke);
  assert.equal(nuke.en, 350);
});
test("import energy policy is stable on repeated refreshes and preserves weapon costs", () => {
  const script = `import sys,json
sys.path.insert(0,'tools')
from unit_energy import apply_capacity_policy
p={'id':'normal','stats':{'en':750},'weapons':{'gun':{'en':55}}}
apply_capacity_policy(p)
apply_capacity_policy(p)
assert p['stats']['en']==375
assert p['weapons']['gun']['en']==55
apply_capacity_policy(p,900)
apply_capacity_policy(p,900)
assert p['stats']['en']==450
p['id']='MS_06C'
apply_capacity_policy(p,450)
apply_capacity_policy(p)
assert p['stats']['en']==350
print('energy policy passed')`;
  const result = spawnSync("python", ["-c", script], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});
