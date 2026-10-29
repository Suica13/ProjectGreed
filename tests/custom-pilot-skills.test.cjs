const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../shared/pilots.js");
const G = require("../shared/rules.js");
const S = require("../shared/unit-skills.js");
const fresh = (level) => P.custom({ ...P.createCustom("custom-skill-test", "Skill Test"), level });

test("level six unlocks exactly six legal skill choices and a choice cannot be replaced", () => {
  assert.equal(P.skillChoices.length, 6);
  S.validate(P.skillChoices, "custom pilot");
  assert(!P.canLearnSkill(fresh(5)));
  assert.throws(() => P.learnSkill(fresh(5), P.skillChoices[0].id));
  assert(P.canLearnSkill(fresh(6)));
  for (const skill of P.skillChoices) {
    const pilot = P.learnSkill(fresh(6), skill.id);
    assert.equal(pilot.selectedSkillId, skill.id);
    assert(!P.canLearnSkill(pilot));
    assert.throws(() => P.learnSkill(pilot, P.skillChoices[1].id));
    assert.equal(P.skillsOf({ pilot })[0].id, skill.id);
    assert.deepEqual(P.custom(JSON.parse(JSON.stringify(pilot))), pilot);
    assert.equal(P.refundTraining(pilot).selectedSkillId, undefined);
    assert(P.canLearnSkill(P.refundTraining(pilot)));
    assert.equal(
      P.learnSkill(P.refundTraining(pilot), P.skillChoices[1].id).selectedSkillId,
      P.skillChoices[1].id,
    );
    assert.equal(P.gainExperience(pilot, P.experienceRequired(6)).selectedSkillId, skill.id);
  }
  for (const id of ["Pilot_ExpUp_Trigger", "Pilot_AwakeningUp_Trigger", "unknown", []])
    assert.throws(() => P.custom({ ...fresh(6), selectedSkillId: id }), /技能/);
  assert.throws(() => P.custom({ ...fresh(5), selectedSkillId: P.skillChoices[0].id }), /技能/);
});
test("all active pilot buffs use 1.35 and one-turn duration with five-turn cooldown", () => {
  for (const skill of [...P.skillChoices, ...P.catalog.aces.flatMap((p) => p.skills)]) {
    if (skill.passive) continue;
    assert.equal(skill.durationTurns, 1);
    assert.equal(skill.cooldownTurns, 5);
    for (const rate of Object.values(skill.statMultipliers)) assert.equal(rate, 1.35);
    assert.equal(skill.experienceMultiplier, skill.id === "Pilot_ExpUp_Trigger" ? 1.35 : 1);
  }
  for (const profile of P.catalog.aces) {
    const ids = profile.skills.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    if (ids.includes("Pilot_ExpUp_Trigger")) assert(ids.includes("Pilot_AtkUp_Trigger"));
  }
});
test("custom skills survive formation validation and run in the shared combat lifecycle", () => {
  for (const skill of P.skillChoices) {
    const pilot = P.learnSkill(fresh(6), skill.id);
    const entry = { unitId: "RGM_79", kitId: "machine_gun", customPilot: pilot };
    assert.equal(G.validateFormation([entry], 99999)[0].customPilot.selectedSkillId, skill.id);
    const game = G.create(
      false,
      1,
      [[entry], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    const u = game.units[0];
    u.en = 500;
    u.actionPoints = 0;
    u.acted = true;
    const permanent = structuredClone(u.pilot),
      start = game.round;
    assert(G.unitSkills(u).some((s) => s.id === skill.id));
    assert(G.canUseSkill(game, u, skill.id));
    G.useSkill(game, u, skill.id, u.x, u.y);
    assert.equal(u.en, 400);
    assert.equal(u.actionPoints, 0);
    for (const [stat, rate] of Object.entries(skill.statMultipliers))
      assert.equal(P.of(u).stats[stat], permanent.stats[stat] * rate);
    assert.deepEqual(u.pilot, permanent);
    assert.equal(u.skillReadyRound[skill.id], start + 12);
    assert.throws(() => G.useSkill(game, u, skill.id, u.x, u.y));
    G.end(game);
    assert(u.pilotBuffs[skill.id]);
    G.end(game);
    assert(!u.pilotBuffs[skill.id]);
    while (game.round < start + 12) {
      assert(!G.canUseSkill(game, u, skill.id));
      G.end(game);
    }
    assert(G.canUseSkill(game, u, skill.id));
  }
});
