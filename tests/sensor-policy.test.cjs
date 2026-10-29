const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  fs = require("node:fs");
test("every imported unit uses rounded 40 percent native sight, with radar ratios and anti-detection preserved", () => {
  for (const path of require("../assets/unit-catalog.json").units) {
    const unit = JSON.parse(fs.readFileSync("assets/" + path, "utf8")),
      raw = unit.sourceStats.sensors,
      actual = unit.stats.sensors;
    assert.ok(actual.sight === Math.round(raw.sight * 0.4), unit.id);
    assert.ok(Math.abs(actual.radar - raw.radar / 36) < 1e-9, unit.id);
    assert.ok(Math.abs(actual.antiDetection - raw.antiDetection / 28.8) < 1e-9, unit.id);
    if (Math.abs(raw.radar - raw.sight * 18) < 1e-9)
      assert.ok(Math.abs(actual.radar - raw.sight * 0.4 * 1.25) < 1e-9, unit.id);
  }
});
test("unmarked visible targets still apply a 25 percent final hit penalty", () => {
  const tank = { unitId: "Type61", kitId: "standard" };
  const game = G.create(false, 1, [[tank], [tank]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
    fogMode: "visible",
  });
  const [attacker, target] = game.units;
  Object.assign(attacker, { x: 2, y: 4 });
  Object.assign(target, { x: 25, y: 4 });
  game.tiles.forEach((row) => row.fill("plain"));
  assert.equal(G.sensors.detected(game, attacker.team, target), false);
  // Keep both cases below the final 100% cap to isolate the marking penalty.
  const weapon = { ...G.modelOf(attacker).weapons[0], hit: 40 },
    unmarked = G.estimate(game, attacker, target, weapon).hit;
  target.detectedBy = { [attacker.team]: game.round };
  assert.equal(G.sensors.detected(game, attacker.team, target), true);
  const marked = G.estimate(game, attacker, target, weapon).hit;
  assert.ok(marked > 0);
  assert.ok(Math.abs(unmarked - marked * 0.75) < 1e-9);
});
