const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {loadCatalog} = require("../tools/load-catalog.cjs");
const G = require("../shared/rules.js");

test("unit mobility has independent 100-point thresholds and stacks with pilot mobility", () => {
  const registry = JSON.parse(fs.readFileSync("assets/unit-catalog.json", "utf8"));
  const speeds = [0, 49, 50, 51, 99, 100, 149, 150, 199, 200];
  const refs = registry.units.slice(0, speeds.length);
  const overrides = Object.fromEntries(refs.map((ref, i) => {
    const p = JSON.parse(fs.readFileSync("assets/" + ref, "utf8"));
    p.stats.speed = speeds[i];
    return [ref, p];
  }));
  const catalog = loadCatalog({unitOverrides: overrides});
  for (const [ref, p] of Object.entries(overrides)) {
    const bonus = Math.trunc((p.stats.speed - 100) / 50);
    for (const m of Object.values(catalog.models).filter(m => m.prefabId === p.id)) {
      assert.equal(m.move, p.stats.deployed ? 0 : p.stats.move + bonus, ref);
      assert.equal(m.actionPoints, p.stats.actionPoints ?? 5, ref);
      assert.equal(m.mobility, p.stats.mobility, "reaction is unchanged");
    }
  }
  const id = Object.keys(G.models).find(id => G.models[id].prefabId === "RGM_79");
  const original = G.models[id];
  const base = {...original, speed: 200, move: original.move + 2, actionPoints: original.actionPoints};
  G.models[id] = base;
  try {
    const unit = {id:"speed-check",model:id, x:10,y:10,hp:base.hp,
      pilot:{stats:{...G.pilots.baseStats(),speed:150}}};
    const model = G.modelOf(unit);
    assert.equal(model.move, base.move * 1.25);
    assert.equal(G.actionBudget(unit), Math.round(original.actionPoints * 1.125));
    assert.equal(model.mobility, original.mobility);
    assert.equal(model.pilotModifiers.reaction, 1);
  } finally { G.models[id] = original; }
});
