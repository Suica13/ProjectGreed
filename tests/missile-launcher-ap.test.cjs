const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");

test("ground type and four-container missile launchers cost 6 AP in every kit", () => {
  const counts = new Map([
    ["EF_GroundTypeMissileLauncher", 0],
    ["ZN_4XMSL", 0],
  ]);
  for (const model of Object.values(G.models))
    for (const weapon of model.weapons) {
      if (!counts.has(weapon.id)) continue;
      assert.equal(weapon.actionCost, 6, model.id + "/" + weapon.id);
      assert.equal(G.actionCost(weapon), 6);
      counts.set(weapon.id, counts.get(weapon.id) + 1);
    }
  for (const count of counts.values()) assert.ok(count > 0);
});
