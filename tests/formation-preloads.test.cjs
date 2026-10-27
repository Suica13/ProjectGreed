const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const carrierModel = Object.values(G.models).find((m) => m.prefabId === "PegasusClass"),
  carrier = { unitId: carrierModel.prefabId, kitId: carrierModel.kitId },
  h = carrierModel.hangars[0],
  gm = { unitId: "RGM_79", kitId: "machine_gun" };
const fleet = () => [
  carrier,
  { ...gm, customName: "载员[A01]", preload: { carrierIndex: 0, hangarId: h.id } },
];
test("formation preloads count normal cost and unit limits and reject invalid or overloaded manifests atomically", () => {
  const f = fleet(),
    clean = G.validateFormation(f, Infinity, 6);
  assert.deepEqual(clean, f);
  assert.notEqual(clean[1].preload, f[1].preload);
  assert.throws(() => G.validateFormation(f, carrierModel.cost, 6), /COST/);
  const capacity = Array.from({ length: 4 }, () => ({
    ...gm,
    preload: { carrierIndex: 0, hangarId: h.id },
  }));
  assert.throws(
    () => G.validateFormation([carrier, ...capacity], Infinity, G.catalog.formation.maxUnits),
    /容量/,
  );
  for (const preload of [
    { carrierIndex: 1, hangarId: h.id },
    { carrierIndex: 99, hangarId: h.id },
    { carrierIndex: 0, hangarId: "missing" },
    null,
  ])
    assert.throws(() => G.validateFormation([carrier, { ...gm, preload }], Infinity, 6));
  assert.throws(() =>
    G.validateFormation(
      [{ ...gm }, { ...gm, preload: { carrierIndex: 0, hangarId: h.id } }],
      Infinity,
      6,
    ),
  );
  assert.deepEqual(f, fleet());
});
test("preloaded units spawn inside their native hangars without consuming deployment tiles and can launch normally", () => {
  const g = G.create(false, 1, [fleet(), [gm]], true, { costLimit: 99999, unitCostLimit: 99999 }),
    c = g.units.find((u) => u.id === "0-0"),
    p = g.units.find((u) => u.id === "0-1");
  assert.deepEqual(p.embarked, { carrierId: c.id, hangarId: h.id, boardRound: null });
  assert.equal(G.hangars.used(g, c, h.id), 2);
  assert.equal(G.unitName(p), "载员[A01]");
  assert(!G.onMap(p));
  assert(G.onMap(c));
  assert.equal(p.en, G.modelOf(p).en);
  assert.equal(p.hp, G.modelOf(p).hp);
  G.confirmDeployment(g, 0);
  G.confirmDeployment(g, 1);
  const point = G.hangars.launchCells(g, p)[0];
  assert(point);
  G.hangars.launch(g, p, point.x, point.y);
  assert(!p.embarked);
  assert(p.moved);
  assert(!p.acted);
});
test("disabled carriers release legal cargo and disabled earlier entries remap carrier IDs through deployment indices", () => {
  const limited = G.planFormation(
    fleet(),
    99999,
    { unitCostLimit: G.models.RGM_79__machine_gun.cost },
    6,
  );
  assert(limited.disabled.includes(0));
  assert(!limited.disabled.includes(1));
  assert(!limited.deployable[0].preload);
  const enemy = Object.values(G.models).find((m) => m.prefabId === "MS_06F"),
    entries = [
      { unitId: enemy.prefabId, kitId: enemy.kitId },
      carrier,
      { ...gm, preload: { carrierIndex: 1, hangarId: h.id } },
    ];
  const plan = G.planFormation(entries, 99999, { bannedFactions: ["ZEON"] }, 6);
  assert.deepEqual(plan.indices, [1, 2]);
  assert.equal(plan.deployable[1].preload.carrierIndex, 0);
  const g = G.create(false, 1, [plan.deployable, [gm]], true, {
    costLimit: 99999,
    unitCostLimit: 99999,
    formationIndices: [plan.indices, [0]],
  });
  assert.equal(g.units.find((u) => u.id === "0-2").embarked.carrierId, "0-1");
});
