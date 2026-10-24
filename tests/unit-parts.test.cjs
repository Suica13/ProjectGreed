const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Parts = require("../shared/unit-parts.js");
function pair() {
  const g = G.create(false, 1, [
    [{ unitId: "RGM_79", kitId: "beam_spray" }],
    [{ unitId: "RGM_79", kitId: "machine_gun" }],
  ]);
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 4 });
  Object.assign(b, { x: 4, y: 4, shield: 0 });
  g.tiles[4][2] = g.tiles[4][3] = g.tiles[4][4] = "plain";
  return { g, a, b, w: G.modelOf(a).weapons[0] };
}
function seedFor(unit, model, damage, modifier, part) {
  for (let seed = 0; seed < 100000; seed++) {
    const g = { partSeed: seed },
      clone = structuredClone(unit);
    if (Parts.applyHit(g, clone, model, damage, modifier) === part) return seed;
  }
  throw Error("no seed for " + part);
}

test("terrain penalizes hit chance by attack category and no longer reduces raw damage", () => {
  const { g, a, b, w } = pair();
  b.hp = 100000;
  const melee = G.modelOf(a).weapons.find((w) => w.type === "melee");
  for (const [weapon, forest, rubble] of [
    [w, 10, 25],
    [melee, 10, 0],
  ]) {
    const plain = G.estimate(g, a, b, weapon);
    g.tiles[b.y][b.x] = "forest";
    const woods = G.estimate(g, a, b, weapon);
    g.tiles[b.y][b.x] = "rubble";
    const ruins = G.estimate(g, a, b, weapon);
    assert.equal(plain.hit - woods.hit, forest);
    assert.equal(plain.hit - ruins.hit, rubble);
    assert.equal(woods.damage, plain.damage);
    assert.equal(ruins.damage, plain.damage);
    g.tiles[b.y][b.x] = "plain";
  }
});

test("current weapon tuning preserves single-shot Panzerfaust and uses twelve independent high-tier MG rounds", () => {
  const pf = G.models.MS_06F2__machine_gun.weapons.find((w) => w.id === "ZN_Panzerfaust");
  assert.equal(pf.damagePerShot, 6562.5);
  assert.equal(pf.shotCount, 1);
  for (const [model, id, perShot] of [
    ["MS_14A__machine_gun", "ZN_MMP80MG", 935],
    ["RX_79_G__machine_gun", "EF_100mmMG", 990],
  ]) {
    const w = G.models[model].weapons.find((w) => w.id === id);
    assert.equal(w.shotCount, 12);
    assert.equal(w.attack.strikes.length, 12);
    assert.equal(w.damagePerShot, perShot);
    assert.equal(w.damage, 12 * perShot);
  }
  for (const model of ["MS_14A__beam_rifle", "RX_79_G__beam_rifle"])
    assert.equal(G.models[model].weapons[0].damagePerShot, 6160);
  assert.equal(
    G.models.RGM_79_G__beam_rifle.weapons[0].damagePerShot,
    5600,
    "only the two named units receive the beam buff",
  );
});

test("all native structural strengths, special weapon dependencies and per-strike coefficients are present", () => {
  const strengths = {
    MS_06F: 110,
    MS_06F2: 120,
    MS_06J: 115,
    MS_06K: 110,
    MS_09: 110,
    MS_14A: 125,
    RGC_80: 115,
    RGM_79: 120,
    RGM_79L: 100,
    RGM_79_G: 120,
    RX_79_G: 125,
  };
  for (const model of Object.values(G.models)) {
    assert.equal(model.partStructuralStrength, strengths[model.prefabId]);
    for (const w of model.weapons) assert.ok(Number.isFinite(w.partBreakModifier));
  }
  assert.equal(
    G.models.RGC_80__beam_spray.weapons.find((w) => w.id === "Common_Cannon").partBreakModifier,
    0.5,
  );
  const saber = G.models.RGM_79L__beam_gun.weapons.find((w) => w.id === "EF_BeamSaber_BF");
  assert.deepEqual(
    saber.attack.strikes.map((s) => s.partBreakModifier),
    [0.75, 1.25],
  );
});

test("native break probability uses actual hull damage, post-hit HP, modifier and structural strength", () => {
  const model = { hp: 20000, partStructuralStrength: 120 };
  const unit = { hp: 10000 };
  const expected = 1 - 6 / (101 * (4000 / 20000) * 2 * 0.5 * 1.25);
  assert.ok(Math.abs(Parts.chance(unit, model, 4000, 1.25) - expected) < 1e-12);
  assert.ok(Parts.chance({ hp: 5000 }, model, 4000, 1.25) > expected);
  assert.ok(Parts.chance(unit, model, 8000, 1.25) > expected);
  assert.ok(Parts.chance(unit, model, 4000, 1.5) > expected);
  assert.ok(Parts.chance(unit, { ...model, partStructuralStrength: 200 }, 4000, 1.25) < expected);
  assert.equal(Parts.chance(unit, model, 0, 1), 0);
  assert.equal(Parts.chance({ hp: 0 }, model, 4000, 1), 0);
});

test("each native part can break, already broken parts do not reroll and arm damage removes the shield", () => {
  const { b } = pair(),
    model = G.modelOf(b);
  b.hp = 4000;
  b.shield = model.shield.hp;
  for (const part of Object.keys(Parts.names)) {
    const seed = seedFor(b, model, 5000, 1.25, part),
      unit = structuredClone(b);
    const game = { partSeed: seed };
    assert.equal(Parts.applyHit(game, unit, model, 5000, 1.25), part);
    assert.equal(unit.brokenParts[part], true);
    if (part === "leftArm") assert.equal(unit.shield, 0);
    game.partSeed = seed;
    assert.equal(Parts.applyHit(game, unit, model, 5000, 1.25), null);
    assert.deepEqual(Object.keys(unit.brokenParts), [part]);
  }
});

test("broken parts disable their weapons, either leg/arm can retain a paired weapon, and a chest vulcan survives head loss", () => {
  const { a } = pair();
  a.brokenParts = { rightArm: true };
  for (const w of G.modelOf(a).weapons)
    assert.equal(G.canUse(a, w), ["Common_DoubleVulcan_MS", "Common_Push_A"].includes(w.id));
  a.brokenParts.head = true;
  assert.equal(
    G.canUse(
      a,
      G.modelOf(a).weapons.find((w) => w.id === "Common_DoubleVulcan_MS"),
    ),
    false,
  );
  const leg = { ...a, model: "MS_06J__machine_gun", brokenParts: { leftLeg: true } },
    missile = G.modelOf(leg).weapons.find((w) => w.id === "ZN_MS_06J_LegMS");
  assert.equal(G.canUse(leg, missile), true);
  leg.brokenParts.rightLeg = true;
  assert.equal(G.canUse(leg, missile), false);
  const gun = { ...a, model: "MS_06K__big_gun", brokenParts: { rightArm: true } },
    big = G.modelOf(gun).weapons.find((w) => w.id === "ZN_MS_06K_BigGun");
  assert.equal(G.canUse(gun, big), true);
  gun.brokenParts.leftArm = true;
  assert.equal(G.canUse(gun, big), false);
  const chest = { ...a, model: "RX_79_G__machine_gun", brokenParts: { head: true } },
    vulcan = G.modelOf(chest).weapons.find((w) => w.id === "Common_SingleVulcan_RX_79_G");
  assert.equal(G.canUse(chest, vulcan), true);
});

test("an arm destroyed by the incoming volley cancels its selected counter without spending counter EN", () => {
  const { g, a, b, w } = pair();
  b.hp = 7000;
  const shot = {
    ...w,
    hit: 100,
    damagePerShot: 3000,
    damageComponents: { beam: 3000 },
    shotCount: 1,
    attack: { ...w.attack, strikes: [w.attack.strikes[0]] },
  };
  const damage = G.estimate(g, a, b, shot).damage,
    post = { ...b, hp: b.hp - damage };
  g.partSeed = seedFor(
    post,
    G.modelOf(b),
    damage,
    shot.attack.strikes[0].partBreakModifier,
    "rightArm",
  );
  const en = b.en,
    before = JSON.stringify(g);
  G.estimate(g, a, b, shot);
  assert.equal(JSON.stringify(g), before);
  const events = G.fight(g, a, b, shot, "counter", G.modelOf(b).weapons[0].id);
  assert.equal(events.length, 1);
  assert.ok(b.hp > 0);
  assert.equal(b.en, en);
  assert.equal(b.counterCount, 0);
  assert.deepEqual(events[0].brokenParts, ["rightArm"]);
  assert.equal(events[0].partsAfter.rightArm, true);
  assert.equal(events[0].partsBefore.rightArm, undefined);
  assert.equal(events[0].strikes[0].partsAfter.rightArm, true);
});

test("misses cannot break parts and structural rolls do not consume the hit random stream", () => {
  const { g, a, b, w } = pair();
  b.hp = 1000;
  const shot = { ...w, hit: 0, attack: { ...w.attack, strikes: [w.attack.strikes[0]] } };
  g.seed = 1; // first roll is above the 10 percent minimum
  const partSeed = g.partSeed;
  const result = G.fight(g, a, b, shot, "evade", null, false)[0];
  assert.equal(result.hit, false);
  assert.deepEqual(b.brokenParts, {});
  assert.equal(g.partSeed, partSeed);
});

test("paired guns and leg missiles lose only the destroyed side's shots and forecasts match that loss", () => {
  for (const [model, key, part] of [
    ["MS_06K__big_gun", "ZN_MS_06K_BigGun", "rightArm"],
    ["MS_06J__machine_gun", "ZN_MS_06J_LegMS", "leftLeg"],
  ]) {
    const { g, a, b } = pair();
    a.model = model;
    a.brokenParts = { [part]: true };
    b.hp = 100000;
    const w = G.modelOf(a).weapons.find((w) => w.id === key),
      live = G.availableStrikes(a, w);
    assert.equal(live.length, w.attack.strikes.length / 2);
    assert.equal(
      G.estimate(g, a, b, w).damage,
      G.estimate(g, { ...a, brokenParts: {} }, b, w).damage / 2,
    );
    const en = a.en,
      event = G.fight(g, a, b, w, "defend", null, false)[0];
    assert.equal(event.strikeCount, live.length);
    assert.equal(en - a.en, w.en, "partial volleys still cost one weapon activation");
    for (const strike of event.strikes)
      assert.equal(strike.executed, !strike.requiredParts.includes(part));
  }
});
