const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
test("Rick Dom retains Dom combat platform and kits with native strength and opposite adaptation", () => {
  const dom = G.catalog.prefabs.find((p) => p.id === "MS_09");
  const rick = G.catalog.prefabs.find((p) => p.id === "MS_09R");
  assert.equal(rick.code, "MS-09R");
  assert.equal(rick.name, "力克大魔");
  assert.match(rick.source, /MS_09\/MS_09R.ini$/);
  assert.equal(rick.materials.icon, "MS_09R.png");
  assert.deepEqual(rick.tags, ["ZEON", "0079"]);
  assert.deepEqual(rick.stats, {
    ...dom.stats,
    mobility: 110,
    partStructuralStrength: 120,
    adaptability: { ground: 50, space: 100 },
  });
  for (const key of ["attackBonuses", "defenses", "shield", "weaponKits"])
    assert.deepEqual(rick[key], dom[key]);
  for (const [id, w] of Object.entries(dom.weapons)) {
    const other = rick.weapons[id];
    for (const key of [
      "damagePerShot",
      "damageComponents",
      "en",
      "hit",
      "range",
      "attack",
      "muzzle",
    ])
      assert.deepEqual(other[key], w[key], id + ":" + key);
  }
  assert.equal(rick.presentation.movement, "boost");
  assert.ok(rick.layers.some((l) => l.name === "Eye"));
  assert.ok(rick.layers.some((l) => l.name === "BoostLoop"));
  assert.ok(!JSON.stringify(rick.materials).includes("360mm"));
  for (const kit of rick.weaponKits) {
    const model = rick.id + "__" + kit.id;
    assert.equal(G.modelOf({ model, environment: "ground" }).move, 4);
    assert.equal(G.modelOf({ model, environment: "ground" }).mobility, 55);
    assert.equal(G.modelOf({ model, environment: "space" }).move, 8);
    assert.equal(G.modelOf({ model, environment: "space" }).mobility, 110);
    assert.deepEqual(G.validateFormation([{ unitId: rick.id, kitId: kit.id }]), [
      { unitId: rick.id, kitId: kit.id },
    ]);
  }
});
