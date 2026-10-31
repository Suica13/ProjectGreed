const test = require("node:test"),
  assert = require("node:assert/strict");
const C = require("../shared/campaign.js"),
  G = require("../shared/rules.js");
const ctx = {
  G,
  world: require("../shared/campaign-world.json"),
  production: require("../shared/production-data.cjs"),
  development: require("../shared/development.js"),
};
const players = [0, 1, 2, 3].map((seat) => ({ seat, bot: false }));

test("bulk strategic orders do not inherit the old 72-entry formation limit", () => {
  const state = C.create(ctx, players);
  const units = Array.from({ length: 80 }, () => C.addUnit(ctx, state, 0, "jaburo", "Type61"));
  const ids = units.map((unit) => unit.id);
  C.action(ctx, state, players, 0, { action: "campaign_move", turn: 1, ids, region: "andes" });
  assert(units.every((unit) => unit.moveTo === "andes"));
  C.action(ctx, state, players, 0, { action: "campaign_move", turn: 1, ids, region: null });
  C.action(ctx, state, players, 0, { action: "campaign_transfer", turn: 1, ids, to: 2 });
  C.action(ctx, state, players, 2, {
    action: "campaign_accept_transfer",
    turn: 1,
    transferId: state.transfers[0].id,
    accept: true,
  });
  assert(units.every((unit) => unit.ownerSeat === 2));
});

test("selected equipment prices are charged per batch and preserved on every produced unit", () => {
  const state = C.create(ctx, players),
    base = C.quote(ctx, "RFF_06"),
    quote = C.quote(ctx, "RFF_06", "kit_1");
  assert.equal(quote.money, base.money + 600);
  assert.equal(quote.supplies, base.supplies + 1200);
  assert.equal(quote.quantity, 3);
  const money = state.teams[0].money,
    supplies = state.teams[0].supplies;
  C.action(ctx, state, players, 0, {
    action: "campaign_produce",
    turn: state.turn,
    region: "jaburo",
    unitId: "RFF_06",
    kitId: "kit_1",
  });
  assert.equal(state.teams[0].money, money - 2100);
  assert.equal(state.teams[0].supplies, supplies - 3200);
  assert.equal(state.orders[0].kitId, "kit_1");
  const before = structuredClone(state);
  assert.throws(
    () =>
      C.action(ctx, state, players, 0, {
        action: "campaign_produce",
        turn: state.turn,
        region: "jaburo",
        unitId: "RFF_06",
        kitId: "bazooka",
      }),
    /套件/,
  );
  assert.deepEqual(state, before);
  assert.equal(C.quote(ctx, "RGM_79_G", "cannon"), null);
  for (let turn = 0; turn < quote.turns; turn++) C.advance(ctx, state, players);
  const produced = state.units.filter((unit) => unit.unitId === "RFF_06");
  assert.equal(produced.length, 3);
  assert(produced.every((unit) => unit.kitId === "kit_1" && unit.ownerSeat === 0));
});

test("campaign deployments ignore ordinary COST, point limits and tag filters", () => {
  const kit = ctx.production.defaultKits;
  const armies = [
    Array.from({ length: 12 }, () => ({ unitId: "Type61", kitId: kit.Type61 })),
    [{ unitId: "MS_06F", kitId: kit.MS_06F }],
  ];
  const settings = {
    ...G.defaultRoomSettings(),
    mapId: "frontier_1v1",
    costLimit: 250,
    unitLimit: 3,
    unitCostLimit: 1,
    bannedFactions: ["EFSF", "ZEON"],
    bannedTypes: G.unitTags,
  };
  assert.throws(() => G.create(false, 1, structuredClone(armies), false, settings));
  const game = G.create(false, 1, structuredClone(armies), false, {
    ...settings,
    mode: "campaign",
  });
  assert.equal(game.units.length, 13);
});

test("Earth regions have reciprocal routes and campaign forces are independent of player profiles", () => {
  const state = C.create(ctx, players);
  assert.equal(state.rounds, 10);
  assert.equal(state.regions.length, 43);
  assert.equal(
    state.units.length,
    ctx.world.regions.reduce(
      (sum, region) => sum + (region.initialUnits ?? (region.factory ? 4 : 2)),
      0,
    ),
  );
  assert.equal(C.commander(players, 0), 0);
  assert.equal(C.commander(players, 1), 1);
  for (const region of ctx.world.regions)
    for (const next of region.links)
      assert(ctx.world.regions.find((region) => region.id === next).links.includes(region.id));
  const allied = state.units.find((unit) => unit.ownerSeat === 2);
  assert(C.controls(state, players, 0, allied));
  assert(!C.controls(state, players, 3, allied));
  assert(G.canControlUnit({ campaignCommanders: [0, 1] }, players, 0, { ownerSeat: 2, team: 0 }));
  assert(!G.canControlUnit({}, players, 0, { ownerSeat: 2, team: 0 }));
});

test("shared treasury reserves batch orders once, produces to the applicant and rotates slots", () => {
  const state = C.create(ctx, players);
  const before = state.teams[0].money,
    quote = C.quote(ctx, "Type61");
  const count = (seat) => state.units.filter((unit) => unit.ownerSeat === seat).length;
  const a = count(0),
    b = count(2);
  for (const seat of [0, 2])
    C.action(ctx, state, players, seat, {
      action: "campaign_produce",
      turn: state.turn,
      region: "jaburo",
      unitId: "Type61",
    });
  assert.equal(state.teams[0].money, before - quote.money * 2);
  C.advance(ctx, state, players);
  assert.equal(count(0), a + quote.quantity);
  assert.equal(count(2), b);
  C.advance(ctx, state, players);
  assert.equal(count(2), b + quote.quantity);
  assert.equal(state.orders.length, 0);
  assert.throws(
    () =>
      C.action(ctx, state, players, 1, {
        action: "campaign_produce",
        turn: state.turn,
        region: "jaburo",
        unitId: "Type61",
      }),
    /己方/,
  );
});

test("transfers need recipient acceptance and crossed enemy moves create one encounter", () => {
  const state = C.create(ctx, players);
  const own = state.units.find((unit) => unit.ownerSeat === 0);
  C.action(ctx, state, players, 0, { action: "campaign_transfer", turn: 1, ids: [own.id], to: 2 });
  assert.equal(own.ownerSeat, 0);
  assert.throws(
    () =>
      C.action(ctx, state, players, 0, {
        action: "campaign_accept_transfer",
        turn: 1,
        transferId: state.transfers[0].id,
        accept: true,
      }),
    /不存在/,
  );
  C.action(ctx, state, players, 2, {
    action: "campaign_accept_transfer",
    turn: 1,
    transferId: state.transfers[0].id,
    accept: true,
  });
  assert.equal(own.ownerSeat, 2);
  const a = state.units.find((unit) => unit.region === "canada"),
    b = state.units.find((unit) => unit.region === "new_york");
  a.moveTo = "new_york";
  b.moveTo = "canada";
  C.advance(ctx, state, players);
  assert.equal(a.region, b.region);
  assert(state.encounters.some((encounter) => encounter.region === a.region));
});

test("technology costs are spent from the campaign pool; invalid archived resources are rejected", () => {
  const state = C.create(ctx, players);
  const tech = ctx.development
    .nodes("EFSF")
    .find(
      (node) =>
        !state.teams[0].researched.includes(node.id) &&
        node.requires.every((id) => state.teams[0].researched.includes(id)),
    );
  state.teams[0].money = 100000;
  state.teams[0].supplies = 100000;
  state.teams[0].technology = 100000;
  C.action(ctx, state, players, 2, { action: "campaign_research", turn: 1, techId: tech.id });
  assert.equal(state.teams[0].money, 100000 - tech.money);
  assert.equal(state.teams[0].technology, 100000 - tech.points);
  assert(state.teams[0].researched.includes(tech.id));
  const invalid = structuredClone(state);
  invalid.teams[0].money = -1;
  assert.throws(() => C.validate(ctx, invalid, players), /阵营数据/);
  assert.equal(C.validate(ctx, state, players).units.length, state.units.length);
});

test("strategic transport orders keep passengers together and reject unauthorized carrier moves", () => {
  const state = C.create(ctx, players);
  const carrier = state.units.find((unit) => unit.ownerSeat === 0);
  const passenger = state.units.find((unit) => unit.ownerSeat === 2);
  passenger.region = carrier.region;
  carrier.state = { id: "carrier" };
  passenger.state = { id: "passenger", embarked: { carrierId: "carrier", hangarId: "cargo" } };
  const destination = ctx.world.regions.find((region) => region.id === carrier.region).links[0];
  assert.throws(
    () =>
      C.action(ctx, state, players, 2, {
        action: "campaign_move",
        turn: 1,
        ids: [passenger.id],
        region: destination,
      }),
    /控制者/,
  );
  C.action(ctx, state, players, 0, {
    action: "campaign_move",
    turn: 1,
    ids: [carrier.id],
    region: destination,
  });
  assert.equal(passenger.moveTo, destination);
  C.advance(ctx, state, players);
  assert.equal(passenger.region, carrier.region);
});

test("strategic re-equipment charges the native target equipment fee and cannot heal or bypass authority", () => {
  const state = C.create(ctx, players),
    unit = C.addUnit(ctx, state, 0, "jaburo", "RFF_06");
  const settings = G.campaignRoomSettings({ mapId: "frontier_1v1" });
  unit.state = structuredClone(
    G.create(false, 1, [[{ unitId: unit.unitId, kitId: unit.kitId }], null], false, settings)
      .units[0],
  );
  unit.state.hp = Math.floor(C.model(ctx, unit).hp / 2);
  unit.state.en = Math.floor(C.model(ctx, unit).en / 2);
  unit.state.weaponUses = { test: 2 };
  const treasury = state.teams[0].money;
  assert.deepEqual(C.equipmentQuote(ctx, unit, "kit_1"), { money: 150, supplies: 300 });
  const order = { action: "campaign_equip", turn: 1, armyId: unit.id, kitId: "kit_1", money: 0 };
  assert.throws(() => C.action(ctx, state, players, 1, order), /无权/);
  C.action(ctx, state, players, 0, order);
  assert.equal(state.teams[0].money, treasury - 150);
  assert.equal(unit.kitId, "kit_1");
  assert(unit.state.hp <= C.model(ctx, unit).hp / 2);
  assert(unit.state.en <= C.model(ctx, unit).en / 2);
  assert.deepEqual(unit.state.weaponUses, { test: 2 });
  assert.deepEqual(C.equipmentQuote(ctx, unit, "kit_0"), { money: 0, supplies: 0 });
  const before = structuredClone(state);
  assert.throws(() => C.action(ctx, state, players, 0, { ...order, kitId: "missing" }), /套件/);
  assert.deepEqual(state, before);
});

test("strategic skills share tactical transformations, preserve state and reject combat-only skills", () => {
  const state = C.create(ctx, players),
    unit = C.addUnit(ctx, state, 0, "jaburo", "Medea");
  const skill = C.model(ctx, unit).skills.find((item) => item.type === "transform");
  C.action(ctx, state, players, 0, {
    action: "campaign_unit_skill",
    turn: 1,
    armyId: unit.id,
    skillId: skill.id,
  });
  assert.equal(unit.unitId, "Medea_DeployState");
  assert.equal(unit.state.model, "Medea_DeployState__standard");
  assert.equal(unit.strategicSkillTurn, 1);
  const revert = C.model(ctx, unit).skills.find((item) => item.type === "transform");
  assert.throws(
    () =>
      C.action(ctx, state, players, 0, {
        action: "campaign_unit_skill",
        turn: 1,
        armyId: unit.id,
        skillId: revert.id,
      }),
    /已使用/,
  );
  const before = structuredClone(state);
  assert.throws(
    () =>
      C.action(ctx, state, players, 0, {
        action: "campaign_unit_skill",
        turn: 1,
        armyId: unit.id,
        skillId: "EMP",
      }),
    /局地战/,
  );
  assert.deepEqual(state, before);
});

test("encounter readiness advances to the next region only after the current battle checkpoints", () => {
  const { createCampaignRoom } = require("../shared/campaign-room.js");
  const Records = require("../shared/match-records.js");
  let id = 0;
  const members = [
    { id: "host", seat: 0 },
    { id: "guest", seat: 1 },
    { id: "watcher", seat: null },
  ];
  const state = C.create(ctx, members);
  C.addUnit(ctx, state, 1, "canada", "MS_06F");
  C.addUnit(ctx, state, 1, "jaburo", "MS_06F");
  state.phase = "encounters";
  state.encounters = ["canada", "jaburo"].map((region) => ({
    region,
    turn: 0,
    battleSave: null,
    roster: {},
    settled: [],
  }));
  const room = {
    campaign: state,
    seats: members.slice(0, 2),
    settings: { mode: "campaign" },
    started: false,
  };
  const adapter = createCampaignRoom({
    G,
    Records,
    randomId: () => "encounter-" + ++id,
    randomSeed: () => 1,
    members: () => members,
    planner: { reset() {}, resumeCharges() {} },
    log() {},
  });
  const first = adapter.view(room).preparation;
  assert.equal(first.region, "canada");
  assert.equal(first.participants.length, 2, "spectators never block readiness");
  const choose = (member, preparation, delegate = false) =>
    adapter.handle(room, member, {
      action: "campaign_enter",
      region: preparation.region,
      preparationId: preparation.id,
      delegate,
      mapId: "frontier_1v1",
    });
  assert.throws(() => choose(members[2], first), /观战者/);
  assert.throws(() => choose(members[0], { ...first, region: "jaburo" }), /准备已变化/);
  choose(members[0], first, true);
  assert.equal(room.started, false);
  assert.equal(adapter.view(room).preparation.region, "canada");
  choose(members[1], first);
  assert.equal(room.started, true);
  assert.equal(adapter.view(room).preparation, null);
  assert.deepEqual(room.campaignBattle.delegatedSeats, [0]);
  // End this segment without resolving the territory: it must not be selected again this turn.
  adapter.checkpoint(room);
  const next = adapter.view(room).preparation;
  assert.equal(next.region, "jaburo");
  assert.notEqual(next.id, first.id);
  assert(next.participants.every((player) => !player.ready));
  assert.throws(() => choose(members[0], first), /准备已变化/);
});

test("producing a kit cheaper than the default discounts the actual batch", () => {
  const state = C.create(ctx, players);
  state.teams[0].researched = ctx.development.nodes("EFSF").map((node) => node.id);
  const standard = C.quote(ctx, "RGM_79"),
    cheaper = C.quote(ctx, "RGM_79", "machine_gun");
  assert(cheaper.money < standard.money);
  assert(cheaper.supplies < standard.supplies);
  const before = { money: state.teams[0].money, supplies: state.teams[0].supplies };
  C.action(ctx, state, players, 0, {
    action: "campaign_produce",
    turn: state.turn,
    region: "jaburo",
    unitId: "RGM_79",
    kitId: "machine_gun",
  });
  assert.equal(before.money - state.teams[0].money, 1500);
  assert.equal(before.supplies - state.teams[0].supplies, 2300);
  assert.equal(state.orders[0].quantity, 3);
});

test("every purchase of a paid native kit costs again, including a cheaper factory configuration", () => {
  const state = C.create(ctx, players),
    unit = C.addUnit(ctx, state, 0, "jaburo", "RGM_79");
  const before = state.teams[0].supplies;
  const equip = (kitId) =>
    C.action(ctx, state, players, 0, { action: "campaign_equip", turn: 1, armyId: unit.id, kitId });
  assert.deepEqual(C.equipmentQuote(ctx, unit, "bazooka"), { money: 0, supplies: 200 });
  assert.deepEqual(C.equipmentQuote(ctx, unit, "beam_spray"), { money: 150, supplies: 300 });
  equip("bazooka");
  assert.equal(state.teams[0].supplies, before - 200);
  equip("beam_spray");
  assert.equal(state.teams[0].supplies, before - 500);
  equip("bazooka");
  assert.equal(state.teams[0].supplies, before - 700);
  const fee = ctx.production.nativeEquipmentCosts.RGM_79__bazooka;
  assert.equal(fee.sources[0].action, "action_Set_Equipment2");
  assert.equal(fee.sources[0].seconds, 3);
});

test("every imported multi-kit model has an archived equipment action price", () => {
  for (const prefab of G.catalog.prefabs.filter((prefab) => prefab.weaponKits.length > 1)) {
    for (const kit of prefab.weaponKits) {
      const key = prefab.id + "__" + kit.id;
      const fee = ctx.production.nativeEquipmentCosts[key];
      assert(fee, key);
      assert(
        [fee.money, fee.supplies].every((value) => Number.isFinite(value) && value >= 0),
        key,
      );
      assert(
        fee.sources.length > 0 &&
          fee.sources.every(
            (source) => source.file && source.action.startsWith("action_Set_Equipment"),
          ),
        key,
      );
    }
  }
});

test("legacy 20-region campaigns retain armies, resources and control on the expanded Earth map", () => {
  const state = C.create(ctx, players);
  const legacy = new Set(ctx.world.legacyRegionIds);
  state.regions = state.regions.filter((region) => legacy.has(region.id));
  state.units = state.units.filter((unit) => legacy.has(unit.region));
  delete state.geographyVersion;
  state.regions.find((region) => region.id === "canada").owner = 1;
  const moving = state.units.find((unit) => unit.region === "jaburo");
  moving.moveTo = "dakar"; // Direct transatlantic route from the original prototype.
  const armies = structuredClone(state.units),
    treasury = structuredClone(state.teams);
  const imported = C.validate(ctx, state, players);
  assert.equal(imported.regions.length, 43);
  assert.equal(imported.geographyVersion, 2);
  assert.equal(imported.regions.find((region) => region.id === "canada_east").owner, 1);
  assert.deepEqual(imported.teams, treasury);
  assert.equal(imported.units.length, armies.length);
  assert.equal(imported.units.find((unit) => unit.id === moving.id).moveTo, null);
  assert.deepEqual(
    imported.units.map(({ moveTo, ...unit }) => unit),
    armies.map(({ moveTo, ...unit }) => unit),
  );
  assert.equal(state.regions.length, 20, "import validation does not mutate the supplied archive");
  assert(imported.history.at(-1).includes("战略地图已升级"));
});

test("Earth geography has bounded coastline paths and a fully connected reciprocal route graph", () => {
  assert(ctx.world.landPath.length > 10000);
  const seen = new Set(),
    queue = [ctx.world.regions[0].id];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const region = ctx.world.regions.find((region) => region.id === id);
    assert(region.path.startsWith("M"), id);
    assert(!/NaN|Infinity/.test(region.path), id);
    assert(region.center.every(Number.isFinite), id);
    assert(region.center[0] >= 0 && region.center[0] <= ctx.world.width, id);
    assert(region.center[1] >= 0 && region.center[1] <= ctx.world.height, id);
    for (const next of region.links) {
      assert.notEqual(next, id);
      assert(ctx.world.regions.find((region) => region.id === next).links.includes(id));
      queue.push(next);
    }
  }
  assert.equal(seen.size, ctx.world.regions.length);
  for (const id of [
    "america",
    "kazakhstan",
    "russia_east",
    "north_atlantic",
    "south_atlantic",
    "indian_ocean",
    "south_pacific",
  ])
    assert(seen.has(id));
});
