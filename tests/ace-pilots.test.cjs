const test = require("node:test"),
  assert = require("node:assert/strict");
const P = require("../shared/pilots.js"),
  G = require("../shared/rules.js");
const source = P.catalog.aces.find((p) => p.id.endsWith("_CHA"));
const entry = (pilot) => ({ unitId: "RGM_79", kitId: "machine_gun", customPilot: pilot });
test("ACE import preserves native prices, three upgrades, independent maxima and inactive skill placeholders", () => {
  assert.equal(P.catalog.aces.length, 40);
  assert.equal(P.catalog.aces.filter((p) => p.price).length, 35);
  for (const profile of P.catalog.aces) {
    assert.equal(profile.initialLevel, 0);
    assert.equal(profile.maxLevel, 3);
    assert(profile.comprehension >= 100);
    assert(profile.skills.length);
    assert(profile.skills.every((s) => s.implemented === false && s.name && s.icon));
    if (profile.price) {
      const cheapest = [...profile.sourceOffers].sort(
        (a, b) =>
          a.money + a.supplies - b.money - b.supplies ||
          a.money - b.money ||
          a.supplies - b.supplies,
      )[0];
      assert.deepEqual(profile.price, { money: cheapest.money, supplies: cheapest.supplies });
    } else assert.throws(() => P.createAce(profile.id));
    for (const key of Object.keys(P.labels))
      assert.equal(
        profile.maxStats[key],
        profile.baseStats[key] * (profile.comprehension / 100) ** 3,
      );
  }
});
test("ACE comprehension compounds without manual points, preserves XP overflow and stops at native level three", () => {
  let p = P.createAce(source.id);
  assert.equal(P.cost(p), 0);
  assert.equal(p.level, 0);
  assert.equal(p.points, 0);
  const need = P.experienceRequired(0, p);
  p = P.gainExperience(p, need + 23);
  assert.equal(p.level, 1);
  assert.equal(p.experience, 23);
  assert.equal(P.cost(p), 50);
  assert(Math.abs(p.stats.melee - (source.baseStats.melee * source.comprehension) / 100) < 1e-9);
  p = P.gainExperience(p, 1000000);
  assert.equal(p.level, 3);
  assert.equal(p.experience, 0);
  assert.equal(P.cost(p), 150);
  for (const key of Object.keys(P.labels))
    assert(Math.abs(p.stats[key] - source.maxStats[key]) < 1e-9);
  assert(p.stats.melee > 200);
  assert.deepEqual(P.gainExperience(p, 1000), p);
  assert.throws(() => P.refundTraining(p));
  const forged = structuredClone(p);
  forged.stats.shooting++;
  assert.throws(() => P.custom(forged));
  assert.throws(() => P.custom({ ...p, level: 4 }));
  assert.throws(() => P.custom({ ...p, id: "custom-clone" }));
});
test("ACE deploys with fixed grown stats, costs 50 per level and cannot bypass duplicate or bare-ID checks", () => {
  const pilot = P.gainExperience(P.createAce(source.id), source.experienceBase);
  const base = G.models.RGM_79__machine_gun.cost;
  assert.equal(G.validateFormation([entry(pilot)], base + 50)[0].customPilot.level, 1);
  assert.throws(() => G.validateFormation([entry(pilot)], base + 49));
  assert.throws(() => G.validateFormation([entry(pilot), entry(pilot)], Infinity));
  assert.throws(() =>
    G.validateFormation([{ unitId: "RGM_79", kitId: "machine_gun", pilotId: source.id }], Infinity),
  );
  const game = G.create(false, 1, [[entry(pilot)], [{ unitId: "RGM_79", kitId: "machine_gun" }]]);
  assert.deepEqual(game.units[0].pilot.stats, pilot.stats);
  assert.equal(game.units[0].pilot.ace, true);
  assert.equal(P.portrait(pilot), source.icon);
});
test("ACE awards share deduplication and records, losses do not remove XP, and custom pilots retain their growth", () => {
  const store = { pilots: [P.createAce(source.id)], awards: [] };
  const award = {
    id: "ace-award",
    pilotId: store.pilots[0].id,
    kind: "assist",
    points: 100,
    experiencePoints: source.experienceBase,
  };
  assert(P.creditAwards(store, [award]));
  assert.equal(store.pilots[0].level, 1);
  assert.equal(P.creditAwards(store, [award]), false);
  const p = P.battleResult(store.pilots[0], "loss", 500);
  assert.equal(p.level, 1);
  assert.equal(p.record.lostCost, 500);
  const custom = P.createCustom("custom-still-normal", "Test", P.catalog.portraits[0].id);
  assert.equal(custom.level, 1);
  assert.equal(custom.points, 60);
  assert.equal(P.cost(custom), 25);
});

test("destroyed ACE keeps career progress but must be re-recruited before deployment", () => {
  const before = P.gainExperience(P.createAce(source.id), source.experienceBase + 117);
  const lost = P.battleResult(before, "loss", 500);
  assert.equal(lost.needsRecruitment, true);
  assert.equal(lost.level, before.level);
  assert.equal(lost.experience, 117);
  assert.equal(P.cost(lost), 0);
  assert.throws(() => G.validateFormation([entry(lost)], Infinity));
  const restored = P.recruitAce(source.id, lost);
  assert.equal(restored.needsRecruitment, false);
  assert.equal(restored.experience, 117);
  assert.equal(restored.record.losses, 1);
  assert.equal(P.cost(restored), 50);
  assert.throws(() => P.recruitAce(source.id, restored));
  const store = { pilots: [before], awards: [] },
    award = {
      id: "loss-once",
      pilotId: before.id,
      kind: "loss",
      points: 500,
      experiencePoints: 0,
      requiresRecruitment: true,
    };
  assert(P.creditAwards(store, [award]));
  assert.equal(store.pilots[0].needsRecruitment, true);
  assert.equal(P.creditAwards(store, [award]), false);
  const lockedIdentity = P.custom({
    ...restored,
    name: "Fake",
    portraitId: P.catalog.portraits[0].id,
    uploadedPortrait: "bad",
  });
  assert.equal(lockedIdentity.name, source.name);
  assert.equal(P.portrait(lockedIdentity), source.icon);
});
