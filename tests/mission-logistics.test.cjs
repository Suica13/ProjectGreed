const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  D = require("../shared/development"),
  E = require("../shared/economy"),
  S = require("../shared/sweep-mode"),
  R = require("../shared/battle-economy");
const { createRoomEngine } = require("../shared/room-engine");
const carrier = { unitId: "Medea", kitId: "standard" },
  tank = {
    unitId: "Type61",
    kitId: "standard",
    preload: { carrierIndex: 0, hangarId: "Hangar_1" },
  };
function source(count = 1) {
  return [carrier, ...Array.from({ length: count }, () => tank)].map((entry, key) => ({
    key,
    entry: structuredClone(entry),
    state: S.save(G.makeUnit(entry, 0, "unit-" + key, { x: 0, y: 0 })),
  }));
}
const options = () => ({
  budget: 5000,
  unitLimit: 18,
  restrictions: { requiresCarriers: true },
  inventory: { Medea: 5, Type61: 20 },
});
function fixture(t, mode = "sweep", getRewardMultipliers = () => ({})) {
  let n = 0;
  const messages = [];
  const engine = createRoomEngine({
    rules: G,
    getRewardMultipliers,
    randomId: () => String(++n),
    randomToken: () => String(++n),
    randomSeed: () => 7319,
    send: (_, m) => messages.push(m),
    aiDelayMs: 999999,
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "LOGISTICS",
    roomMode: mode,
    characterFaction: "PMC",
    licenses: { Medea: true, Type61: true },
    inventory: { Medea: 5, Type61: 20 },
  });
  const room = engine.rooms.get("LOGISTICS");
  const act = (action, data = {}, id) =>
    engine.action(ws, {
      id: id || "req-" + ++n,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...data,
    });
  return { engine, room, act, messages };
}
test("new reward endpoints and every final award align to 25, including quick and drawn research", () => {
  assert.deepEqual(R.calculateBattleReward(1500), { money: 2000, supplies: 3000, technology: 500 });
  assert.deepEqual(R.calculateBattleReward(99999), {
    money: 10000,
    supplies: 15000,
    technology: 1000,
  });
  for (let cost = 0; cost < 25000; cost += 137)
    for (const value of Object.values(R.calculateBattleReward(cost))) assert.equal(value % 25, 0);
  assert.equal(R.rewardMultiplier, 1);
  assert.equal(R.technologyReward(null, "regular"), 500);
  assert.equal(R.technologyReward(true, "regular"), 550);
  assert.equal(R.technologyReward(false, "regular"), 550);
  assert.equal(R.technologyReward(true, "quick"), 50);
  for (let era = 0; era < 4; era++)
    for (const [cost, base] of [
      [1500, [5000, 7500, 1000]],
      [20000, [15000, 22500, 2000]],
    ]) {
      const settings = {
          costLimit: cost,
          battlefieldTeams: [{ era: G.battlefieldMode.eras[era] }],
        },
        reward = G.battlefieldMode.baseReward(settings, 0);
      assert.deepEqual(
        Object.values(reward),
        base.map((n) => R.roundReward(n * 1.25 ** era)),
      );
    }
});
test("routes insert a boss every fifth node and force branching within three stages", () => {
  for (let seed = 0; seed < 50; seed++) {
    const nodes = S.rows(seed, 0, 50);
    for (const node of nodes) {
      if (node.depth % 5 === 4) assert.equal(node.type, "boss");
      if (node.depth % 3 === 2) assert(node.next.length >= 2);
      assert(node.next.length > 0);
      for (const id of node.next) {
        const [depth, lane] = id.split(":").map(Number);
        assert.equal(depth, node.depth + 1);
        assert(Math.abs(lane - node.lane) <= 1, "routes cannot connect opposite edges");
        if (depth < 50) assert(nodes.some((next) => next.id === id));
      }
    }
  }
});
test("node resources grow linearly and capture event multipliers; boss loot stays in its era without ships", () => {
  const room = {
    settings: { costLimit: 20000, unitCostLimit: 2000, sweepEra: "0079T1" },
    seats: [{ id: "p", seat: 0 }],
    sweep: {
      seed: 7319,
      depth: 0,
      pending: { p: { money: 0, supplies: 0, technology: 0, inventory: {} } },
      rewardMultipliers: { money: 2, supplies: 1, technology: 1 },
    },
  };
  for (let depth = 0; depth < 3; depth++) {
    room.sweep.depth = depth;
    S.reward(room, G);
  }
  assert.equal(room.sweep.pending.p.money, 6300);
  assert.equal(room.sweep.pending.p.supplies, 6300);
  const elite = S.enemyLimits({ ...room, sweep: { ...room.sweep, elite: true } }, G);
  room.sweep.boss = true;
  const boss = S.enemyLimits(room, G);
  assert(boss.costLimit > elite.costLimit);
  const pool = S.rewardPool(room, G);
  assert(pool.every((u) => !G.catalog.prefabs.find((p) => p.id === u.id).tags.includes("0093T1")));
  assert(pool.every((u) => !G.isFleetCarrier(G.models[E.defaultModel(u.id)])));
  S.reward(room, G, 3, 5);
  assert.equal(
    Object.values(room.sweep.pending.p.inventory).reduce((a, b) => a + b, 0),
    5,
  );
});
test("restock drafts enforce each quota, stock, capacity, COST, pilot uniqueness and quarter supplies without mutation", () => {
  const initial = source(),
    before = structuredClone(initial),
    op = { type: "add", entry: tank };
  const plan = S.restockPlan(G, initial, [op, op, op], options());
  assert.equal(plan.roster.length, 5);
  assert.equal(plan.used.add, 3);
  assert.equal(
    plan.cost.supplies,
    3 * Math.ceil(E.productionOffer("Type61", "standard").supplies / 4),
  );
  assert.deepEqual(initial, before);
  assert.throws(() => S.restockPlan(G, initial, [op, op, op, op], options()), /最多3次/);
  assert.throws(
    () => S.restockPlan(G, initial, [op], { ...options(), inventory: { Medea: 1, Type61: 1 } }),
    /库存/,
  );
  assert.throws(() => S.restockPlan(G, initial, [op], { ...options(), budget: 300 }), /COST/);
  assert.throws(() => S.restockPlan(G, initial, [op, op], { ...options(), unitLimit: 3 }), /容量/);
  const pilot = G.pilots.createCustom("custom-logistics-pilot", "PMC", null, "PMC");
  const assigned = S.restockPlan(G, initial, [{ type: "assign", key: 1, pilot }], options());
  assert.equal(assigned.cost.money, 500);
  assert.equal(assigned.roster[1].entry.customPilot.id, pilot.id);
  assert.throws(
    () =>
      S.restockPlan(
        G,
        initial,
        [
          { type: "assign", key: 0, pilot },
          { type: "assign", key: 1, pilot },
        ],
        options(),
      ),
    /驾驶员/,
  );
  const dismissed = S.restockPlan(G, assigned.roster, [{ type: "dismiss", key: 1 }], options());
  assert.equal(dismissed.cost.money, 500);
  assert.equal(dismissed.roster[1].entry.customPilot, undefined);
  const returned = S.restockPlan(G, initial, [{ type: "remove", key: 1 }], options());
  assert.equal(returned.roster.length, 1);
  assert.equal(
    returned.cost.supplies,
    Math.ceil(E.productionOffer("Type61", "standard").supplies / 4),
  );
});
test("restock server cancel is free, final commit is atomic and cannot be charged twice", (t) => {
  const { room, act, messages } = fixture(t);
  act("start_game", { formation: [carrier, tank] });
  act("confirm_formation");
  assert.equal(room.phase, "sweep_map");
  room.sweep.nodes.find((n) => n.depth === 0).type = "rest";
  act("sweep_select", { nodeId: "0:0" });
  act("sweep_confirm");
  act("sweep_event", { choice: 1 });
  assert.equal(room.phase, "sweep_resupply");
  const player = room.seats[0],
    prior = JSON.stringify(room.sweep.rosters[player.id]);
  act("sweep_restock_cancel");
  assert.equal(room.phase, "sweep_event");
  assert.equal(JSON.stringify(room.sweep.rosters[player.id]), prior);
  act("sweep_event", { choice: 1 });
  room.sweep.pending[player.id].supplies = 10000;
  const op = { type: "add", entry: tank };
  assert.throws(() => act("sweep_restock_commit", { operations: [op, op, op, op] }), /最多3次/);
  assert.equal(JSON.stringify(room.sweep.rosters[player.id]), prior);
  assert.equal(room.sweep.pending[player.id].supplies, 10000);
  act("sweep_restock_commit", { operations: [op] }, "commit-once");
  const balance = room.sweep.pending[player.id].supplies;
  assert.equal(room.sweep.rosters[player.id].length, 3);
  assert(balance < 10000);
  act("sweep_restock_commit", { operations: [op] }, "commit-once");
  assert.equal(room.sweep.pending[player.id].supplies, balance);
  act("sweep_resupply_done");
  assert.equal(room.phase, "sweep_map");
  assert(messages.some((m) => m.type === "state"));
});
test("technology caps reject owned high technology and no-tree units, while faction allies are exempt", (t) => {
  const caps = Object.fromEntries(D.factions.map((f) => [f, 0]));
  assert(D.allowsPointCaps("Type61", caps));
  assert(!D.allowsPointCaps("RGM_79", caps));
  assert(!D.allowsPointCaps("RX_93", Object.fromEntries(D.factions.map((f) => [f, 999999]))));
  const settings = { ...G.defaultRoomSettings(), mode: "battlefield", technologyCaps: caps };
  assert.equal(
    G.restrictionReason(G.models[E.defaultModel("RGM_79")], {
      technologyCaps: caps,
      licenses: { RGM_79: true },
      inventory: { RGM_79: 9 },
    }),
    "technology_limit",
  );
  assert.equal(
    G.armyRestrictions(settings, { bot: true, battlefieldAI: true }).technologyCaps,
    undefined,
  );
  const { room, act } = fixture(t, "battlefield");
  assert.equal(room.seats.length, 12);
  assert.deepEqual(
    G.getMap(room.settings.mapId)
      .spawns.filter((s) => !s.fixedAlly && s.team === 0)
      .map((s) => s.position),
    [1, 2, 3, 4, 5],
  );
  act("configure_room", {
    ...room.settings,
    battleMode: "battlefield",
    technologyLimitMode: "custom",
    technologyLimit: 2500,
  });
  assert.equal(room.settings.technologyLimit, 2500);
});
test("faction allies do not consume any of the ten human positions or lobby capacity", (t) => {
  const { engine, room } = fixture(t, "battlefield");
  for (let i = 0; i < 9; i++)
    engine.join({ readyState: 1 }, { mode: "join", room: "LOGISTICS", characterFaction: "PMC" });
  assert.equal(room.seats.filter((p) => p && !p.bot).length, 10);
  for (const team of [0, 1])
    assert.equal(room.seats.filter((p) => p && !p.bot && p.seat % 2 === team).length, 5);
  assert.equal(engine.roomList()[0].players, 10);
  assert.equal(engine.roomList()[0].capacity, 10);
});

test("war and sweep use era availability instead of host research caps", () => {
  const caps = Object.fromEntries(D.factions.map((f) => [f, 0]));
  const first = G.models[E.defaultModel("Medea")];
  const later = G.models[E.defaultModel("SalamisClassLateType")];
  for (const mode of ["battlefield", "sweep"]) {
    const settings = { ...G.defaultRoomSettings(), mapId: null, mode, technologyCaps: caps,
      battlefieldEra: "0079T1", sweepEra: "0079T1" };
    const player = { seat: 2, characterFaction: "PMC", licenses: { Medea: true, SalamisClassLateType: true },
      inventory: { Medea: 5, SalamisClassLateType: 5 } };
    const rules = G.armyRestrictions(settings, player);
    assert.equal(rules.technologyCaps, undefined);
    assert.equal(G.restrictionReason(first, rules), null);
    assert.equal(G.restrictionReason(later, rules), "not_allowed");
    const next = G.armyRestrictions({ ...settings, battlefieldEra: "0079T2", sweepEra: "0079T2" }, player);
    assert.equal(G.restrictionReason(first, next), null, "earlier carriers remain usable");
    assert.equal(G.restrictionReason(later, next), null);
    const ai = G.armyRestrictions(settings, { seat: 3, bot: true, characterFaction: "ZEON", researched: [] });
    assert.equal(ai.ignoreDevelopment, true);
    assert.equal(ai.technologyCaps, undefined);
    assert.deepEqual(ai.allowedEras, ["0079T1"]);
  }
  assert.equal(G.armyRestrictions({ ...G.defaultRoomSettings(), technologyCaps: caps }, {}).technologyCaps, caps);
  assert.equal(G.armyRestrictions({ ...G.defaultRoomSettings(), mode: "battlefield" }, { battlefieldAI: true }).allowedEras, undefined);
  for (const era of G.eras) {
    for (const faction of S.factionsForEra(G, era)) assert(G.catalog.prefabs.some(p =>
      !p.wip && !p.formOnly && !p.facility && p.faction === faction && p.tags.includes(era)));
  }
});

test("server rejects custom war scales and enforces era availability at assembly", (t) => {
  const { room, act, engine, messages } = fixture(t, "battlefield");
  assert.equal(room.settings.battlefieldEra, "0079T1");
  assert.throws(() => act("configure_room", { ...room.settings, battlefieldEra: "custom" }));
  assert.throws(() => act("configure_room", { ...room.settings, costLimit: 1525 }));
  assert.throws(() => act("configure_room", { ...room.settings, battlefieldTeams: [
    { faction: "AEUG", era: "0087T1" }, { faction: "ZEON", era: "0079T1" }] }));
  engine.broadcast(room);
  assert.equal(messages.findLast(m => m.type === "state").settings.technologyCaps, undefined);
  const host = room.seats.find(p => p && !p.bot);
  host.inventory.SalamisClassLateType = 5;
  host.licenses.SalamisClassLateType = true;
  act("start_game", { formation: [{unitId: "SalamisClassLateType", kitId: "standard"}, carrier, {...tank,preload:{carrierIndex:1,hangarId:"Hangar_1"}}] });
  assert.equal(room.phase, "assembly");
  act("confirm_formation");
  assert(room.started);
  const deployed = room.game.units.filter(u => u.ownerSeat === host.seat);
  assert(deployed.length > 0);
  assert(deployed.every(u => G.modelOf(u).tags.includes("0079T1")));
});

test("host research selection supplies one shared cap instead of per-faction balances", (t) => {
  const { engine, room, act, messages } = fixture(t, "regular");
  const host = room.seats[0];
  host.technologyPoints = D.normalizeTechnologyPoints({EFSF:5000,ZEON:100,AEUG:200});
  const caps = () => messages.findLast((m)=>m.type === "state").settings.technologyCaps;
  engine.broadcast(room);
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,5000])));
  act("configure_room",{...room.settings,technologyLimitFaction:"ZEON"});
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,100])));
  assert.throws(()=>act("configure_room",{...room.settings,technologyLimitFaction:"PMC"}),/参考阵营无效/);
  assert.equal(room.settings.technologyLimitFaction,"ZEON");
  act("configure_room",{...room.settings,technologyLimitMode:"custom",technologyLimit:2500});
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,2500])));
  act("configure_room",{...room.settings,technologyLimitMode:"host",technologyLimitFaction:"EFSF"});
  act("add_ai",{seat:1});
  act("start_game",{formation:[carrier,tank]});
  act("confirm_formation");
  assert(room.started);
  assert.deepEqual(room.technologyCapSnapshot,Object.fromEntries(D.factions.map(f=>[f,5000])));
  host.technologyPoints.EFSF=9999;
  engine.broadcast(room);
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,5000])));
});
test("extraction never reapplies changed activity multipliers to accumulated node receipts", (t) => {
  let multiplier = 2;
  const { room, act } = fixture(t, "sweep", () => ({
    money: multiplier,
    supplies: multiplier,
    technology: multiplier,
  }));
  act("start_game", { formation: [carrier, tank] });
  act("confirm_formation");
  const player = room.seats[0];
  room.sweep.depth = 0;
  room.sweep.rewardMultipliers = { money: 2, supplies: 2, technology: 2 };
  S.reward(room, G);
  assert.equal(room.sweep.pending[player.id].money, 2000);
  multiplier = 10;
  act("sweep_extract");
  const award = room.economyAwards.find((a) => a.kind === "result" && a.memberId === player.id);
  assert.equal(award.money, 2000);
  assert.equal(award.supplies, 4000);
});
