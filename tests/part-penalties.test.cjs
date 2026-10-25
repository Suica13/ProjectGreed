const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
function fixture() {
  const e = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[e], [e]]),
    [a, b] = g.units;
  g.tiles = g.tiles.map((row) => row.map(() => "plain"));
  Object.assign(a, { x: 2, y: 4 });
  Object.assign(b, { x: 20, y: 10, shield: 0 });
  return { g, a, b };
}
test("head damage scales every damage channel once, preserves accuracy and combines with AI performance", () => {
  const { g, a, b } = fixture();
  a.performance = 1.25;
  const intact = G.modelOf(a),
    raw = intact.weapons[0];
  a.brokenParts.head = true;
  const damaged = G.modelOf(a),
    w = damaged.weapons[0];
  assert.equal(w.damagePerShot, raw.damagePerShot * 0.75);
  assert.equal(w.hit, raw.hit);
  assert.deepEqual(G.weaponStats(w, a), w);
  for (const [key, value] of Object.entries(raw.damageComponents))
    assert.equal(w.damageComponents[key], value * 0.75);
  const manual = {
    ...raw,
    damageComponents: Object.fromEntries(
      Object.entries(raw.damageComponents).map(([k, v]) => [k, v * 0.75]),
    ),
  };
  assert.equal(
    G.estimate(g, a, b, w).damage,
    G.estimate(g, { ...a, brokenParts: {} }, b, manual).damage,
  );
  assert.equal(G.modelOf({ ...a, brokenParts: {} }).weapons[0].damagePerShot, raw.damagePerShot);
  assert.equal(G.models[a.model].weapons[0].damagePerShot, raw.damagePerShot);
});
test("destroyed backpacks reduce authoritative movement by 25 percent rounded down without reducing mobility", () => {
  const { g, a } = fixture(),
    base = G.modelOf(a);
  a.brokenParts.backpack = true;
  const m = G.modelOf(a),
    limit = Math.max(1, Math.floor(base.move * 0.75));
  assert.equal(m.move, limit);
  assert.equal(m.mobility, base.mobility);
  assert.equal(G.reachable(g, a).has(G.key(a.x + limit, a.y)), true);
  assert.equal(G.reachable(g, a).has(G.key(a.x + limit + 1, a.y)), false);
  assert.throws(() => G.move(g, a, a.x + limit + 1, a.y));
  assert.equal(G.models[a.model].move, base.move);
});
test("each destroyed limb subtracts 2.5 percentage points from hull resistance, including below zero, without altering shield or flat armor", () => {
  const { g, a, b } = fixture(),
    base = G.modelOf(b),
    w = G.modelOf(a).weapons[0];
  const initial = G.estimate(g, a, b, w).damage;
  for (const [i, part] of ["leftArm", "rightArm", "leftLeg", "rightLeg"].entries()) {
    b.brokenParts[part] = true;
    const m = G.modelOf(b);
    for (const [channel, value] of Object.entries(base.defenses)) {
      assert.equal(m.defenses[channel].percent, value.percent - (i + 1) * 2.5);
      assert.equal(m.defenses[channel].flat, value.flat);
    }
    assert.equal(m.shield, base.shield);
    assert.equal(m.move, base.move);
    assert.equal(G.partPenalties(b).resistancePenalty, (i + 1) * 2.5);
  }
  assert.ok(G.estimate(g, a, b, w).damage > initial);
  const shell = G.modelOf(b).defenses.shell;
  assert.equal(shell.percent, base.defenses.shell.percent - 10);
});
test("actual body-tackle damage and counters use the same head penalty as forecasts", () => {
  for (const damaged of [false, true]) {
    const { g, a, b } = fixture();
    Object.assign(b, { x: 3, y: 4, hp: 100000 });
    a.brokenParts.head = damaged;
    b.brokenParts.head = damaged;
    const w = G.modelOf(a).weapons.find((w) => w.id === "Common_Push_A");
    const events = G.fight(g, a, b, w, "defend");
    assert.equal(events.length, 1);
    for (const event of events) assert.equal(event.damagePerShot, damaged ? 3750 : 5000);
    assert.equal(G.weaponStats(w, a).damagePerShot, damaged ? 3750 : 5000);
  }
});
