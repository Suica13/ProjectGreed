const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
function fixture(source = "RGM_79", target = "RX_78GP03D") {
  const entry = (id) => ({
    unitId: id,
    kitId: Object.values(G.models).find((m) => m.prefabId === id).kitId,
  });
  const g = G.create(false, 1, [[entry(source)], [entry(target)]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  const [a, b] = g.units;
  Object.assign(a, { x: 3, y: 8 });
  Object.assign(b, { x: 8, y: 8, shield: 0, hp: 1000000 });
  return { g, a, b };
}
function weapon(a, channel = "beam", count = 1) {
  const base = G.modelOf(a).weapons[0];
  return {
    ...base,
    type: channel.startsWith("melee") ? "melee" : "beam",
    min: 0,
    max: 30,
    en: 0,
    actionCost: 1,
    hitScale: 100,
    damageComponents: { [channel]: 10000 },
    shotCount: count,
    attack: {
      ...base.attack,
      strikes: Array.from({ length: count }, (_, i) => ({
        ...base.attack.strikes[0],
        at: i,
        shotIndex: i,
        damageMultiplier: 1,
        damageComponents: { [channel]: 10000 },
      })),
    },
  };
}

test("native smoke equipment uses two AP, 100 EN, fixed radius and three own-turn cooldown", () => {
  const ids = G.catalog.prefabs
    .filter((p) => p.skills.some((s) => s.type === "smoke"))
    .map((p) => p.id)
    .sort();
  assert.deepEqual(ids, ["Gunperry", "RMV_1", "YMT_05"]);
  const { g, a } = fixture("YMT_05", "RGM_79"),
    skill = G.unitSkills(a).find((s) => s.type === "smoke");
  a.en = 99;
  assert.equal(G.canUseSkill(g, a, skill.id), false);
  a.en = 100;
  const event = G.useSkill(g, a, skill.id, a.x, a.y);
  assert.equal(event.smoke, true);
  assert.equal(a.en, 0);
  assert.equal(a.actionPoints, 3);
  assert.equal(a.skillReadyRound[skill.id], g.round + 6);
  assert.equal(g.smokeFields[0].expiresRound, g.round + 2);
  const origin = { x: g.smokeFields[0].x, y: g.smokeFields[0].y };
  a.x += 8;
  assert.deepEqual({ x: g.smokeFields[0].x, y: g.smokeFields[0].y }, origin);
  G.end(g);
  assert.equal(g.smokeFields.length, 1);
  G.end(g);
  assert.equal(g.smokeFields.length, 0);
});

test("smoke protects all sides against ranged fire multiplicatively, without stacking, and never changes melee", () => {
  const { g, a, b } = fixture("RGM_79", "RGM_79"),
    w = weapon(a);
  w.hitScale = 1;
  const ranged = G.estimate(g, a, b, w).hit,
    melee = G.estimate(g, a, b, weapon(a, "meleeBeam")).hit;
  const field = { x: b.x, y: b.y, radius: 2, expiresRound: g.round + 2 };
  g.smokeFields = [field, field];
  assert.equal(G.estimate(g, a, b, w).hit, ranged * 0.75);
  assert.equal(G.estimate(g, a, b, weapon(a, "meleeBeam")).hit, melee);
  b.team = a.team;
  assert.ok(G.smokeAt(g, b));
  b.x += 3;
  assert.equal(G.smokeAt(g, b), false);
});

test("native I-field capacities and absorption split are preserved; forecasts never consume the field", () => {
  for (const [id, capacity] of [
    ["MA_08", 250000],
    ["AMX_002", 275000],
    ["RX_78GP03D", 250000],
  ])
    assert.equal(Object.values(G.models).find((m) => m.prefabId === id).iField.capacity, capacity);
  const { g, a, b } = fixture();
  const hp = G.iFieldHP(b);
  for (const [channel, factor] of [
    ["beam", 0.05],
    ["beamAP", 0.5],
    ["shell", 1],
    ["meleeBeam", 1],
  ]) {
    b.iFieldHp = 0;
    const full = G.estimate(g, a, b, weapon(a, channel)).damage;
    b.iFieldHp = hp;
    const e = G.estimate(g, a, b, weapon(a, channel));
    assert.ok(Math.abs(e.damage - full * factor) <= 1, channel);
    assert.equal(G.iFieldHP(b), hp);
    assert.equal(e.iFieldDamage > 0, channel === "beam" || channel === "beamAP");
  }
});

test("I-field depletes per actual hit, protects its final intercepted projectile, and then recharges once per own turn", () => {
  const { g, a, b } = fixture(),
    w = weapon(a, "beam", 2);
  b.iFieldHp = 1;
  const hits = G.fight(g, a, b, w, "counter", null, false)[0].strikes;
  assert.equal(hits[0].hit, true);
  assert.ok(hits[0].iFieldDamage > 1);
  assert.equal(hits[1].iFieldDamage, 0);
  assert.ok(hits[1].damage > hits[0].damage);
  const depleted = G.iFieldHP(b),
    field = G.modelOf(b).iField;
  assert.ok(depleted < 0);
  G.end(g);
  assert.equal(G.iFieldHP(b), Math.min(field.capacity, depleted + field.capacity * 0.1));
  const recovered = G.iFieldHP(b);
  G.end(g);
  assert.equal(G.iFieldHP(b), recovered);
  const missed = fixture();
  const miss = weapon(missed.a);
  miss.hitScale = 0.0000001;
  const before = G.iFieldHP(missed.b);
  G.fight(missed.g, missed.a, missed.b, miss, "counter", null, false);
  assert.equal(G.iFieldHP(missed.b), before);
});

test("irradiation uses the same I-field and Skiure requires a living SFS operator", () => {
  const { g, a, b } = fixture("RX_78_4_Bst"),
    skill = G.unitSkills(a).find((s) => s.type === "irradiation"),
    before = G.iFieldHP(b);
  const e = G.useSkill(g, a, skill.id, 4, 8);
  const h = e.hits.find((h) => h.unitId === b.id);
  assert.ok(h);
  if (h.hit) {
    assert.ok(h.iFieldDamage > 0);
    assert.equal(G.iFieldHP(b), before - h.iFieldDamage);
  }
  const skier = fixture("Skiure", "RGM_79"),
    beam = G.unitSkills(skier.a).find((s) => s.type === "irradiation");
  assert.ok(beam);
  assert.equal(beam.requiresSfsMS, true);
  assert.equal(G.canUseSkill(skier.g, skier.a, beam.id), false);
  const rider = {
    ...skier.b,
    id: "operator",
    team: skier.a.team,
    ownerSeat: 0,
    hp: 1000,
    embarked: { carrierId: skier.a.id, hangarId: "SFS01", exposed: true },
  };
  skier.g.units.push(rider);
  assert.equal(G.canUseSkill(skier.g, skier.a, beam.id), true);
});
