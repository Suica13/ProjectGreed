const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  S = require("../shared/sweep-mode"),
  E = require("../shared/battle-economy");
function room(era = "UC_0079_T2", faction = "ZEON", environment = "ground") {
  const room = {
    settings: {
      ...G.defaultRoomSettings(),
      mode: "sweep",
      sweepEra: era,
      sweepFaction: faction,
      costLimit: 5000,
      sweepEnvironment: environment,
    },
    seats: [{ id: "p", seat: 0 }],
    sweep: {
      depth: 0,
      seed: 7319,
      pending: { p: { money: 0, supplies: 0, technology: 0, inventory: {} } },
    },
  };
  room.settings.mapId = S.mapPool(room, G)[0].id;
  return room;
}
test("sweep node funding increases 25 percent while technology keeps its prior baseline", () => {
  for (const depth of [0, 1, 5, 20])
    for (const multiplier of [1, 2, 3]) {
      const r = room();
      r.sweep.depth = depth;
      r.sweep.rewardMultipliers = { money: 1.25, supplies: 1.5, technology: 2 };
      S.reward(r, G, multiplier, 0, 1.1);
      const scale = 1 + depth * 0.05,
        p = r.sweep.pending.p;
      assert.equal(p.technology, E.roundReward(62.5 * scale * multiplier * 1.1 * 2));
      assert.equal(p.money, E.roundReward(500 * 1.25 * scale * multiplier * 1.25));
      assert.equal(p.supplies, E.roundReward(750 * 1.25 * scale * multiplier * 1.5));
    }
});
test("sweep technology progression opens more tiers and advances elites and bosses", () => {
  const r = room(),
    progress = [];
  const rules = {
    ...G,
    randomFormation(seed, cost, restrictions) {
      progress.push(restrictions.aiEncounterProgress);
      return [];
    },
  };
  for (const depth of [0, 5, 10, 20]) {
    r.sweep.depth = depth;
    S.enemies(r, rules, 7319);
  }
  assert.deepEqual(progress, [0.3, 0.475, 0.65, 1]);
  r.sweep.depth = 0;
  r.sweep.elite = true;
  S.enemies(r, rules, 7319);
  assert(Math.abs(progress.at(-1) - 0.45) < 1e-12);
  r.sweep.boss = true;
  S.enemies(r, rules, 7319);
  assert.equal(progress.at(-1), 0.6);
});
test("sweep intel event halves both base and extra technology without altering prior receipts", () => {
  const r = room();
  r.sweep.depth = 4;
  r.sweep.event = { id: "intel" };
  r.sweep.rosters = { p: [{ state: { hp: 1 } }] };
  r.sweep.losses = { p: [] };
  r.sweep.pending.p.technology = 1000;
  S.event(r, G, 0);
  assert.equal(
    r.sweep.pending.p.technology,
    1000 + E.roundReward(62.5 * 1.2) + E.roundReward(37.5 * 1.2),
  );
  assert.equal(r.phase, "sweep_map");
});
test("small sweep budgets field an armed loaded unit in every offered era and environment", () => {
  for (const era of G.eras)
    for (const faction of S.factionsForEra(G, era))
      for (const environment of ["ground", "space"]) {
        const r = room(era, faction, environment);
        r.settings.costLimit = 1500;
        const army = S.enemies(r, G, 7319);
        assert(
          army.some((e) => e.preload && G.formationModel(e).weapons.length),
          `${era}/${faction}/${environment}`,
        );
      }
});
test("sweep fleets stay varied, valid and deterministic as nodes advance on ground and in space", () => {
  for (const [era, faction] of [
    ["UC_0079_T1", "EFSF"],
    ["UC_0079_T2", "ZEON"],
    ["UC_0087_T1", "AEUG"],
    ["UC_0093_T1", "NEO_ZEON_0093"],
  ])
    for (const environment of ["ground", "space"]) {
      const r = room(era, faction, environment),
        seen = [];
      for (const depth of [0, 10, 20]) {
        r.sweep.depth = depth;
        const army = S.enemies(r, G, 7319 + depth),
          limits = S.enemyLimits(r, G);
        assert(army.length, `${era}/${environment}/${depth} is empty`);
        assert(
          army.some((e) => e.preload),
          `${era}/${environment}/${depth} has no passengers`,
        );
        assert(army.reduce((sum, e) => sum + G.formationModel(e).cost, 0) <= limits.costLimit);
        assert(army.every((e) => G.isFleetCarrier(G.formationModel(e)) || e.preload));
        assert(
          army.every(
            (e) => G.isFleetCarrier(G.formationModel(e)) || G.formationModel(e).tags.includes(era),
          ),
        );
        assert.deepEqual(S.enemies(r, G, 7319 + depth), army);
        seen.push(new Set(army.filter((e) => e.preload).map((e) => e.unitId)));
      }
      assert(
        new Set(seen.flatMap((ids) => [...ids])).size >= 3,
        `${era}/${environment} lacks variety`,
      );
    }
});
