const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const C = require("../shared/campaign.js");
const entry = (unitId) => {
  const model = Object.values(G.models).find((m) => m.prefabId === unitId && !m.formOnly);
  return { unitId, kitId: model.kitId };
};
const infantry = "Army_Squad_EFSF_0079_N_G_A";
const vehicleIds = [
  "Type74",
  "Type74Kai",
  "ZN_APC",
  "Cui",
  "SamsonGroundTransportTruck",
  "ZN_APC_WithMS",
];

for (const id of vehicleIds)
  test(`${id} can preload into a compatible transport while retaining its own infantry hangar`, () => {
    const manifest = [
      entry("Medea"),
      { ...entry(id), preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
      { ...entry(infantry), preload: { carrierIndex: 1, hangarId: "Hangar_1" } },
    ];
    const clean = G.validateFormation(manifest, Infinity, 72);
    const game = G.create(false, 1, [clean, [entry("Type61")]], false, {
      costLimit: 10000,
      unitCostLimit: 2000,
    });
    const [carrier, vehicle, passenger] = ["0-0", "0-1", "0-2"].map((id) =>
      game.units.find((u) => u.id === id),
    );
    assert.equal(vehicle.embarked.carrierId, carrier.id);
    assert.equal(passenger.embarked.carrierId, vehicle.id);
    assert.equal(G.hangars.used(game, carrier, "Hangar_1"), 1);
    assert.equal(G.hangars.used(game, vehicle, "Hangar_1"), 1);
    assert.equal(G.hangars.launchCells(game, passenger).length, 0);
    assert.deepEqual([passenger.x, passenger.y], [carrier.x, carrier.y]);
    game.tiles.forEach((row) => row.fill("plain"));
    const cell = G.hangars.launchCells(game, vehicle)[0];
    assert.ok(cell);
    G.hangars.launch(game, vehicle, cell.x, cell.y);
    assert.equal(vehicle.embarked, undefined);
    assert.equal(passenger.embarked.carrierId, vehicle.id);
    assert.deepEqual([passenger.x, passenger.y], [vehicle.x, vehicle.y]);
  });

test("nested preloads deploy in dependency order regardless of their list indices", () => {
  const manifest = [
    { ...entry(infantry), preload: { carrierIndex: 1, hangarId: "Hangar_1" } },
    { ...entry("Type74"), preload: { carrierIndex: 2, hangarId: "Hangar_1" } },
    entry("Medea"),
  ];
  const game = G.create(false, 1, [manifest, [entry("Type61")]], true, {
    costLimit: 10000,
    unitCostLimit: 2000,
  });
  assert.equal(game.units.filter((u) => u.team === 0).length, 3);
  assert.equal(game.units.find((u) => u.id === "0-0").embarked.carrierId, "0-1");
  assert.equal(game.units.find((u) => u.id === "0-1").embarked.carrierId, "0-2");
});

test("loaded vehicles can board during battle and keep their passengers when the outer carrier is destroyed", () => {
  const game = G.create(
    false,
    1,
    [[entry("Medea"), entry("Type74"), entry(infantry)], [entry("Type61")]],
    false,
    { costLimit: 10000, unitCostLimit: 2000 },
  );
  game.tiles.forEach((row) => row.fill("plain"));
  const [carrier, vehicle, passenger] = ["0-0", "0-1", "0-2"].map((id) =>
    game.units.find((u) => u.id === id),
  );
  Object.assign(carrier, { x: 10, y: 8 });
  Object.assign(vehicle, { x: 9, y: 8 });
  Object.assign(passenger, { x: 8, y: 8 });
  G.hangars.embark(game, passenger, vehicle, "Hangar_1");
  assert.ok(G.hangars.canEmbark(game, vehicle, carrier, "Hangar_1"));
  G.hangars.embark(game, vehicle, carrier, "Hangar_1");
  carrier.hp = 0;
  const exits = G.hangars.evacuate(game);
  assert.ok(exits.some((event) => event.unitId === vehicle.id && event.escaped));
  assert.equal(passenger.embarked.carrierId, vehicle.id);
  assert.deepEqual([passenger.x, passenger.y], [vehicle.x, vehicle.y]);
});

test("manifest validation rejects cycles even when transport types and capacity would allow them", () => {
  const unit = entry("Type74"),
    id = unit.unitId + "__" + unit.kitId;
  const original = G.models[id];
  try {
    G.models[id] = { ...original, transport: { ...original.transport, loadTags: ["Human"] } };
    assert.throws(
      () =>
        G.validateFormation(
          [
            { ...unit, preload: { carrierIndex: 1, hangarId: "Hangar_1" } },
            { ...unit, preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
          ],
          Infinity,
          72,
        ),
      /循环/,
    );
  } finally {
    G.models[id] = original;
  }
});

test("nested transport still enforces native load tags and capacity", () => {
  assert.throws(() =>
    G.validateFormation(
      [entry("Medea"), { ...entry("Medea"), preload: { carrierIndex: 0, hangarId: "Hangar_1" } }],
      Infinity,
      72,
    ),
  );
  assert.throws(() =>
    G.validateFormation(
      [
        entry("Type74"),
        ...[1, 2].map(() => ({
          ...entry(infantry),
          preload: { carrierIndex: 0, hangarId: "Hangar_1" },
        })),
      ],
      Infinity,
      72,
    ),
  );
});

test("strategic nested vehicles survive import, travel with cargo and cannot unload through an embarked parent", () => {
  const ctx = {
    G,
    world: G.catalog.scenarios.earth_0079_mid.world,
    production: require("../shared/production-data.cjs"),
    development: require("../shared/development.js"),
  };
  const members = [{ seat: 0 }, { seat: 1 }];
  const state = C.create(ctx, members);
  state.units = [];
  const [carrier, vehicle, passenger] = ["Medea", "Type74", infantry].map((id) =>
    C.addUnit(ctx, state, 0, "jaburo", id),
  );
  const act = (action, fields) =>
    C.action(ctx, state, members, 0, { action, turn: state.turn, ...fields });
  act("campaign_embark", { armyId: passenger.id, carrierId: vehicle.id, hangarId: "Hangar_1" });
  assert.ok(C.embarkOptions(ctx, state, vehicle).some((o) => o.carrierId === carrier.id));
  act("campaign_embark", { armyId: vehicle.id, carrierId: carrier.id, hangarId: "Hangar_1" });
  C.validate(ctx, structuredClone(state), members);
  assert.throws(() => act("campaign_disembark", { armyId: passenger.id }));
  act("campaign_move", { ids: [carrier.id], region: "andes" });
  C.advance(ctx, state, members);
  assert.ok(state.units.every((u) => u.region === "andes"));
  act("campaign_disembark", { armyId: vehicle.id });
  act("campaign_disembark", { armyId: passenger.id });
  assert.equal(passenger.state.embarked, undefined);
  C.validate(ctx, structuredClone(state), members);
});
