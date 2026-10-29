const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../shared/pilots.js");
const fresh = () => P.createCustom("custom-rebalance", "测试驾驶员");

test("custom pilot baseline and training follow revised budget without changing caps or COST", () => {
  const p = fresh();
  assert.deepEqual(p.stats, {
    shooting: 100,
    melee: 100,
    defense: 100,
    speed: 100,
    accuracy: 100,
    reaction: 100,
    leadership: 80,
    awakening: 60,
  });
  assert.equal(p.level, 0);
  assert.equal(p.points, 80);
  const next = P.gainExperience(p, P.experienceRequired(0));
  assert.equal(next.level, 1);
  assert.equal(next.points, 120);
  assert.equal(P.cost(p), 0);
  assert.equal(P.cost(next), 25);
  assert.equal(P.statCap(0), 125);
  assert.equal(P.statCap(10), 200);
  assert.equal(P.growthRules.maxLevel, 10);
  assert.equal(P.custom({ ...p, level: 10 }).points, 480);
});

test("previous custom growth migrates safely, refunds training and preserves progression and records", () => {
  const old = {
    ...fresh(),
    trainingVersion: 4,
    level: 10,
    experience: 0,
    stats: {
      shooting: 200,
      melee: 90,
      defense: 90,
      speed: 90,
      accuracy: 90,
      reaction: 90,
      leadership: 70,
      awakening: 50,
    },
    record: { kills: 4, shipKills: 1, battles: 2, losses: 1, destroyedCost: 500, lostCost: 100 },
  };
  const migrated = P.custom(old);
  assert.deepEqual(migrated.stats, P.baseStats());
  assert.equal(migrated.level, 10);
  assert.equal(migrated.points, 480);
  assert.deepEqual(migrated.record, old.record);
  assert.deepEqual(P.custom(migrated), migrated);
  const progressing = P.custom({
    ...old,
    level: 3,
    experience: 321,
    stats: { ...old.stats, shooting: 145 },
  });
  assert.equal(progressing.experience, 321);
  assert.equal(progressing.points, 200);
});

test("training spending, reset and level cap retain current validation", () => {
  let p = fresh();
  p.stats.shooting += 25;
  p.stats.melee += 25;
  p.stats.leadership += 30;
  assert.equal(P.custom(p).points, 0);
  assert.equal(P.refundTraining(p).points, 80);
  p.stats.awakening++;
  assert.throws(() => P.custom(p), /强化点/);
  const capped = P.custom({ ...fresh(), level: 10 });
  assert.equal(P.gainExperience(capped, 100000).level, 10);
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("all stat scaling gains are halved around 100, with awakening bonus halved", () => {
  const unit = (patch) => ({ pilot: { stats: { ...P.baseStats(), awakening: 60, ...patch } } });
  const base = P.modifiers(unit({}));
  for (const [stat, field] of [
    ["shooting", "shooting"],
    ["melee", "melee"],
    ["accuracy", "accuracy"],
    ["reaction", "reaction"],
  ]) {
    near(P.modifiers(unit({ [stat]: 110 }))[field], 1.025);
    near(P.modifiers(unit({ [stat]: 200 }))[field], 1.25);
    near(P.modifiers(unit({ [stat]: 90 }))[field], 0.975);
  }
  near(base.shooting, 1);
  near(P.modifiers(unit({ defense: 110 })).defense, 0.975);
  near(P.modifiers(unit({ defense: 200 })).defense, 0.75);
  near(P.modifiers(unit({ speed: 110 })).reaction, 1);
  near(P.modifiers(unit({ awakening: 100 })).shooting, 1.075);
  near(P.modifiers(unit({ awakening: 100 })).melee, 1.075);
});
test("leadership retains range steps and base effect while halving effect growth", () => {
  const G = require("../shared/rules.js");
  const model = Object.values(G.models).find((m) => m.commandAuras?.length);
  const u = { model: model.prefabId + "__" + model.kitId, pilot: { stats: P.baseStats() } };
  for (const [leadership, radius, effect] of [
    [75, 2, 0.09],
    [100, 3, 0.1],
    [125, 4, 0.11],
    [150, 5, 0.12],
    [200, 7, 0.14],
  ]) {
    u.pilot.stats.leadership = leadership;
    const aura = G.commandAura(u);
    assert.equal(aura.radius, radius);
    near(aura.effect, effect);
  }
});

test("version five custom pilots refund valid training at their preserved level exactly once", () => {
  const old = {
    ...fresh(),
    trainingVersion: 5,
    level: 2,
    experience: 1999,
    stats: { ...P.baseStats(), shooting: 135, melee: 135, leadership: 90 },
  };
  const migrated = P.custom(old);
  assert.equal(migrated.level, 2);
  assert.equal(migrated.experience, 1999);
  assert.equal(migrated.points, 160);
  assert.deepEqual(migrated.stats, P.baseStats());
  assert.deepEqual(P.custom(migrated), migrated);
  assert.throws(() => P.custom({ ...old, experience: 2000 }), /经验/);
  assert.throws(() => P.custom({ ...old, level: 0 }), /等级/);
});
test("custom pilots require ten upgrades from zero, keep XP overflow policy and reject invalid levels", () => {
  let pilot = fresh();
  for (let level = 0; level < 10; level++) {
    assert.equal(P.experienceRequired(level), 1000 * 2 ** level);
    pilot = P.gainExperience(pilot, P.experienceRequired(level) + 123);
    assert.equal(pilot.level, level + 1);
    assert.equal(pilot.experience, 0);
    assert.equal(pilot.points, 80 + 40 * (level + 1));
  }
  assert.equal(P.gainExperience(pilot, 9999999).level, 10);
  assert.equal(P.cost(pilot), 250);
  assert.throws(() => P.custom({ ...fresh(), level: -1 }), /等级/);
  assert.throws(() => P.custom({ ...fresh(), level: 11 }), /等级/);
});
