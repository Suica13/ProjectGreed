const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  P = G.pilots;
const fresh = () => P.createCustom("custom-policy", "Custom");
const aceSource = P.catalog.aces.find((p) => p.availableFactions?.length > 1 && p.price);
const ace = () => P.createAce(aceSource.id);
const unit = (p) => ({ unitId: "Type61", kitId: "standard", ...(p ? { customPilot: p } : {}) });

test("cumulative experience gates, manual promotions and maximum levels follow the explicit tables", () => {
  for (const [initial, table] of [
    [fresh(), [500, 1500, 3000, 5000, 10000, 15000, 20000, 30000]],
    [ace(), [1500, 3000, 5000, 10000, 20000]],
  ]) {
    let p = initial;
    assert.equal(P.maxLevel(p), table.length);
    for (const [level, xp] of table.entries()) {
      assert.equal(P.experienceRequired(level, p), xp);
      p = P.gainExperience(p, xp - 1 - p.experience);
      assert(!P.canUpgrade(p));
      p = P.gainExperience(p, 1);
      assert(P.canUpgrade(p));
      assert.equal(p.level, level);
      p = P.upgrade(p);
      assert.equal(p.level, level + 1);
      assert.equal(p.experience, xp);
    }
    assert(!P.canUpgrade(p));
    assert.deepEqual(P.custom(p), p);
  }
});

test("ACE base COST is bounded and monotonic in rounded final attributes, with the old level step", () => {
  const sources = [...P.catalog.aces].sort(
    (a, b) =>
      Object.values(a.maxStats).reduce((n, x) => n + Math.round(x), 0) -
      Object.values(b.maxStats).reduce((n, x) => n + Math.round(x), 0),
  );
  assert.equal(P.aceBaseCost(sources[0]), 200);
  assert.equal(P.aceBaseCost(sources.at(-1)), 300);
  let previous = 0;
  for (const source of sources) {
    const base = P.aceBaseCost(source);
    assert(base >= previous && base >= 200 && base <= 300 && Number.isInteger(base));
    previous = base;
    assert.equal(source.costBase, base);
    assert.equal(base % 25, 0);
    if (!source.price) continue;
    let p = P.createAce(source.id);
    assert.equal(P.cost(p), base);
    while (p.level < P.maxLevel(p)) {
      p = P.upgrade(P.gainExperience(p, P.experienceRequired(p.level, p) - p.experience));
      assert.equal(P.cost(p), base + 25 * p.level);
    }
    for (const [key, value] of Object.entries(source.maxStats))
      assert.equal(p.stats[key], Math.round(value));
  }
});

test("old level ten training refunds only an excessive allocation, keeping lifetime experience and career", () => {
  const old = {
    ...fresh(),
    trainingVersion: 6,
    level: 10,
    experience: 45000,
    stats: { ...P.baseStats(), shooting: 200, melee: 200, defense: 200, speed: 200, accuracy: 180 },
    record: { kills: 7 },
  };
  const p = P.custom(old);
  assert.equal(p.level, 8);
  assert.equal(p.experience, 45000);
  assert.equal(p.record.kills, 7);
  assert.equal(p.points, 400);
  assert.deepEqual(p.stats, P.baseStats());
  assert.deepEqual(P.custom(p), p);
  const retained = P.custom({ ...old, level: 9, stats: { ...P.baseStats(), shooting: 200 } });
  assert.equal(retained.stats.shooting, 200);
  assert.equal(retained.points, 300);
  assert.throws(() => P.custom({ ...fresh(), level: 9 }), /等级/);
});

test("pilot filters include secondary factions and distinguish custom pilots", () => {
  assert(P.matchesFilter(fresh(), "custom"));
  assert(!P.matchesFilter(fresh(), "EFSF"));
  assert(!P.matchesFilter(ace(), "custom"));
  for (const faction of aceSource.availableFactions) assert(P.matchesFilter(ace(), faction));
  assert(P.matchesFilter(ace(), "all"));
});

for (const mode of ["regular", "quick"])
  for (const [policy, indices] of [
    ["allow", [0, 1, 2]],
    ["no_custom", [0, 2]],
    ["no_ace", [0, 1]],
    ["none", [0]],
  ])
    test(`${mode} ${policy} is authoritative at final deployment`, () => {
      const settings = {
        ...G.defaultRoomSettings(),
        mode,
        pilotPolicy: policy,
        costLimit: 99999,
        unitCostLimit: 99999,
      };
      const rules = G.armyRestrictions(settings, {
        seat: 0,
        characterFaction: "PMC",
        licenses: { Type61: true },
        inventory: { Type61: 3 },
        kits: { Type61__standard: 3 },
      });
      const entries = [unit(), unit(fresh()), unit(ace())],
        plan = G.planFormation(entries, 99999, rules, 12);
      assert.deepEqual(plan.indices, indices);
      const game = G.create(false, 1, [entries, [unit()]], true, {
        ...settings,
        seatFormationRules: [rules, {}],
      });
      assert.equal(game.units.filter((u) => u.ownerSeat === 0).length, indices.length);
    });

test("driver faction tags never prohibit an unpiloted machine and campaign rules remain independent", () => {
  const restrictions = { bannedFactions: ["pilot:EFSF"] };
  assert(!P.allowed(ace(), restrictions));
  assert(P.allowed(fresh(), restrictions));
  assert(P.allowed(null, { pilotPolicy: "none" }));
  assert.equal(G.restrictionReason(G.models.Type61__standard, restrictions), null);
  assert.deepEqual(G.validateTagRestrictions(restrictions).bannedFactions, ["pilot:EFSF"]);
  assert.throws(() => G.validateTagRestrictions({ bannedFactions: ["pilot:INVALID"] }));
  assert.throws(() => G.validatePilotPolicy("invalid"));
  const campaign = G.formationRestrictions({
    mode: "campaign",
    pilotPolicy: "none",
    bannedFactions: ["pilot:EFSF"],
  });
  assert(P.allowed(ace(), campaign));
});

test("pilot modifiers use half-point increments and proportional experience rounds once after all multipliers", () => {
  const modifiers = P.modifiers({
    pilot: { stats: Object.fromEntries(Object.keys(P.labels).map((k) => [k, 200])) },
  });
  for (const key of ["shooting", "melee", "accuracy", "reaction", "move", "attackRounds"])
    assert.equal(modifiers[key], 1.5);
  assert.equal(modifiers.defense, 0.5);
  assert.equal(P.combatExperience(100, 100), 100);
  assert.equal(P.combatExperience(200, 100), 50);
  assert.equal(P.combatExperience(100, 200), 200);
  assert.equal(P.combatExperience(300, 100, 0.1), 3);
  assert.equal(P.combatExperience(100, 200, 0.1 * 0.25 * 2), 10);
});
