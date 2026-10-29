const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
function scenario(config, check) {
  const entries = [
    [{ unitId: "RGM_79", kitId: "beam_spray" }],
    [{ unitId: "RGM_79", kitId: "machine_gun" }],
  ];
  const g = G.create(false, 9, entries),
    [a, b] = g.units,
    originals = [G.models[a.model], G.models[b.model]];
  try {
    G.models[a.model] = structuredClone(originals[0]);
    G.models[b.model] = structuredClone(originals[1]);
    G.models[a.model].attackBonuses = { shooting: 0, melee: 0, beam: 0, shell: 0 };
    const model = G.models[b.model];
    model.mobility = 80;
    for (const defense of [model.defenses, model.shield.defenses])
      for (const key of Object.keys(defense)) defense[key] = { flat: 0, percent: 0 };
    Object.assign(model.defenses, config.body || {});
    Object.assign(model.shield.defenses, config.shieldDefense || {});
    Object.assign(model.shield, { coverage: config.coverage ?? 0.5, blockChance: 1 });
    const neutral = {
      shooting: 100,
      melee: 100,
      defense: 100,
      speed: 100,
      accuracy: 100,
      reaction: 100,
      leadership: 100,
      awakening: 0,
    };
    a.pilot = { stats: { ...neutral } };
    b.pilot = { stats: { ...neutral } };
    Object.assign(a, { x: 2, y: 3 });
    Object.assign(b, { x: 4, y: 3, hp: 100000, shield: config.shield ?? 5000 });
    g.tiles[3][2] = g.tiles[3][4] = "plain";
    const w = {
      ...G.models[a.model].weapons[0],
      hit: 100,
      antiSize: { small: { damage: 1, accuracy: 1 } },
      damagePerShot: 6000,
      damageComponents: config.components || { beam: 6000 },
      shotCount: config.shots ?? 1,
    };
    w.attack = {
      ...w.attack,
      strikes: Array.from({ length: w.shotCount }, (_, i) => ({
        at: i * 0.4,
        shotIndex: i,
        hitIndex: 0,
        damageMultiplier: config.multipliers?.[i] ?? 1,
      })),
    };
    const stance = config.stance || "counter",
      before = JSON.stringify(g),
      estimate = G.estimate(g, a, b, w, stance);
    assert.equal(JSON.stringify(g), before, "forecast must not modify the match");
    const event = G.fight(g, a, b, w, stance, null, false)[0];
    check({ g, a, b, w, estimate, event });
  } finally {
    [G.models[a.model], G.models[b.model]] = originals;
  }
}

test("6000 raw beam damage and 50 percent coverage split into 3000 shield and 3000 hull", () => {
  scenario({}, ({ b, estimate, event }) => {
    assert.equal(estimate.damage, 6000);
    assert.equal(estimate.shieldDamage, 3000);
    assert.equal(estimate.blockedDamage, 3000);
    assert.equal(event.shieldDamage, 3000);
    assert.equal(event.damage, 3000);
    assert.equal(b.shield, 2000);
    assert.equal(b.hp, 97000);
  });
});
test("hull flat and percentage defense apply to the remainder, separately for every damage channel", () => {
  scenario(
    {
      components: { beam: 4000, shell: 2000 },
      body: { beam: { flat: 500, percent: 20 }, shell: { flat: 0, percent: 50 } },
    },
    ({ estimate, event }) => {
      assert.equal(estimate.damage, 3800);
      assert.equal(estimate.shieldDamage, 3000);
      assert.equal(estimate.blockedDamage, 1700);
      assert.equal(event.damage, 1700);
      assert.notEqual(event.damage, estimate.damage - event.shieldDamage);
    },
  );
  scenario({ body: { beam: { flat: 500, percent: 20 } }, stance: "defend" }, ({ event }) => {
    assert.equal(event.damage, G.roundDamage((3000 - 625) * 0.75 * 0.75));
  });
});
test("insufficient shield durability spills the unabsorbed raw damage back before hull defense", () => {
  scenario(
    { shield: 1000, body: { beam: { flat: 500, percent: 20 } } },
    ({ estimate, event, b }) => {
      assert.equal(event.shieldDamage, 1000);
      assert.equal(b.shield, 0);
      assert.equal(estimate.blockedDamage, 3600);
      assert.equal(event.damage, 3600);
    },
  );
});
test("shield defenses reduce durability loss, without reducing the coverage fraction blocked", () => {
  scenario({ shieldDefense: { beam: { flat: 500, percent: 50 } } }, ({ estimate, event }) => {
    assert.equal(event.shieldDamage, 1250);
    assert.equal(estimate.blockedDamage, 3000);
    assert.equal(event.damage, 3000);
  });
  scenario(
    { shield: 625, shieldDefense: { beam: { flat: 500, percent: 50 } } },
    ({ estimate, event, b }) => {
      assert.equal(event.shieldDamage, 625);
      assert.equal(b.shield, 0);
      assert.equal(estimate.blockedDamage, 4500);
      assert.equal(event.damage, 4500);
    },
  );
  scenario({ shieldDefense: { beam: { flat: 5000, percent: 0 } } }, ({ event, b }) => {
    assert.equal(event.shieldDamage, 0);
    assert.equal(event.damage, 3000);
    assert.equal(b.shield, 5000);
  });
});
test("zero/full coverage and already broken shields preserve their boundary behavior", () => {
  for (const [coverage, shield, shieldDamage, damage] of [
    [0, 5000, 0, 6000],
    [1, 10000, 6000, 0],
    [1, 0, 0, 6000],
  ])
    scenario({ coverage, shield }, ({ estimate, event }) => {
      assert.equal(estimate.shieldDamage, shieldDamage);
      assert.equal(event.shieldDamage, shieldDamage);
      assert.equal(event.damage, damage);
    });
});
test("volley forecasts and actual per-shot blocks both deplete shields in firing order", () => {
  scenario({ shots: 3 }, ({ estimate, event, b }) => {
    assert.equal(estimate.shieldDamage, 5000);
    assert.equal(estimate.blockedDamage, 13000);
    assert.deepEqual(
      event.strikes.map((s) => s.damage),
      [3000, 4000, 6000],
    );
    assert.deepEqual(
      event.strikes.map((s) => s.shieldDamage),
      [3000, 2000, 0],
    );
    assert.deepEqual(
      event.strikes.map((s) => s.blocked),
      [true, true, false],
    );
    assert.equal(event.damage, 13000);
    assert.equal(b.shield, 0);
  });
  scenario({ shots: 2, multipliers: [1, 0.5] }, ({ estimate, event }) => {
    assert.equal(estimate.shieldDamage, 4500);
    assert.equal(estimate.blockedDamage, 4500);
    assert.equal(event.damage, 4500);
  });
});

test("defense final resistance reduces both hull and shield damage after coverage splitting", () => {
  scenario({ stance: "defend" }, ({ estimate, event }) => {
    assert.equal(estimate.damage, 4500);
    assert.equal(estimate.shieldDamage, 2250);
    assert.equal(estimate.blockedDamage, 2250);
    assert.equal(event.damage, 2250);
    assert.equal(event.shieldDamage, 2250);
  });
});
