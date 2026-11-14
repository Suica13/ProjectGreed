const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  Codec = require("../tools/weapon-store.cjs");
const Conversion = require("../shared/conversion-rules.cjs");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");
const { editorFixture } = require("./catalog-editor-fixture.cjs");

test("standard counts three carrier roots, not cargo capacity; free retains capacity points", () => {
  const entries = Array.from({ length: 4 }, (_, i) => [
    { unitId: "Medea", kitId: "standard" },
    ...Array.from({ length: 3 }, () => ({
      unitId: "Type61",
      kitId: "standard",
      preload: { carrierIndex: i * 4, hangarId: "Hangar_1" },
    })),
  ]).flat();
  // Use the actual imported hangar identifier rather than assuming a MOD name.
  for (const entry of entries)
    if (entry.preload)
      entry.preload.hangarId = G.formationModel(entries[entry.preload.carrierIndex]).hangars[0].id;
  const rules = G.armyRestrictions(
    { ...G.defaultRoomSettings(), mode: "quick" },
    { seat: 0, licenses: { Medea: true, Type61: true } },
  );
  const plan = G.planFormation(entries, 99999, rules, 3);
  assert.equal(plan.disabled.length, 4);
  assert.deepEqual(plan.disabled, [12, 13, 14, 15]);
  assert.equal(G.planFormation(entries.slice(0, 12), 99999, rules, 3).disabled.length, 0);
  const free = G.armyRestrictions(
    { ...G.defaultRoomSettings(), mode: "quick", formationStyle: "free" },
    { seat: 0, licenses: { Medea: true, Type61: true } },
  );
  assert.equal(free.requiresCarriers, undefined);
  assert(G.planFormation(entries.slice(0, 12), 99999, free, 3).disabled.length > 0);
});

test("single-output non-ships receive base COST uplift exactly once; ships and batch units do not", () => {
  const library = require("../assets/weapons.json").definitions;
  for (const id of ["RX_78_2", "MS_06F", "SalamisClass", "Medea"]) {
    const raw = require(`../assets/units/${id}/unit.json`);
    const unit = Codec.expandPrefab(raw, library);
    applyWeaponBalance(unit);
    const quantity = require("../shared/native-production.json")[id]?.quantity;
    const expected =
      quantity === 1 && !raw.stats.ship
        ? Math.round((raw.stats.cost * 1.25) / 25) * 25
        : raw.stats.cost;
    assert.equal(unit.stats.cost, expected, id);
    const snapshot = structuredClone(unit);
    applyWeaponBalance(unit);
    assert.deepEqual(unit, snapshot, id);
  }
});

test("editing special COST stores an additive delta and preserves source COST", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const before = f.read("assets/units/RX_78_2/unit.json").stats.cost;
  const payload = f.store.getUnit("RX_78_2");
  assert.equal(payload.unit.stats.cost, Math.round((before * 1.25) / 25) * 25);
  payload.id = payload.unit.id;
  payload.unit.stats.cost += 25;
  f.store.saveUnit(payload);
  assert.equal(f.read("assets/units/RX_78_2/unit.json").stats.cost, before);
  assert.equal(f.read("shared/editor-adjustments.json").units.RX_78_2["/stats/cost"], 25);
  assert.equal(f.store.getUnit("RX_78_2").unit.stats.cost, payload.unit.stats.cost);
});

test("GM III saber actions explicitly select the native saber layer", () => {
  for (const id of ["RGM_86R", "RGM_86R_EFSF", "RGM_86R_FXA_05D"]) {
    const raw = Codec.expandPrefab(
      require(`../assets/units/${id}/unit.json`),
      require("../assets/weapons.json").definitions,
    );
    assert(
      raw.weapons.EF_BeamSaber_AF_A.attack.steps.some((step) => step.weaponDisplayIndex === 1),
      id,
    );
  }
});

test("counter exposure multiplies final accuracy by 1.1 and respects the hit ceiling", () => {
  const game = G.create(
    false,
    1,
    [[{ unitId: "RGM_79", kitId: "machine_gun" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
    false,
    { fogMode: "disabled" },
  );
  const [a, b] = game.units;
  Object.assign(a, { x: 5, y: 5 });
  Object.assign(b, { x: 6, y: 5 });
  game.tiles.forEach((row) => row.fill("plain"));
  const weapon = { ...G.modelOf(a).weapons[0], hit: 60, sourceHit: 60 };
  const normal = G.estimate(game, a, b, weapon, "counter");
  const exposed = G.estimate(game, a, b, { ...weapon, counterExposureMultiplier: 1.1 }, "counter");
  // Public estimates round both results; the multiplication uses full precision.
  assert(Math.abs(exposed.hit - Math.min(100, normal.hit * 1.1)) <= 1);
  assert.equal(
    G.estimate(game, a, b, { ...weapon, counterExposureMultiplier: 100 }, "counter").hit,
    100,
  );
  assert.equal(Conversion.read().weapons.nonCounterTargetAccuracy, 1.1);
});
