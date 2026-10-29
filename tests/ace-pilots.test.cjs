const test = require("node:test"),
  assert = require("node:assert/strict");
const P = require("../shared/pilots.js"),
  G = require("../shared/rules.js");
const source = P.catalog.aces.find((p) => p.id.endsWith("_CHA"));
const entry = (pilot) => ({ unitId: "RGM_79", kitId: "machine_gun", customPilot: pilot });
test("ACE import preserves native prices, five upgrades, independent maxima and active skills", () => {
  assert.equal(P.catalog.aces.length, 40);
  assert.equal(P.catalog.aces.filter((p) => p.price).length, 35);
  for (const profile of P.catalog.aces) {
    assert.equal(profile.initialLevel, 0);
    assert.equal(profile.maxLevel, 5);
    assert.equal(profile.costPerLevel, 25);
    assert(profile.comprehension >= 100);
    assert(profile.skills.length);
    assert(profile.skills.every((s) => s.implemented === true && s.name && s.icon));
    for (const skill of profile.skills) {
      if (skill.id === "Pilot_ExamPilot_Trigger") {
        assert.equal(skill.passive, true);
        assert.equal(skill.durationTurns, undefined);
        assert.equal(skill.cooldownTurns, undefined);
      } else {
        assert.equal(skill.durationTurns, 1);
        assert.equal(skill.cooldownTurns, 5);
        assert.equal(skill.cooldownStarts, "effect_end");
        assert.deepEqual(skill.nativeTiming, { durationSeconds: 15, cooldownSeconds: 90 });
      }
    }

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
        profile.baseStats[key] * (profile.comprehension / 100) ** profile.nativeGrowth.maxLevel,
      );
  }
});
test("ACE comprehension compounds without manual points, preserves XP overflow and stops at level five", () => {
  let p = P.createAce(source.id);
  assert.equal(P.cost(p), 250);
  assert.equal(p.level, 0);
  assert.equal(p.points, 0);
  const need = P.experienceRequired(0, p);
  p = P.gainExperience(p, need + 23);
  assert.equal(p.level, 1);
  assert.equal(p.experience, 23);
  assert.equal(P.cost(p), 275);
  assert(
    Math.abs(
      p.stats.melee -
        source.baseStats.melee *
          (source.maxStats.melee / source.baseStats.melee) ** (1 / source.maxLevel),
    ) < 1e-9,
  );
  p = P.gainExperience(p, 1000000);
  assert.equal(p.level, 5);
  assert.equal(p.experience, 0);
  assert.equal(P.cost(p), 375);
  for (const key of Object.keys(P.labels))
    assert(Math.abs(p.stats[key] - source.maxStats[key]) < 1e-9);
  assert(p.stats.melee > 200);
  assert.deepEqual(P.gainExperience(p, 1000), p);
  assert.throws(() => P.refundTraining(p));
  const forged = structuredClone(p);
  forged.stats.shooting++;
  assert.throws(() => P.custom(forged));
  assert.throws(() => P.custom({ ...p, level: 6 }));
  assert.throws(() => P.custom({ ...p, id: "custom-clone" }));
});
test("ACE deploys with fixed grown stats, costs 250 base plus 25 per level and cannot bypass duplicate or bare-ID checks", () => {
  const pilot = P.gainExperience(P.createAce(source.id), source.experienceBase);
  const base = G.models.RGM_79__machine_gun.cost;
  assert.equal(G.validateFormation([entry(pilot)], base + 275)[0].customPilot.level, 1);
  assert.throws(() => G.validateFormation([entry(pilot)], base + 274));
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
  assert.equal(custom.level, 0);
  assert.equal(custom.points, 80);
  assert.equal(P.cost(custom), 0);
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
  assert.equal(restored.experience, 0);
  assert.deepEqual(P.recruitmentPrice(source.id, lost), {
    money: Math.ceil(source.price.money / 2),
    supplies: Math.ceil(source.price.supplies / 2),
  });
  assert.equal(restored.record.losses, 1);
  assert.equal(P.cost(restored), 275);
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

test("ACE upgrade XP is twice the equivalent custom upgrade and all five steps preserve native stat caps", () => {
  for (const profile of P.catalog.aces.filter((profile) => profile.price)) {
    let pilot = P.createAce(profile.id);
    for (let level = 0; level < 5; level++) {
      const required = P.experienceRequired(level, pilot);
      assert.equal(required, 2 * P.experienceRequired(level));
      pilot = P.gainExperience(pilot, required);
      assert.equal(pilot.level, level + 1);
      assert.equal(P.cost(pilot), 250 + (level + 1) * 25);
      for (const key of Object.keys(P.labels)) assert(pilot.stats[key] <= profile.maxStats[key]);
    }
    assert.deepEqual(pilot.stats, profile.maxStats);
    assert.equal(pilot.experience, 0);
  }
});

test("legacy ACE saves migrate normalized growth, retain records and keep old maximum stats", () => {
  const legacy = {
    id: "ace-" + source.id,
    aceId: source.id,
    ace: true,
    custom: true,
    name: source.name,
    faction: source.faction,
    level: source.nativeGrowth.maxLevel,
    experience: 0,
    stats: { ...source.maxStats },
    record: { kills: 7, destroyedCost: 2000 },
    needsRecruitment: true,
  };
  const migrated = P.custom(legacy);
  assert.equal(migrated.level, 5);
  assert.equal(migrated.aceGrowthVersion, 2);
  assert.deepEqual(migrated.stats, source.maxStats);
  assert.equal(migrated.record.kills, 7);
  assert.equal(migrated.needsRecruitment, true);
  assert.deepEqual(P.custom(migrated), migrated);
  const oldLevel = 1,
    required = source.nativeGrowth.experienceBase * source.nativeGrowth.experienceMultiplier;
  const progress = P.custom({
    ...legacy,
    level: oldLevel,
    experience: required / 2,
    stats: undefined,
  });
  assert.equal(progress.level, 2);
  assert.equal(progress.experience, P.experienceRequired(2, progress) / 2);
  assert.throws(() => P.custom({ ...legacy, stats: { ...legacy.stats, shooting: 99999 } }));
});
