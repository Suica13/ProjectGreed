const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js"),
  P = G.pilots,
  E = require("../shared/economy.js"),
  S = require("../shared/unit-skills.js");
function fixture(skillId, unitId = "RGM_79") {
  const ace = P.catalog.aces.find((p) => p.price && p.skills.some((s) => s.id === skillId));
  assert(ace, skillId);
  const entry = { unitId, kitId: E.baseKit(unitId), customPilot: P.createAce(ace.id) };
  const g = G.create(false, 1, [[entry], [{ unitId: "RGM_79", kitId: "machine_gun" }]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  g.tiles.forEach((r) => r.fill("plain"));
  Object.assign(g.units[0], { x: 5, y: 8, en: 1000 });
  Object.assign(g.units[1], { x: 9, y: 8 });
  return {
    g,
    u: g.units[0],
    enemy: g.units[1],
    skill: G.unitSkills(g.units[0]).find((s) => s.id === skillId),
  };
}
const active = [
  ...new Set(
    P.catalog.aces
      .flatMap((p) => p.skills)
      .filter((s) => !s.passive)
      .map((s) => s.id),
  ),
];
test("all native ACE skills have active runtime definitions and COST starts at 250 then steps by 25", () => {
  assert.equal(active.length, 8);
  for (const ace of P.catalog.aces) {
    S.validate(ace.skills, ace.id);
    if (!ace.price) continue;
    let p = P.createAce(ace.id);
    assert.equal(P.cost(p), 250);
    p = P.gainExperience(p, 1e9);
    assert.equal(P.cost(p), 375);
  }
});
for (const id of active)
  test(
    id +
      " spends 100 EN once, preserves AP and permanent stats, lasts through opponent turn and cools down five turns",
    () => {
      const { g, u, skill } = fixture(id),
        start = g.round,
        permanent = structuredClone(u.pilot),
        before = G.modelOf(u);
      u.actionPoints = 0;
      u.acted = true;
      assert(G.canUseSkill(g, u, id));
      G.useSkill(g, u, id, u.x, u.y);
      assert.equal(u.en, 900);
      assert.equal(u.actionPoints, 0);
      assert.deepEqual(u.pilot, permanent);
      assert(!G.canUseSkill(g, u, id));
      assert.throws(() => G.useSkill(g, u, id, u.x, u.y));
      assert.equal(u.en, 900);
      for (const [key, rate] of Object.entries(skill.statMultipliers))
        assert.equal(P.of(u).stats[key], permanent.stats[key] * rate);
      if (skill.experienceMultiplier !== 1)
        assert.equal(
          G.modelOf(u).pilotExperienceMultiplier,
          before.pilotExperienceMultiplier * skill.experienceMultiplier,
        );
      if (skill.statMultipliers.speed) assert(G.modelOf(u).move > before.move);
      if (skill.statMultipliers.accuracy) assert(G.modelOf(u).accuracy > before.accuracy);
      if (skill.statMultipliers.reaction) assert(G.modelOf(u).mobility > before.mobility);
      if (skill.statMultipliers.defense)
        assert(G.modelOf(u).pilotModifiers.defense < before.pilotModifiers.defense);
      if (skill.statMultipliers.shooting)
        assert(G.modelOf(u).pilotModifiers.shooting > before.pilotModifiers.shooting);
      G.end(g);
      assert(u.pilotBuffs[id]);
      G.end(g);
      assert(!u.pilotBuffs[id]);
      assert.deepEqual(P.of(u).stats, permanent.stats);
      assert.equal(G.modelOf(u).move, before.move);
      assert.equal(u.skillReadyRound[id], start + 12);
      while (g.round < start + 12) {
        assert(!G.canUseSkill(g, u, id));
        G.end(g);
      }
      assert(G.canUseSkill(g, u, id));
    },
  );
test("ACE skill intents reject other pilots, opponents, passengers, dead units and insufficient EN", () => {
  const id = active[0],
    { g, u, enemy } = fixture(id);
  assert(!G.canUseSkill(g, enemy, id));
  for (const changes of [
    { en: 99 },
    { hp: 0 },
    { team: 1 },
    { embarked: { carrierId: enemy.id } },
  ]) {
    const old = { ...u };
    Object.assign(u, changes);
    assert(!G.canUseSkill(g, u, id));
    Object.keys(u).forEach((k) => delete u[k]);
    Object.assign(u, old);
  }
  assert.deepEqual(
    G.unitSkills(u)
      .slice(-P.skillsOf(u).length)
      .map((s) => s.id),
    P.skillsOf(u).map((s) => s.id),
  );
});
test("leadership affects aura and awakening unlocks native weapon gates without changing permanent stats", () => {
  const a = fixture("Pilot_LeaderShipUp_Trigger"),
    old = G.commandAura(a.u);
  G.useSkill(a.g, a.u, a.skill.id, a.u.x, a.u.y);
  assert(G.commandAura(a.u).radius > old.radius);
  assert(G.commandAura(a.u).effect > old.effect);
  const b = fixture("Pilot_AwakeningUp_Trigger"),
    base = b.u.pilot.stats.awakening,
    gate = { pilotRequirements: [{ stat: "awakening", operator: ">=", value: base * 1.3 }] };
  assert(!G.pilotWeaponAllowed(b.u, gate));
  G.useSkill(b.g, b.u, b.skill.id, b.u.x, b.u.y);
  assert(G.pilotWeaponAllowed(b.u, gate));
  assert.equal(b.u.pilot.stats.awakening, base);
});
test("pilot buffs and cooldowns follow armor purge and EXAM pilot prevents only EXAM hull drain", () => {
  const f = fixture("Pilot_AccuracyUp_Trigger", "FA_78_1");
  G.useSkill(f.g, f.u, f.skill.id, f.u.x, f.u.y);
  G.useSkill(f.g, f.u, "ExitUnit", f.u.x, f.u.y);
  const changed = f.g.units.find((u) => u.id === f.u.id);
  assert(changed.pilotBuffs[f.skill.id]);
  assert.equal(changed.skillReadyRound[f.skill.id], f.g.round + 12);
  assert(!G.canUseSkill(f.g, changed, f.skill.id));
  for (const unitId of ["RX_79_BD_2", "RX_80PR"]) {
    const f = fixture("Pilot_ExamPilot_Trigger", unitId);
    const over = G.unitSkills(f.u).find((s) => s.type === "overdrive");
    assert(!G.canUseSkill(f.g, f.u, f.skill.id));
    G.useSkill(f.g, f.u, over.id, f.u.x, f.u.y);
    const hp = f.u.hp,
      en = f.u.en;
    G.end(f.g);
    assert.equal(f.u.hp, over.id === "EXAM" ? hp : hp - G.roundDamage(G.modelOf(f.u).hp * over.hpDrainPercent / 100));
    assert(f.u.en < en);
  }
});
