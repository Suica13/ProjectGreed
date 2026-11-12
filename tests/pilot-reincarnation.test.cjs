const test = require("node:test"), assert = require("node:assert/strict");
const P = require("../shared/pilots"), G = require("../shared/rules");
const fresh = () => P.createCustom("custom-rebirth", "Rebirth");
test("four rebirths reset training and XP, unlock 9..12 and keep identity and records", () => {
  let p = fresh();
  assert.equal(P.maxLevel(p), 8);
  assert.throws(() => P.reincarnate(p));
  assert.throws(() => P.custom({ ...p, reincarnations: 5 }));
  assert.throws(() => P.custom({ ...p, level: 9 }));
  for (let turn = 0; turn <= 4; turn++) {
    p = P.gainExperience(p, 5000000);
    while (P.canUpgrade(p)) p = P.upgrade(p);
    assert.equal(p.level, 8 + turn);
    assert.equal(P.maxLevel(p), p.level);
    p = P.learnSkill(p, P.skillChoices[0].id);
    p.stats.shooting += 20;
    p.record.kills = 3;
    p = P.custom(p);
    if (turn === 4) {
      assert(!P.canReincarnate(p));
      assert.throws(() => P.reincarnate(p));
      break;
    }
    assert.equal(P.reincarnationCost(p), [80000,100000,120000,140000][turn]);
    p = P.reincarnate(p);
    assert.equal(p.reincarnations, turn + 1);
    assert.equal(p.experience, 0);
    assert.equal(p.level, 0);
    assert.equal(p.points, 80);
    assert.deepEqual(p.stats, P.baseStats());
    assert.equal(p.selectedSkillId, undefined);
    assert.equal(p.record.kills, 3);
    assert.equal(p.name, "Rebirth");
    assert.deepEqual(P.custom(JSON.parse(JSON.stringify(p))), p);
  }
  assert.deepEqual([8,9,10,11].map(level=>P.experienceRequired(level)), [200000,3000000,4000000,5000000]);
});
test("second skill unlocks only at twelve and survives combat formation validation", () => {
  let p = P.custom({ ...fresh(), reincarnations:4, level:11 });
  p = P.learnSkill(p, P.skillChoices[0].id);
  assert(!P.canLearnSkill(p));
  assert.throws(()=>P.learnSkill(p,P.skillChoices[1].id));
  p = P.custom({...p,level:12});
  assert(P.canLearnSkill(p));
  assert.throws(()=>P.learnSkill(p,p.selectedSkillId));
  p = P.learnSkill(p,P.skillChoices[1].id);
  assert(!P.canLearnSkill(p));
  assert.equal(P.skillsOf({pilot:p}).length,2);
  const e={unitId:"RGM_79",kitId:"machine_gun",customPilot:p};
  assert.equal(G.validateFormation([e],99999)[0].customPilot.selectedSecondSkillId,p.selectedSecondSkillId);
  assert.equal(P.demote(p).selectedSecondSkillId,undefined);
  assert.equal(P.refundTraining(p).selectedSecondSkillId,undefined);
  assert.throws(()=>P.custom({...p,level:11}));
  const ace=P.createAce(P.catalog.aces.find(a=>a.price).id);
  assert.equal(P.maxLevel(ace),5);
  assert(!P.canReincarnate(ace));
});
test("ten dialogue entries are enforced on imports while old stored twelve-line pools migrate",()=>{
  assert.equal(P.normalizeDialogue({attack:Array(10).fill("line")}).attack.length,10);
  assert.throws(()=>P.importDialogue({format:"projectgreed.pilot-dialogue",version:1,dialogue:{attack:Array(11).fill("line")}}));
  assert.equal(P.custom({...fresh(),dialogue:{attack:Array(12).fill("old")}}).dialogue.attack.length,10);
});
