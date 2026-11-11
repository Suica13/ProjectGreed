const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const B = G.battlefieldMode;
test("thirty-six PMC room presets validate and preserve era-compatible factions", () => {
  assert.equal(B.roomPresets.length, 36);
  const current = [
    { faction: "ZEON", era: "0079T2" },
    { faction: "EFSF", era: "0079T1" },
  ];
  for (const preset of B.roomPresets) {
    const rules = B.presetSettings(preset.id, current, G.eras);
    G.validateCostLimit(rules.costLimit);
    assert.equal(
      rules.unitCostLimit,
      undefined,
      "PMC preset must preserve the existing AI single-unit setting",
    );
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
    assert.equal(rules.bannedEras.includes("0083"), preset.era.startsWith("0079"));
    const settings = { ...G.defaultRoomSettings(), mode: "battlefield", ...rules };
    assert.equal(B.roomPreset(settings).id, preset.id);
    for (const team of [0, 1])
      assert.deepEqual(B.baseReward(settings, team), {
        money: preset.money,
        supplies: preset.supplies,
        technology: preset.technology,
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
  assert.deepEqual(B.baseReward(settings, 0), { money: 5000, supplies: 7500, technology: 1000 });
  assert.deepEqual(B.baseReward(settings, 1), { money: 6250, supplies: 9375, technology: 1250 });
});

test("all nine scales interpolate final resources and clamp custom rooms at the era maximum", () => {
  const round = (n) => Math.round(n / 25) * 25,
    costs = [1500, 2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000];
  for (const [index, era] of B.eras.entries()) {
    const presets = B.roomPresets.filter((p) => p.era === era),
      factor = 1.25 ** index;
    assert.deepEqual(
      presets.map((p) => p.costLimit),
      costs,
    );
    for (let cost = 0; cost < 100000; cost += 337) {
      const p = Math.max(0, Math.min(1, (cost - 1500) / 18500));
      const settings = { costLimit: cost, battlefieldTeams: [{ era }] };
      assert.deepEqual(B.baseReward(settings, 0), {
        money: round((5000 + 10000 * p) * factor),
        supplies: round((7500 + 15000 * p) * factor),
        technology: round((1000 + 1000 * p) * factor),
      });
      assert.equal(B.technologyReward(settings, 0, true), B.technologyReward(settings, 0, false));
    }
  }
});
