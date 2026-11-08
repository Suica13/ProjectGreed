const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const B = G.battlefieldMode;
test("twelve PMC room presets validate and preserve era-compatible factions", () => {
  assert.equal(B.roomPresets.length, 12);
  const current = [
    { faction: "ZEON", era: "0079T2" },
    { faction: "EFSF", era: "0079T1" },
  ];
  for (const preset of B.roomPresets) {
    const rules = B.presetSettings(preset.id, current, G.eras);
    G.validateCostLimit(rules.costLimit);
    G.validateUnitCostLimit(rules.unitCostLimit);
    G.validateUnitLimit(rules.unitLimit);
    G.validateTagRestrictions({ bannedEras: rules.bannedEras });
    B.teams(G, rules.battlefieldTeams);
    assert.deepEqual(
      rules.battlefieldTeams.map((t) => t.faction),
      preset.era.startsWith("0087") ? ["AEUG", "TITANS"] : ["ZEON", "EFSF"],
    );
    assert(rules.battlefieldTeams.every((t) => t.era === preset.era));
    assert(!rules.bannedEras.includes("0079T1"));
    assert.equal(rules.bannedEras.includes("0079T2"), preset.era === "0079T1");
    assert.equal(rules.bannedEras.includes("0083"),preset.era.startsWith("0079"));
    const settings = { ...G.defaultRoomSettings(), mode: "battlefield", ...rules };
    assert.equal(B.roomPreset(settings).id, preset.id);
    for (const team of [0, 1])
      assert.deepEqual(B.baseReward(settings, team), {
        money: preset.money,
        supplies: preset.supplies,
      });
    assert.equal(B.roomPreset({ ...settings, mode: "quick" }), null);
    assert.equal(B.roomPreset({ ...settings, costLimit: rules.costLimit + 1 }), null);
  }
  assert.throws(() => B.presetSettings("invalid", current, G.eras));
  assert.deepEqual(current, [
    { faction: "ZEON", era: "0079T2" },
    { faction: "EFSF", era: "0079T1" },
  ]);
});
test("custom and mixed-era rooms interpolate entry pay without a client-authored reward", () => {
  const settings = {
    ...G.defaultRoomSettings(),
    mode: "battlefield",
    battlefieldTeams: [
      { faction: "EFSF", era: "0079T1" },
      { faction: "ZEON", era: "0079T2" },
    ],
    money: 999999,
  };
  assert.equal(B.roomPreset(settings), null);
  assert.deepEqual(B.baseReward(settings, 0), { money: 1125, supplies: 2250 });
  assert.deepEqual(B.baseReward(settings, 1), { money: 1250, supplies: 2500 });
});

test("custom entry pay follows each era's anchors, stays monotonic and caps at large scale", () => {
  const expected = [
    ["0079T1", 4000, 500, 24, 2250],
    ["0079T1", 10000, 1000, 36, 3750],
    ["0079T1", 20000, 2000, 48, 6000],
    ["0079T2", 6000, 1000, 24, 3750],
    ["0079T2", 15000, 2000, 36, 6000],
    ["0079T2", 30000, 3000, 48, 9000],
  ];
  assert.deepEqual(
    B.roomPresets.map((p) => [p.era, p.costLimit, p.unitCostLimit, p.unitLimit, p.money]),
    [...expected,...expected.map(([era,cost,single,points,money])=>[era.replace("0079","0087"),cost*1.5,single*1.5,points,money*1.5])],
  );
  for (const [era, cost, money] of [
    ["0079T1", 7000, 3000],
    ["0079T1", 15000, 4875],
    ["0079T2", 10500, 4875],
    ["0079T2", 22500, 7500],
  ]) {
    const settings = { costLimit: cost, battlefieldTeams: [{ era }, { era }] };
    assert.deepEqual(B.baseReward(settings, 0), { money, supplies: money * 2 });
    assert.deepEqual(
      B.baseReward({ ...settings, unitCostLimit: 1, unitLimit: 72 }, 0),
      B.baseReward(settings, 0),
    );
  }
  for (const [era, cap] of [
    ["0079T1", 6000],
    ["0079T2", 9000],
    ["0087T1", 9000],
    ["0087T2", 13500],
  ]) {
    let last = 0;
    for (let cost = 0; cost <= 99999; cost += 337) {
      const reward = B.baseReward({ costLimit: cost, battlefieldTeams: [{ era }, { era }] }, 0);
      assert(Number.isInteger(reward.money));
      assert(reward.money >= last && reward.money <= cap);
      assert.equal(reward.supplies, reward.money * 2);
      last = reward.money;
    }
    assert.equal(last, cap);
  }
});
