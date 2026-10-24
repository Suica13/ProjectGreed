const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Sequence = require("../shared/weapon-sequence.js");
const entry = { unitId: "RGM_79", kitId: "machine_gun" };
function duel() {
  const g = G.create(false, 1, [[entry, entry, entry], [entry]]),
    a = g.units[0],
    b = g.units[3];
  Object.assign(a, { x: 2, y: 3, hp: 100000, shield: 0 });
  Object.assign(b, { x: 4, y: 3, hp: 100000, shield: 0 });
  return { g, a, b, w: G.models[a.model].weapons[0] };
}
test("only the latest successful move is undoable, and an occupied origin never accepts undo", () => {
  const { g, a } = duel(),
    other = g.units[1];
  Object.assign(other, { x: 2, y: 5 });
  G.move(g, a, 3, 3);
  assert.equal(G.canUndo(g, a), true);
  assert.throws(() => G.move(g, other, 3, 3));
  assert.equal(G.canUndo(g, a), true, "invalid moves do not commit previous movement");
  G.move(g, other, 2, 3);
  assert.equal(G.canUndo(g, a), false);
  assert.throws(() => G.undo(g, a));
  assert.equal(G.canUndo(g, other), true);
  G.undo(g, other);
  assert.equal(
    G.canUndo(g, a),
    false,
    "undoing the latest move does not revive earlier undo rights",
  );
  const occupied = duel();
  G.move(occupied.g, occupied.a, 3, 3);
  Object.assign(occupied.g.units[1], { x: 2, y: 3 });
  assert.throws(() => G.undo(occupied.g, occupied.a));
  assert.equal(occupied.a.x, 3);
});
test("defense multiplies defenses, raises block chance and reduces final damage by 25 percent without changing stored attributes", () => {
  const { g, a, b, w } = duel(),
    model = G.models[b.model],
    before = JSON.stringify(model);
  const normal = G.estimate(g, a, b, w),
    defended = G.estimate(g, a, b, w, "defend");
  assert.equal(normal.damage, 9 * Math.round((725 * 1.1 - 75) * 0.9));
  assert.equal(defended.damage, 9 * Math.round((725 * 1.1 - 75 * 1.25) * 0.875 * 0.75));
  assert.notEqual(defended.damage, Math.round(normal.damage * 0.5));
  assert.equal(defended.blockChance, 0);
  b.shield = model.shield.hp;
  assert.equal(G.estimate(g, a, b, w, "defend").blockChance, model.shield.blockChance + 0.25);
  assert.equal(JSON.stringify(model), before);
});
test("evade multiplies mobility and adds 15 percentage points of final evasion", () => {
  for (const id of ["RGM_79__machine_gun", "RGC_80__machine_gun", "RGM_79L__machine_gun"]) {
    const { g, a, b, w } = duel();
    b.model = id;
    const weapon = { ...w, hit: 60 };
    const base = G.estimate(g, a, b, weapon),
      evade = G.estimate(g, a, b, weapon, "evade");
    assert.equal(base.hit - evade.hit, G.models[id].mobility * 0.25 * 0.25 + 15);
    assert.equal(base.damage, evade.damage);
  }
});
test("a volley consumes one counter, exhausted counters reject atomically, handoffs reset counters", () => {
  const { g, b, w } = duel(),
    attackers = g.units.filter((u) => u.team === 0);
  b.en = 1000;
  for (let i = 0; i < 1; i++) {
    const a = attackers[i];
    Object.assign(a, { x: 2, y: 3, hp: 100000, shield: 0 });
    G.fight(g, a, b, w, "counter", w.id);
    assert.equal(b.counterCount, i + 1);
  }
  const a = attackers[2];
  Object.assign(a, { x: 2, y: 3, hp: 100000, shield: 0 });
  assert.equal(G.canCounter(g, b, a, w), false);
  assert.notEqual(G.bestResponse(g, a, b, w).response, "counter");
  const before = JSON.stringify(g);
  assert.throws(() => G.fight(g, a, b, w, "counter", w.id));
  assert.equal(JSON.stringify(g), before);
  G.fight(g, a, b, w, "defend");
  G.end(g);
  assert.equal(G.countersRemaining(b), 1);
});
test("V04 weapons, bonuses, HP, shield and Step multipliers match the editable configuration", () => {
  const gm = G.models.RGM_79__beam_spray,
    light = G.models.RGM_79L__beam_gun,
    cannon = G.models.RGC_80__machine_gun;
  assert.deepEqual([gm.hp, cannon.hp, light.hp], [16500, 18500, 15500]);
  assert.deepEqual([gm.shield.hp, cannon.shield.hp, light.shield.hp], [2000, 2000, 1625]);
  assert.deepEqual(
    [
      gm.attackBonuses.shooting,
      gm.attackBonuses.melee,
      cannon.attackBonuses.shooting,
      light.attackBonuses.melee,
    ],
    [10, 10, 15, 15],
  );
  assert.ok(
    light.weapons.some(
      (w) => w.id === "Common_DoubleVulcan_MS" && w.clip === null && !w.changeHeldWeapon,
    ),
  );
  assert.equal(gm.weapons[0].damage, 10000);
  const rocket = G.models.RGM_79__bazooka.weapons[0];
  assert.equal(rocket.damagePerShot, 5000);
  assert.equal(rocket.damage, 10000);
  assert.deepEqual(rocket.attack.shots, [0.35, 0.75]);
  for (const model of Object.values(G.models).filter((m) =>
    ["RGM_79", "RGC_80", "RGM_79L"].includes(m.prefabId),
  ))
    for (const w of model.weapons) {
      assert.equal(
        w.hit,
        w.type === "melee"
          ? 95
          : {
              EF_90mmMG: 90,
              EF_BeamSprayGun: 90,
              EF_HypeBazooka: 70,
              Common_Cannon: 75,
              Common_DoubleVulcan_MS: 95,
              EF_BOWA_BeamGun: 90,
            }[w.id],
      );
      if (w.type === "melee" && w.shotCount > 1) {
        assert.deepEqual(
          w.attack.strikes.map((s) => s.damageMultiplier),
          [1, 0.5],
        );
        assert.equal(w.damage, w.damagePerShot * 1.5);
      }
    }
  assert.throws(() =>
    Sequence.compile({
      ...rocket,
      attack: { steps: [{ delay: 0, shots: 1, damageMultiplier: -1 }] },
    }),
  );
});
test("actual melee and its forecast both apply the reduced second strike before armor", () => {
  const { g, a, b } = duel();
  b.x = 3;
  g.seed = 1;
  const w = G.models[a.model].weapons.find((w) => w.type === "melee");
  const old = G.models[b.model].defenses;
  try {
    G.models[b.model].defenses = Object.fromEntries(
      Object.keys(old).map((k) => [k, { flat: 0, percent: 0 }]),
    );
    const estimate = G.estimate(g, a, b, w),
      event = G.fight(g, a, b, w, "counter", w.id)[0];
    assert.equal(estimate.damage, 8250);
    assert.deepEqual(
      event.strikes.map((s) => s.damage),
      [5500, 2750],
    );
    assert.equal(event.damage, estimate.damage);
  } finally {
    G.models[b.model].defenses = old;
  }
});

test("map facing persists after combat and turns; movement updates its last path direction and undo restores it", () => {
  const { g, a, b, w } = duel();
  a.angle = 0;
  b.angle = 0;
  G.fight(g, a, b, w, "defend");
  assert.equal(a.angle, 90);
  assert.equal(b.angle, -90);
  G.end(g);
  G.end(g);
  assert.equal(a.angle, 90);
  assert.equal(b.angle, -90);
  const path = G.move(g, a, 2, 4);
  const from = path.length > 1 ? path.at(-2) : { x: 2, y: 3 };
  assert.equal(a.angle, (Math.atan2(2 - from.x, -(4 - from.y)) * 180) / Math.PI);
  G.undo(g, a);
  assert.equal(a.angle, 90);
  assert.equal(a.x, 2);
  assert.equal(a.y, 3);
  // A later incoming attack replaces the old facing, even if every projectile misses.
  a.hp = b.hp = 100000;
  Object.assign(b, { x: 2, y: 5, team: 1, acted: false, en: 1000 });
  g.team = 1;
  G.fight(g, b, a, G.models[b.model].weapons[0], "evade");
  assert.equal(a.angle, 180);
  assert.equal(b.angle, 0);
  const saved = JSON.parse(JSON.stringify(g));
  assert.deepEqual(
    saved.units.map((u) => u.angle),
    g.units.map((u) => u.angle),
  );
});

test("final evasion applies after counter accuracy and never produces negative hit probability", () => {
  const { g, a, b, w } = duel();
  const evade = G.estimate(g, a, b, w, "evade"),
    counterEvade = G.estimate(g, a, b, w, "evade", true);
  assert.equal(counterEvade.hit, (evade.hit + 15) * 0.75 - 15);
  const impossible = G.estimate(g, a, b, { ...w, hit: 0 }, "evade");
  assert.equal(impossible.hit, 0);
  const event = G.fight(g, a, b, { ...w, hit: 0 }, "evade")[0];
  assert.ok(event.strikes.every((s) => !s.hit && s.hitChance === 0));
  assert.equal(event.damage, 0);
});
