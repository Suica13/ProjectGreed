const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const entry = (unitId, kitId = "machine_gun") => ({ unitId, kitId });
test("tail priority combines individual cost, room tags and team tags without mutating saved squads", () => {
  const army = [
    entry("MS_06F"),
    entry("MS_14A", "beam_rifle"),
    entry("RGM_79"),
    entry("MS_06F2"),
    entry("MS_06F"),
  ];
  const original = JSON.stringify(army),
    settings = {
      ...G.defaultRoomSettings(),
      costLimit: 500,
      bannedFactions: ["EFSF"],
      teamRestrictions: [
        { bannedFactions: [], bannedEras: [] },
        { bannedFactions: [], bannedEras: ["0079"] },
      ],
    };
  const own = G.planFormation(army, settings.costLimit, G.formationRestrictions(settings, 0));
  assert.deepEqual(own.disabled, [1, 2, 3, 4]);
  assert.deepEqual(own.reasons, { 1: "cost", 2: "not_allowed", 3: "cost", 4: "cost" });
  assert.deepEqual(own.indices, [0]);
  assert.equal(own.deployCost, 200);
  assert.equal(
    G.planFormation(army, 500, G.formationRestrictions(settings, 1)).deployable.length,
    0,
  );
  assert.equal(G.planFormation(army, Infinity).disabled.length, 0);
  assert.equal(JSON.stringify(army), original);
  assert.deepEqual(
    G.planFormation([entry("MS_06F"), entry("RGM_79"), entry("MS_06F")], 550).indices,
    [0, 1],
  );
});
test("AI slots only use allowed unit kits, prioritize count and handle an empty eligible catalog", () => {
  for (const bannedFactions of [[], ["EFSF"], ["ZEON"]])
    for (const cap of [225, 350, 500, 850])
      for (const fill of [50, 75, 100, 125, 150]) {
        const settings = { ...G.defaultRoomSettings(), unitCostLimit: cap, bannedFactions };
        const restrictions = G.formationRestrictions(settings, 0),
          legal = Object.values(G.models).filter((m) => !G.restrictionReason(m, restrictions));
        const budget = G.aiBudget(5000, { difficulty: "hard", fill });
        for (let seed = 0; seed < 20; seed++) {
          const army = G.randomFormation(seed, budget, restrictions, 12);
          const minimum = Math.min(...legal.map((m) => m.cost));
          assert.equal(army.length, Math.min(12, Math.floor(budget / minimum)));
          if (army.length) {
            const plan = G.planFormation(army, budget, restrictions);
            assert.equal(plan.disabled.length, 0);
            assert.ok(plan.deployCost <= budget);
          }
        }
      }
  assert.deepEqual(G.randomFormation(1, 5000, { bannedEras: ["0079"] }), []);
  assert.deepEqual(G.randomFormation(1, 5000, { bannedFactions: ["EFSF", "ZEON"] }), []);
  assert.throws(() => G.validateAISettings({ faction: "EFSF" }));
  for (const value of [
    null,
    [],
    { bannedFactions: ["UNKNOWN"] },
    { bannedEras: ["0087"] },
    { unitCostLimit: 500 },
  ])
    assert.throws(() => G.validateTagRestrictions(value));
  for (const value of [null, 0, -1, 500.5, "500", 100000])
    assert.throws(() => G.validateUnitCostLimit(value));
});
test("MS-06F2 uses original body, eye, sound, projectiles, Steps and three non-beam weapon kits in the GM tier", () => {
  const prefab = G.catalog.prefabs.find((p) => p.id === "MS_06F2"),
    gm = G.models.RGM_79__machine_gun;
  assert.deepEqual(prefab.tags, ["ZEON", "0079"]);
  assert.equal(prefab.code, "MS-06F2");
  assert.ok(prefab.layers.some((l) => l.name === "Eye"));
  assert.ok(Object.keys(prefab.skeleton).every((b) => !/^arm\d+$/.test(b)));
  assert.equal(prefab.weaponKits.length, 3);
  for (const kit of prefab.weaponKits) {
    const model = G.models[prefab.id + "__" + kit.id];
    assert.ok(model.cost >= 350 && model.cost <= 400);
    assert.ok(model.hp >= gm.hp && model.hp <= gm.hp * 1.2);
    assert.equal(model.move, gm.move);
    for (const weapon of model.weapons) {
      assert.notEqual(weapon.type, "beam");
      assert.ok(weapon.source.file && weapon.sound);
      assert.ok(weapon.attack.shots.length > 0);
      if (weapon.type !== "melee")
        assert.ok(weapon.projectile && weapon.hitEffect && weapon.muzzle);
    }
  }
  assert.equal(G.models.MS_06F2__machine_gun.weapons[0].shotCount, 8);
});
