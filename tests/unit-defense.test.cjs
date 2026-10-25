const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Sequence = require("../shared/weapon-sequence.js");
const entry = (unitId, kitId = "machine_gun") => ({ unitId, kitId });
function duel(defender = "RGM_79", seed = 1) {
  const g = G.create(false, seed, [[entry("RGM_79")], [entry(defender)]]);
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 3 });
  Object.assign(b, { x: 4, y: 3 });
  return { g, a, b, w: G.models[a.model].weapons[0] };
}
test("variants retain original hull values, fixed cannon and native multi-stage light GM saber", () => {
  const gm = G.models.RGM_79__machine_gun,
    cannon = G.models.RGC_80__machine_gun,
    light = G.models.RGM_79L__beam_gun;
  assert.deepEqual([gm.hp, cannon.hp, light.hp], [21000, 18500, 17000]);
  assert.ok(cannon.move < gm.move && light.move > gm.move);
  const w = cannon.weapons.find((w) => w.id === "Common_Cannon");
  assert.equal(w.damage, 8000);
  assert.equal(w.shotCount, 1);
  assert.equal(w.changeHeldWeapon, false);
  assert.equal(w.max, 5);
  const saber = light.weapons.find((w) => w.type === "melee");
  assert.deepEqual(saber.attack.shots, [0.4, 1.3]);
  assert.deepEqual(
    saber.attack.strikes.map((s) => s.damageMultiplier),
    [1, 1],
  );
});

test("all visible native weapon panels retain their original accuracy without artificial tiers", () => {
  for (const m of Object.values(G.models))
    for (const w of m.weapons) {
      assert.equal(w.hit, w.sourceHit);
      assert.equal(w.hitMultiplier, 1);
      assert.equal(w.hitBonus, 0);
    }
  assert.equal(G.models.RGM_79__bazooka.weapons[0].hit, 75);
});

test("MOD protection subtracts flat damage per bullet before percentage; melee components use separate defenses", () => {
  const { g, a, b, w } = duel("RGM_79", 13);
  assert.equal(G.estimate(g, a, b, w).damage, 4680); // (725*1.2*.75-75)*.9*9, rounded per strike
  assert.equal(G.estimate(g, a, b, w, "defend").damage, 3303);
  const saber = G.models.RGM_79__beam_spray.weapons[1];
  assert.equal(G.estimate(g, a, b, saber).damage, 3804); // Native 15% melee bonus, separate beam and melee armor
  const low = { ...w, damageComponents: { shell: 25 }, damagePerShot: 25 };
  assert.equal(G.estimate(g, a, b, low).damage, 0);
});
test("server-side shield blocks consume durability, spill to HP and disappear at zero; misses consume neither", () => {
  // Seed 9: first draw hits, second draw blocks. Seed 1900 starts with a Miss.
  const { g, a, b, w } = duel("RGM_79", 9);
  b.shield = 100;
  const event = G.fight(g, a, b, w, "defend")[0];
  assert.equal(event.blocked, true);
  assert.equal(event.shieldDamage, 100);
  assert.equal(event.damage, 2462);
  assert.equal(event.strikes[0].damage, 260);
  assert.equal(event.strikes[0].shieldAfter, 0);
  assert.equal(b.shield, 0);
  assert.equal(G.estimate(g, a, b, w).blockChance, 0);
  const miss = duel("RGM_79", 1900),
    before = miss.b.hp,
    shield = miss.b.shield;
  const missedStrike = G.fight(miss.g, miss.a, miss.b, { ...miss.w, hit: 60 }, "defend")[0]
    .strikes[0];
  assert.equal(missedStrike.hit, false);
  assert.equal(missedStrike.before, before);
  assert.equal(missedStrike.after, before);
  assert.equal(missedStrike.shieldBefore, shield);
  assert.equal(missedStrike.shieldAfter, shield);
});
test("a burst rolls each projectile independently and spends ammo once; melee rolls both stages", () => {
  const { g, a, b, w } = duel("RGM_79", 13);
  b.shield = 0;
  const result = G.fight(g, a, b, { ...w, hit: 80 }, "defend")[0];
  assert.deepEqual(
    result.strikes.map((s) => s.hit),
    [true, true, false, true, true, true, false, true, true],
  );
  assert.equal(result.hitCount, 7);
  assert.equal(result.damage, 2569);
  assert.equal(a.en, G.modelOf(a).en - w.en);
  assert.equal("ammo" in a, false);
  assert.equal(b.hp, 21000 - 2569);
  const other = duel("RGM_79", 30);
  other.b.x = 3;
  other.b.shield = 0;
  const saber = { ...G.models.RGM_79L__beam_gun.weapons[1], hit: 60 };
  const sword = G.fight(other.g, other.a, other.b, saber, "defend", null)[0];
  assert.equal(sword.strikes.length, 2);
  assert.notEqual(sword.strikes[0].hit, sword.strikes[1].hit);
  assert.equal(other.a.en, G.modelOf(other.a).en);
});
test("server dodge lanes alternate through center, randomize both directions and carry into counter attacks", () => {
  const directions = new Set();
  for (let seed = 0; seed < 50; seed++) {
    const { g, a, b, w } = duel("RGM_79", seed);
    a.shield = 0;
    b.shield = 0;
    const events = G.fight(g, a, b, w, "counter", w.id);
    for (const event of events) {
      let slot = event.targetDodgeSlot;
      for (const strike of event.strikes)
        if (strike.executed && !strike.hit) {
          if (slot === 0) {
            assert.ok([-1, 1].includes(strike.dodgeTo));
            directions.add(strike.dodgeTo);
          } else assert.equal(strike.dodgeTo, 0);
          slot = strike.dodgeTo;
        }
      assert.equal(event.targetDodgeEnd, slot);
    }
    assert.equal(events[1].sourceDodgeSlot, events[0].targetDodgeEnd);
    assert.deepEqual([a.x, a.y, b.x, b.y], [2, 3, 4, 3]);
  }
  assert.equal(directions.size, 2);
});
test("all weapons use EN once per volley and honor available energy", () => {
  for (const model of Object.values(G.models))
    for (const weapon of model.weapons) {
      assert.equal("ammo" in weapon, false);
      assert.ok(weapon.en >= 0);
      assert.equal(G.canUse({ hp: 1, en: weapon.en - 1 }, weapon), false);
      assert.equal(G.canUse({ hp: 1, en: weapon.en }, weapon), true);
    }
  const { g, a, b, w } = duel();
  a.en = 9;
  assert.throws(() => G.fight(g, a, b, w, "defend"));
  assert.equal(a.en, 9);
  a.en = w.en;
  G.fight(g, a, b, w, "defend");
  assert.equal(a.en, 0);
  assert.ok(G.deploymentCells(G.create(), 0).some((c) => c.x === 2 && c.y === 8));
  assert.ok(!G.deploymentCells(G.create(), 0).some((c) => c.x === 14 && c.y === 8));
});
test("shooting/melee and beam/shell bonuses multiply the right components before protection", () => {
  const { g, a, b, w } = duel(),
    bonuses = G.models[a.model].attackBonuses,
    before = { ...bonuses };
  try {
    Object.assign(bonuses, { shooting: 20, melee: 20, beam: 10, shell: 10 });
    assert.equal(G.estimate(g, a, b, w).damage, 5202);
    const beam = G.models.RGM_79__beam_spray.weapons[0],
      saber = G.models.RGM_79__machine_gun.weapons[1];
    assert.equal(G.estimate(g, a, b, beam).damage, 4703);
    assert.equal(G.estimate(g, a, b, saber).damage, 4191);
  } finally {
    Object.assign(bonuses, before);
  }
});
