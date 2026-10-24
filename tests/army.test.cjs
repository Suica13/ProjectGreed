const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const entry = (unitId, kitId) => ({ unitId, kitId });
test("OVERCOST removes from the end of the roster and sanitizes untrusted fields", () => {
  const army = [
    entry("MS_06F", "machine_gun"),
    entry("RX_79_G", "beam_rifle"),
    entry("MS_14A", "beam_rifle"),
    entry("MS_06F", "machine_gun"),
  ];
  const before = JSON.stringify(army),
    plan = G.planFormation(army, 1000);
  assert.deepEqual(plan.disabled, [1, 2, 3]);
  assert.equal(plan.deployCost, 200);
  assert.equal(plan.totalCost, 2225);
  assert.equal(JSON.stringify(army), before);
  const tied = G.planFormation(Array(3).fill(entry("MS_06F", "machine_gun")), 400);
  assert.deepEqual(tied.disabled, [2]);
  assert.deepEqual(tied.indices, [0, 1]);
  assert.deepEqual(G.planFormation([entry("MS_14A", "beam_rifle")], 200).disabled, [0]);
  assert.deepEqual(
    G.planFormation([{ ...army[0], performance: 99, disabled: false }], 200).entries,
    [army[0]],
  );
  assert.throws(() => G.planFormation([]));
  assert.throws(() => G.planFormation(Array(13).fill(army[0])));
});
test("AI team tag restrictions, fill budget and difficulty validate independently and generate legal kits", () => {
  for (const faction of ["MIXED", "EFSF", "ZEON"])
    for (const fill of [50, 75, 100, 125, 150]) {
      const config = G.validateAISettings({ fill, difficulty: "hard" }),
        budget = G.aiBudget(1600, config);
      assert.equal(budget, 16 * fill);
      for (let seed = 0; seed < 10; seed++) {
        const army = G.randomFormation(seed, budget, {
          bannedFactions: faction === "MIXED" ? [] : [faction === "EFSF" ? "ZEON" : "EFSF"],
        });
        const minimum = Math.min(
          ...Object.values(G.models)
            .filter((model) => faction === "MIXED" || model.faction === faction)
            .map((model) => model.cost),
        );
        assert.equal(army.length, Math.min(12, Math.floor(budget / minimum)));
        assert.deepEqual(G.validateFormation(army, budget), army);
        if (faction !== "MIXED")
          assert.ok(army.every((e) => G.models[e.unitId + "__" + e.kitId].faction === faction));
      }
    }
  for (const config of [
    { difficulty: "impossible" },
    { faction: "__proto__" },
    { fill: 110 },
    { fill: "150" },
    [],
    null,
    { performance: 9 },
  ])
    assert.throws(() => G.validateAISettings(config));
  assert.deepEqual(G.validateAISettings(), { difficulty: "medium", fill: 100, countPercent: 100 });
});
test("AI difficulty scales instance performance once without changing art, costs or another player's model", () => {
  const id = "RGM_79__machine_gun",
    base = G.models[id],
    before = JSON.stringify(base);
  for (const performance of [0.75, 1, 1.25]) {
    const u = { model: id, performance },
      m = G.modelOf(u),
      w = m.weapons[0];
    assert.equal(m.hp, Math.round(base.hp * performance));
    assert.equal(m.en, Math.round(base.en * performance));
    assert.equal(m.move, Math.round(base.move * performance));
    assert.equal(m.mobility, base.mobility * performance);
    assert.equal(m.shield.hp, Math.round(base.shield.hp * performance));
    assert.equal(m.defenses.shell.flat, base.defenses.shell.flat * performance);
    assert.equal(m.defenses.shell.percent, base.defenses.shell.percent * performance);
    assert.equal(w.damage, base.weapons[0].damage * performance);
    assert.equal(w.hit, Math.min(100, base.weapons[0].hit * performance));
    assert.equal(w.en, base.weapons[0].en);
    assert.equal(m.cost, base.cost);
    assert.equal(w.max, base.weapons[0].max);
    assert.deepEqual(G.weaponStats(w, u), w);
    const g = { tiles: [Array(6).fill("plain")] },
      a = { ...u, x: 0, y: 0 },
      b = { model: id, x: 3, y: 0, shield: 0 };
    assert.deepEqual(G.estimate(g, a, b, base.weapons[0]), G.estimate(g, a, b, w));
  }
  assert.equal(JSON.stringify(base), before);
  assert.equal(G.modelOf({ model: id }), base);
  const g = G.create(
    false,
    1,
    [[entry("RGM_79", "machine_gun")], [entry("RGM_79", "machine_gun")]],
    false,
    { performances: [0.75, 1.25] },
  );
  assert.deepEqual(
    g.units.map((u) => u.hp),
    [12375, 20625],
  );
  assert.throws(() =>
    G.create(
      false,
      1,
      [[entry("MS_06F", "machine_gun")], [entry("MS_06F", "machine_gun")]],
      false,
      { performances: [99, 1] },
    ),
  );
});
test("Gelgoog and Ground Gundam keep native assets, shield, eyes, fixed vulcan and the 750-850 platform tier plus fixed kit surcharges", () => {
  for (const id of ["MS_14A", "RX_79_G"]) {
    const p = G.catalog.prefabs.find((p) => p.id === id);
    assert.ok(p);
    assert.ok(p.stats.hp >= 23000);
    for (const kit of p.weaponKits) {
      const m = G.models[id + "__" + kit.id];
      assert.ok(p.stats.cost >= 750 && p.stats.cost <= 850);
      assert.equal(m.cost, p.stats.cost + kit.cost);
      assert.ok(m.shield.hp > 0);
      assert.ok(m.weapons.some((w) => w.type === "melee"));
    }
    assert.ok(p.layers.some((l) => l.name === "Shield"));
    assert.ok(["zh", "ja", "en"].every((lang) => p.localization[lang]?.name));
    assert.ok(Object.keys(p.skeleton).every((key) => !/^arm\d+$/.test(key)));
  }
  assert.ok(G.catalog.prefabs.find((p) => p.id === "MS_14A").layers.some((l) => l.name === "Eye"));
  const v = G.models.RX_79_G__beam_rifle.weapons.find(
    (w) => w.id === "Common_SingleVulcan_RX_79_G",
  );
  assert.equal(v.clip, null);
  assert.equal(v.changeHeldWeapon, false);
  assert.equal(v.shotCount, 14);
  assert.ok(v.projectile && v.muzzle && v.sound && v.hitEffect);
});

test("scaled AI models retain live localized unit and weapon names", () => {
  const base = G.models.MS_14A__beam_rifle,
    unit = { model: "MS_14A__beam_rifle", performance: 1.25 };
  const originalName = base.name,
    originalWeaponName = base.weapons[0].name,
    m = G.modelOf(unit);
  try {
    base.name = "Gelgoog";
    base.weapons[0].name = "Gelgoog Beam Rifle";
    assert.equal(m.name, "Gelgoog");
    assert.equal(m.weapons[0].name, "Gelgoog Beam Rifle");
  } finally {
    base.name = originalName;
    base.weapons[0].name = originalWeaponName;
  }
});

test("every platform and kit uses a 25 COST step and native model codes stay strings", () => {
  assert.equal(G.catalog.formation.costStep, 25);
  for (const prefab of G.catalog.prefabs) {
    assert.equal(typeof prefab.code, "string");
    assert.equal(prefab.stats.cost % 25, 0);
    for (const kit of prefab.weaponKits) assert.equal(kit.cost % 25, 0);
  }
  for (const model of Object.values(G.models)) assert.equal(model.cost % 25, 0);
  assert.equal(G.models.MS_14A__beam_rifle.code, "MS-14A");
  assert.equal(G.models.RX_79_G__beam_rifle.code, "RX-79[G]");
});

test("AI fills the maximum affordable slots before choosing stronger units and respects room caps", () => {
  for (const faction of ["MIXED", "EFSF", "ZEON"])
    for (const limit of [3, 7, 12])
      for (const budget of [700, 2400, 3600, 12000]) {
        const minimum = Math.min(
          ...Object.values(G.models)
            .filter((m) => faction === "MIXED" || m.faction === faction)
            .map((m) => m.cost),
        );
        const kits = new Set();
        for (let seed = 1; seed <= 30; seed++) {
          const army = G.randomFormation(
            Math.imul(seed, 0x9e3779b9) >>> 0,
            budget,
            { bannedFactions: faction === "MIXED" ? [] : [faction === "EFSF" ? "ZEON" : "EFSF"] },
            limit,
          );
          assert.equal(army.length, Math.min(limit, Math.floor(budget / minimum)));
          G.validateFormation(army, budget, limit);
          for (const entry of army) kits.add(entry.kitId);
        }
        const count = Math.min(limit, Math.floor(budget / minimum));
        const affordableKits = new Set(
          Object.values(G.models)
            .filter(
              (m) =>
                (faction === "MIXED" || m.faction === faction) &&
                m.cost <= budget - minimum * (count - 1),
            )
            .map((m) => m.kitId),
        );
        if (affordableKits.size > 1)
          assert.ok(
            kits.size > 1,
            JSON.stringify({
              faction,
              limit,
              budget,
              kits: [...kits],
              affordableKits: [...affordableKits],
            }),
          );
        else assert.deepEqual(kits, affordableKits);
      }
  for (const value of [2, 13, 3.5, "12", null, NaN])
    assert.throws(() => G.validateUnitLimit(value));
  assert.equal(G.validateUnitLimit(), 12);
  assert.throws(() =>
    G.validateFormation(Array(4).fill(entry("MS_06F", "machine_gun")), Infinity, 3),
  );
  assert.equal(G.create(false, 1, undefined, true, { unitLimit: 3 }).units.length, 6);
});
