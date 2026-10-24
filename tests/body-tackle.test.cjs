const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Parts = require("../shared/unit-parts.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
const id = "Common_Push_A";
function pair() {
  const g = G.create(false, 1, [
    [{ unitId: "RGM_79", kitId: "machine_gun" }],
    [{ unitId: "RGM_79", kitId: "machine_gun" }],
  ]);
  const [a, b] = g.units;
  Object.assign(a, {
    x: 2,
    y: 4,
    en: 0,
    brokenParts: Object.fromEntries(Object.keys(Parts.names).map((p) => [p, true])),
  });
  Object.assign(b, { x: 3, y: 4, hp: 100000, shield: 0 });
  g.tiles[4][2] = g.tiles[4][3] = "plain";
  return { g, a, b, w: G.modelOf(a).weapons.find((w) => w.id === id) };
}
test("every kit exposes native arm-independent body tackle with one strike and original audio/effect", () => {
  for (const model of Object.values(G.models)) {
    const w = model.weapons.find((w) => w.id === id);
    assert.ok(w, model.id);
    assert.equal(w.slot, "skill");
    assert.equal(w.en, 0);
    assert.equal(w.damage, 5000);
    assert.equal(w.hit, 95);
    assert.equal(w.shotCount, 1);
    assert.deepEqual(w.damageComponents, { melee: 2500, meleeShell: 2500 });
    assert.deepEqual(w.requiredParts, []);
    assert.equal(w.partBreakModifier, 0.75);
    assert.equal(w.attack.strikes[0].at, 0.45);
    assert.equal(w.attack.duration, 1.45);
    assert.equal(w.changeHeldWeapon, false);
    assert.equal(w.clip, id);
    assert.ok(G.catalog.sounds[w.sound.asset].startsWith("data:audio/"));
    assert.ok(w.sound.file.endsWith("Fist_2.ogg"));
    assert.equal(G.catalog.effects[w.swingEffects[0]].frames, 6);
  }
});
test("zero-EN body tackle survives all limb losses, consumes one action and retains the held weapon", () => {
  const { g, a, b, w } = pair(),
    held = a.heldWeapon;
  assert.equal(G.canUse(a, w), true);
  assert.equal(G.canAttack(g, a, { ...b, x: 4 }, w), false);
  const event = G.fight(g, a, b, w, "defend", null, false)[0];
  assert.equal(event.strikes.length, 1);
  assert.equal(a.en, 0);
  assert.equal(a.acted, true);
  assert.equal(a.heldWeapon, held);
  assert.equal(event.heldWeapon, held);
  assert.throws(() => G.fight(g, a, b, w, "defend", null, false));
  a.hp = 0;
  assert.equal(G.canUse(a, w), false);
});
test("body tackle uses the shared planner without damage or resource changes before resolution", () => {
  const { g, a, b, w } = pair(),
    room = { game: g },
    planner = createAttackPlanner(G, () => "tackle");
  planner.reset(room);
  const hp = b.hp,
    held = a.heldWeapon;
  planner.plan(room, a, b, w, 0);
  planner.plan(room, a, b, w, 0);
  assert.equal(room.plans.length, 1);
  assert.equal(a.plan.weapon, id);
  assert.equal(b.hp, hp);
  assert.equal(a.en, 0);
  assert.equal(a.heldWeapon, held);
  planner.cancel(room, a);
  assert.equal(a.acted, false);
  assert.equal(
    G.canCounter(
      g,
      b,
      a,
      G.modelOf(b).weapons.find((w) => w.id === id),
    ),
    true,
  );
});
