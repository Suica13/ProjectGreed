const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const B = G.battlefieldMode;
test("twenty PMC room presets validate and preserve era-compatible factions", () => {
  assert.equal(B.roomPresets.length, 20);
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
  assert.deepEqual(B.baseReward(settings, 0), { money: 1200, supplies: 2400 });
  assert.deepEqual(B.baseReward(settings, 1), { money: 1000, supplies: 2000 });
});

test("five scales per era round limits upward once and cap custom pay at war scale", () => {
  const expected = [
    ["0079T1", [2000,4000,5500,7500,9000], [300,600,900,1200,1500], [1200,2400,3600,4800,6000]],
    ["0079T2", [3000,5500,8500,11000,13500], [450,900,1350,1800,2250], [1500,3000,4500,6000,7500]],
    ["0087T1", [4500,8500,12500,16500,20500], [700,1350,2050,2700,3400], [1875,3750,5625,7500,9375]],
    ["0087T2", [6500,12500,18500,24500,30500], [1050,2050,3050,4050,5100], [2343,4687,7031,9375,11718]],
  ];
  for (const [era, costs, singles, funds] of expected) {
    const presets = B.roomPresets.filter(p => p.era === era);
    assert.deepEqual(presets.map(p => p.costLimit), costs);
    assert.deepEqual(presets.map(p => p.unitCostLimit), singles);
    assert.deepEqual(presets.map(p => p.money), funds);
    assert.deepEqual(presets.map(p => p.id.split("-")[1]), ["small","standard","large","huge","war"]);
    assert(presets.every(p => p.unitLimit === 18 && p.costLimit % 500 === 0 && p.unitCostLimit % 50 === 0));
    const settings = { battlefieldTeams: [{ era }, { era }] };
    for (let i = 0; i < presets.length; i++) {
      const lowerCost = i ? costs[i - 1] : 0;
      const lowerMoney = i ? funds[i - 1] : 0;
      const cost = (lowerCost + costs[i]) / 2;
      const money = Math.floor((lowerMoney + funds[i]) / 2);
      assert.deepEqual(B.baseReward({ ...settings, costLimit: cost }, 0), { money, supplies: money * 2 });
      assert.deepEqual(B.baseReward({ ...settings, costLimit: cost, unitCostLimit: 1, unitLimit: 72 }, 0), { money, supplies: money * 2 });
    }
    let last = 0;
    for (let cost = 0; cost <= 99999; cost += 337) {
      const reward = B.baseReward({ ...settings, costLimit: cost }, 0);
      assert(Number.isInteger(reward.money));
      assert(reward.money >= last && reward.money <= funds.at(-1));
      assert.equal(reward.supplies, reward.money * 2);
      last = reward.money;
    }
    assert.equal(last, funds.at(-1));
    const war = { ...settings, costLimit: costs.at(-1) };
    assert.equal(B.technologyReward(war, 0, true, 1.25), Math.floor(660 * funds.at(-1) / 3750 * 1.25));
    assert.equal(B.technologyReward({ ...war, costLimit: 99999 }, 0, false, 1.25), Math.floor(540 * funds.at(-1) / 3750 * 1.25));
  }
});
