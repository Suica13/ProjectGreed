const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
test("personal unit cost ratios follow the room cap for humans and AI", () => {
  const settings = G.defaultRoomSettings();
  for (const bot of [false, true])
    for (const percent of G.armyPercentages) {
      const p = { seat: 0, bot, armySettings: { unitCostPercent: percent } };
      assert.equal(
        G.armyRestrictions(settings, p).unitCostLimit,
        Math.floor((settings.unitCostLimit * percent) / 100),
      );
      assert.equal(
        G.armyRestrictions({ ...settings, unitCostLimit: 1000 }, p).unitCostLimit,
        percent * 10,
      );
    }
  for (const value of [0, 101, 325, "100"])
    assert.throws(() => G.validateArmySettings({ unitCostPercent: value }));
});
test("team small tags restrict formation and AI, while host assigned presets keep their exemption", () => {
  const settings = {
    ...G.defaultRoomSettings(),
    teamRestrictions: G.validateTeamRestrictions([{ bannedTypes: ["MS"] }, {}]),
  };
  const p = { seat: 0 },
    rules = G.armyRestrictions(settings, p),
    entry = { unitId: "RGM_79", kitId: "machine_gun" };
  assert.equal(G.planFormation([entry], Infinity, rules).reasons[0], "not_allowed");
  assert.equal(
    G.planFormation([entry], Infinity, G.armyRestrictions(settings, { seat: 1 })).reasons[0],
    undefined,
  );
  const ai = G.randomFormation(234, 3000, rules, 6);
  assert(ai.length > 0);
  assert(ai.every((e) => !G.models[e.unitId + "__" + e.kitId].unitTags.includes("MS")));
  assert.deepEqual(
    G.armyRestrictions(settings, { ...p, formationPreset: { units: [entry] } }).bannedTypes,
    [],
  );
  assert.throws(() => G.validateTeamRestrictions([{ bannedTypes: ["fake"] }, {}]));
});
