const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const E = require('../shared/battle-economy');
const B = G.battlefieldMode;
const M = require('../shared/mission-mode');


test('mercenary entry money doubles at every era/scale while technology is unchanged', () => {
  for (const preset of B.roomPresets) {
    const factor = 1.25 ** (G.technologyWeight(preset.era) - 1);
    const progress = (preset.costLimit - 1500) / 18500;
    const expected = {
      money: E.roundReward((5000 + 10000 * progress) * factor) * 2,
      technology: E.roundReward((1000 + 1000 * progress) * factor),
    };
    assert.equal(preset.money, expected.money);
    assert.equal(preset.technology, expected.technology);
    assert.equal(preset.supplies, E.roundReward(expected.money * 1.5));
    const settings = {mode:'battlefield', costLimit:preset.costLimit,
      battlefieldTeams:[{era:preset.era},{era:preset.era}]};
    assert.deepEqual(B.baseReward(settings, 0), {
      money:preset.money, supplies:preset.supplies, technology:preset.technology,
    });
    assert.equal(B.baseReward({...settings,costLimit:99999},0).money,
      E.roundReward(15000 * factor) * 2);
  }
});

test('mercenary kills receive 150 percent, assists keep their funding, and all side rewards use 1:1.5', () => {
  assert.deepEqual(B.defeatReward(1000), {money:750,supplies:1125});
  assert.deepEqual(B.defeatReward(1000,true), {money:250,supplies:375});
  for (let level=1;level<=4;level++) {
    const f=B.facilityReward(level), old=400+200*(level-1);
    assert.deepEqual(B.defeatReward(0,false,f), {money:old*1.5,supplies:old*2.25});
    assert.deepEqual(B.defeatReward(0,true,f), {money:old/2,supplies:old*.75});
  }
  for (const era of B.eras) {
    const settings={battlefieldTeams:[{era}]};
    for(const reward of [B.captureReward(settings,0), B.baseDamageReward(settings,0)])
      assert.equal(reward.supplies,reward.money*1.5);
  }
});

test('mission bonuses derive supplies from money', () => {
  const mission={rewards:{money:2000,supplies:9999,inventory:{Type61:2},bonuses:[
    {event:'extra',money:2000,supplies:1,inventory:{RB_79:1}}]}};
  const room={settings:{mapId:'test'},game:{winner:0,mission:{fired:['extra']}}};
  assert.deepEqual(M.reward(room,{getMap:()=>({mission})}),{
    money:4000,supplies:6000,inventory:{Type61:2,RB_79:1}});
  room.game.winner=1;
  assert.deepEqual(M.reward(room,{getMap:()=>({mission})}),{money:0,supplies:0,inventory:{}});

});
