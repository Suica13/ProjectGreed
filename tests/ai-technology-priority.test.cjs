const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const D = require("../shared/development.js");

test("formation tries higher technology before price, while retaining a budget fallback", () => {
  const saved = { ...G.models }, nodes = D.nodes;
  const base = G.models.Type61__standard;
  try {
    for (const id of Object.keys(G.models)) delete G.models[id];
    for (const [id, price] of [["early", 200], ["late-a", 100], ["late-b", 100]])
      G.models[id + "__standard"] = {
        ...base, prefabId: id, kitId: "standard", cost: price,
        ship: false, unitTags: ["MS"], skills: [], commandAuras: [], supplyAura: null,
      };
    D.nodes = (faction) => faction === "EFSF" ? [
      { row: "mid", era: "0079E", page: 0, column: 2, unlocks: ["early"] },
      { row: "mid", era: "0079L", page: 1, column: 2, unlocks: ["late-a", "late-b"] },
    ] : [];
    for (let seed = 1; seed <= 20; seed++) {
      const army = G.randomFormation(seed, 1000, {}, 6);
      assert(army.length >= 2);
      assert(army[0].unitId.startsWith("late-"));
      assert(army[1].unitId.startsWith("late-"));
      assert.notEqual(army[0].unitId, army[1].unitId);
      assert.deepEqual(army, G.randomFormation(seed, 1000, {}, 6));
    }
    G.models["late-a__standard"].cost = 2000;
    G.models["late-b__standard"].cost = 2000;
    const fallback = G.randomFormation(1, 600, {}, 6);
    assert(fallback.length > 0);
    assert(fallback.every(e => e.unitId === "early"));
  } finally {
    D.nodes = nodes;
    for (const id of Object.keys(G.models)) delete G.models[id];
    Object.assign(G.models, saved);
  }
});
