const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const G = require("../shared/rules.js");

test("ramming is the final weapon in every kit, including compiled paired weapons", () => {
  const catalog = loadCatalog();
  let checked = 0;
  for (const prefab of catalog.prefabs)
    for (const kit of prefab.weaponKits) {
      if (!kit.weapons.some(id => id.startsWith("Common_Push_"))) continue;
      assert(kit.weapons.at(-1).startsWith("Common_Push_"), prefab.id + "/" + kit.id);
      const weapons = catalog.models[prefab.id + "__" + kit.id].weapons;
      assert(weapons.at(-1).id.startsWith("Common_Push_"), prefab.id + "/" + kit.id);
      checked++;
    }
  assert(checked > 200);
});

test("all strong assault Guntank missile variants require 5 AP in shared combat rules", () => {
  const models = Object.values(G.models).filter(model => model.prefabId === "RTX_440");
  let checked = 0;
  for (const model of models)
    for (const weapon of model.weapons) {
      if (!weapon.id.startsWith("EF_RTX_440_Rocket")) continue;
      assert.equal(weapon.actionCost, 5, weapon.id);
      assert.equal(G.actionCost(weapon), 5, weapon.id);
      checked++;
    }
  assert(checked > 0);
});
