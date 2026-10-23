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
test("new variants retain native equipment, fixed cannon, different movement and durability", () => {
  const gm = G.models.RGM_79__machine_gun,
    cannon = G.models.RGC_80__machine_gun,
    light = G.models.RGM_79L__machine_gun;
  assert.ok(cannon.move < gm.move && gm.move < light.move);
  assert.ok(cannon.mobility < gm.mobility && gm.mobility < light.mobility);
  assert.ok(cannon.hp < light.hp && light.hp < gm.hp);
  for (const model of Object.values(G.models).filter((m) => m.prefabId === "RGC_80")) {
    const weapon = model.weapons.find((w) => w.id === "Common_Cannon");
    assert.equal(weapon.slot, "fixed");
    assert.equal(weapon.changeHeldWeapon, false);
    assert.equal(weapon.damage, 7800);
    assert.equal(weapon.max, 8);
    assert.deepEqual(weapon.attack.shots, [0.6, 1.2, 1.8]);
    assert.equal(Sequence.pose(weapon, 0).clip, null);
    assert.equal(Sequence.pose(weapon, 0.4).clip, "Common_Cannon_Shoot_A");
  }
  const saber = G.models.RGM_79L__beam_gun.weapons.find((w) => w.id === "EF_BeamSaber_BF");
  assert.deepEqual(saber.attack.shots, [0.4, 1.3]);
  assert.equal(Sequence.pose(saber, 1.3).clip, "Common_Melee_F");
  assert.equal(G.models.RGM_79L__beam_gun.weapons[0].damage, 3900);
  assert.deepEqual(G.models.RGM_79L__beam_gun.weapons[0].attack.shots, [0.15, 0.55, 0.95]);
});
test("all weapon hit chances are reduced 15-35 percent; bazooka and cannon form the low tier", () => {
  for (const m of Object.values(G.models))
    for (const w of m.weapons) {
      assert.ok(w.hitMultiplier >= 0.65 && w.hitMultiplier <= 0.85);
      assert.equal(w.hit, Math.round(w.sourceHit * w.hitMultiplier) + 10);
    }
  assert.equal(G.models.RGM_79__bazooka.weapons[0].hit, 62);
  assert.equal(G.models.RGC_80__beam_spray.weapons.find((w) => w.id === "Common_Cannon").hit, 59);
  assert.equal(G.models.RGM_79L__machine_gun.move, 7);
  const standard = duel(),
    light = duel("RGM_79L"),
    cannon = duel("RGC_80");
  assert.ok(
    G.estimate(light.g, light.a, light.b, light.w).hit <
      G.estimate(standard.g, standard.a, standard.b, standard.w).hit,
  );
  assert.ok(
    G.estimate(cannon.g, cannon.a, cannon.b, cannon.w).hit >
      G.estimate(standard.g, standard.a, standard.b, standard.w).hit,
  );
});
test("MOD protection subtracts flat damage per bullet before percentage; melee components use separate defenses", () => {
  const { g, a, b, w } = duel("RGM_79", 1500);
  assert.equal(G.estimate(g, a, b, w).damage, 5265); // (725-75)*.9*9
  assert.equal(G.estimate(g, a, b, w, "defend").damage, 2637);
  const saber = G.models.RGM_79__beam_spray.weapons[1];
  assert.equal(G.estimate(g, a, b, saber).damage, 8880); // ((2500-100)*.9 + (2500-100)*.95)*2
  const low = { ...w, damageComponents: { shell: 25 }, damagePerShot: 25 };
  assert.equal(G.estimate(g, a, b, low).damage, 0);
});
test("server-side shield blocks consume durability, spill to HP and disappear at zero; misses consume neither", () => {
  // Seed 9: first draw hits, second draw blocks. Seed 1500 misses after the accuracy reduction.
  const { g, a, b, w } = duel("RGM_79", 9);
  b.shield = 100;
  const event = G.fight(g, a, b, w, "defend")[0];
  assert.equal(event.blocked, true);
  assert.equal(event.shieldDamage, 100);
  assert.equal(event.damage, 1951);
  assert.equal(event.strikes[0].damage, 193);
  assert.equal(event.strikes[0].shieldAfter, 0);
  assert.equal(b.shield, 0);
  assert.equal(G.estimate(g, a, b, w).blockChance, 0);
  const miss = duel("RGM_79", 1500),
    before = miss.b.hp,
    shield = miss.b.shield;
  const missedStrike = G.fight(miss.g, miss.a, miss.b, miss.w, "defend")[0].strikes[0];
  assert.equal(missedStrike.hit, false);
  assert.equal(missedStrike.before, before);
  assert.equal(missedStrike.after, before);
  assert.equal(missedStrike.shieldBefore, shield);
  assert.equal(missedStrike.shieldAfter, shield);
});
test("a burst rolls each projectile independently and spends ammo once; melee rolls both stages", () => {
  const { g, a, b, w } = duel("RGM_79", 1500);
  b.shield = 0;
  const result = G.fight(g, a, b, w, "defend")[0];
  assert.deepEqual(
    result.strikes.map((s) => s.hit),
    [false, true, false, true, true, true, false, false, true],
  );
  assert.equal(result.hitCount, 5);
  assert.equal(result.damage, 1465);
  assert.equal(a.en, 90);
  assert.equal("ammo" in a, false);
  assert.equal(b.hp, 21000 - 1465);
  const other = duel("RGM_79", 1765);
  other.b.x = 3;
  other.b.shield = 0;
  const saber = G.models.RGM_79__machine_gun.weapons[1];
  const sword = G.fight(
    other.g,
    other.a,
    other.b,
    saber,
    "counter",
    G.models.RGM_79__machine_gun.weapons[1].id,
  )[0];
  assert.equal(sword.strikes.length, 2);
  assert.notEqual(sword.strikes[0].hit, sword.strikes[1].hit);
  assert.equal(other.a.en, 92);
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
      assert.ok(weapon.en > 0);
      assert.equal(G.canUse({ hp: 1, en: weapon.en - 1 }, weapon), false);
      assert.equal(G.canUse({ hp: 1, en: weapon.en }, weapon), true);
    }
  const { g, a, b, w } = duel();
  a.en = 9;
  assert.throws(() => G.fight(g, a, b, w, "defend"));
  assert.equal(a.en, 9);
  a.en = 10;
  G.fight(g, a, b, w, "defend");
  assert.equal(a.en, 0);
  assert.ok(G.deploymentCells(G.create(), 0).some((c) => c.x === 6 && c.y === 8));
});
test("shooting/melee and beam/shell bonuses multiply the right components before protection", () => {
  const { g, a, b, w } = duel(),
    bonuses = G.models[a.model].attackBonuses,
    before = { ...bonuses };
  try {
    Object.assign(bonuses, { shooting: 20, melee: 20, beam: 10, shell: 10 });
    assert.equal(G.estimate(g, a, b, w).damage, 7146);
    const beam = G.models.RGM_79__beam_spray.weapons[0],
      saber = G.models.RGM_79__machine_gun.weapons[1];
    assert.equal(G.estimate(g, a, b, beam).damage, 6270);
    assert.equal(G.estimate(g, a, b, saber).damage, 11300);
  } finally {
    Object.assign(bonuses, before);
  }
});
