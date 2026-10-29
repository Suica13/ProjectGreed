const test = require("node:test"),
  assert = require("node:assert/strict");
const Sequence = require("../shared/weapon-sequence.js"),
  G = require("../shared/rules.js");
const sum = (components) => Object.values(components).reduce((n, v) => n + v, 0);
const aligned = (value) => assert.equal(value % 25, 0, String(value));
function fixture() {
  const g = G.create(
    false,
    1,
    [[{ unitId: "RGM_79", kitId: "beam_spray" }], [{ unitId: "MS_07B", kitId: "standard" }]],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  const [a, b] = g.units;
  Object.assign(a, { x: 3, y: 8, en: 100000, performance: 1.13 });
  Object.assign(b, { x: 5, y: 8, hp: 1000000, shield: 5000, performance: 0.91 });
  const stats = {
    shooting: 137,
    melee: 127,
    defense: 119,
    speed: 111,
    accuracy: 200,
    reaction: 100,
    leadership: 100,
    awakening: 100,
  };
  a.pilot = { stats: { ...stats } };
  b.pilot = { stats: { ...stats, shooting: 100, defense: 133 } };
  return { g, a, b, w: G.modelOf(a).weapons.find((w) => w.id === "EF_BeamSprayGun") };
}
test("damage rounds to the nearest 25, including zero and midpoint boundaries", () => {
  for (const [input, expected] of [
    [0, 0],
    [8, 0],
    [12.49, 0],
    [12.5, 25],
    [37.49, 25],
    [37.5, 50],
    [1012.5, 1025],
  ])
    assert.equal(Sequence.roundDamage(input), expected);
  assert.throws(() => Sequence.roundDamage(NaN));
  assert.throws(() => Sequence.roundComponents({ beam: -1 }));
  const source = { beam: 19978.17, beamAP: 9989.08 };
  const result = Sequence.roundComponents(source);
  assert.equal(sum(result), Sequence.roundDamage(sum(source)));
  Object.values(result).forEach(aligned);
  assert.deepEqual(Sequence.roundComponents(result), result);
});
test("every compiled weapon, strike and damaging skill uses the shared 25-point policy", () => {
  for (const model of Object.values(G.models)) {
    for (const weapon of model.weapons) {
      aligned(weapon.damagePerShot);
      aligned(weapon.damage);
      Object.values(weapon.damageComponents).forEach(aligned);
      for (const strike of weapon.attack.strikes) {
        assert.equal(strike.damageMultiplier, 1);
        Object.values(strike.damageComponents || weapon.damageComponents).forEach(aligned);
      }
    }
    for (const skill of model.skills || [])
      if (skill.damageComponents) Object.values(skill.damageComponents).forEach(aligned);
  }
});
test("pilot, strength, armor and defensive stance modifiers round after final calculation", () => {
  for (const response of ["counter", "defend", "evade"]) {
    const { g, a, b, w } = fixture();
    const estimate = G.estimate(g, a, b, w, response);
    [estimate.damage, estimate.blockedDamage, estimate.shieldDamage, estimate.iFieldDamage].forEach(
      aligned,
    );
    const events = G.fight(g, a, b, w, response, null, false);
    for (const event of events)
      for (const strike of event.strikes) {
        aligned(strike.damage);
        aligned(strike.shieldDamage);
        assert.equal(strike.before - strike.after, strike.damage);
      }
  }
});
test("turn-end burning rounds after SP defense and finishing hits never exceed remaining HP", () => {
  const { g, a, b, w } = fixture();
  g.team = b.team;
  b.burning = { expiresRound: g.round + 6, hpPercent: 5, sourceId: a.id };
  const event = G.tickBurning(g)[0];
  aligned(event.damage);
  const model = G.modelOf(b);
  assert.equal(
    event.damage,
    G.roundDamage(model.hp * 0.05 * (1 - (model.defenses.sp.percent || 0) / 100)),
  );
  const again = fixture();
  again.b.hp = 7;
  again.b.shield = 0;
  again.g.seed = 1;
  const events = G.fight(again.g, again.a, again.b, again.w, "evade", null, false);
  assert.equal(events[0].damage, 7);
  assert.equal(again.b.hp, 0);
});
