const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  S = require("../shared/sweep-mode"),
  { createRoomEngine } = require("../shared/room-engine");
function fixture(t, era = "0079T2", faction = "ZEON", environment = "ground") {
  let serial = 0,
    failCreate = false;
  const rules = {
    ...G,
    create(...args) {
      if (failCreate) throw Error("injected creation failure");
      return G.create(...args);
    },
  };
  const engine = createRoomEngine({
    rules,
    randomId: () => "launch-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: () => {},
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "SWEEP-LAUNCH",
    roomMode: "sweep",
    characterFaction: "PMC",
    licenses: { PegasusClass: true },
    inventory: { PegasusClass: 5 },
  });
  const room = engine.rooms.get("SWEEP-LAUNCH");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: "request-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  act("configure_room", {
    ...room.settings,
    battleMode: "sweep",
    sweepEra: era,
    sweepFaction: faction,
    sweepEnvironment: environment,
    costLimit: 1500,
  });
  act("start_game", { formation: [{ unitId: "PegasusClass", kitId: "standard" }] });
  act("confirm_formation");
  assert.equal(room.phase, "sweep_map");
  act("sweep_select", { nodeId: "0:1" });
  return {
    room,
    act,
    engine,
    setFailure: (value) => {
      failCreate = value;
    },
  };
}
test("small sweep rooms can enter battle for every offered faction/era on land and in space", (t) => {
  for (const era of G.eras)
    for (const faction of S.factionsForEra(G, era))
      for (const environment of ["ground", "space"]) {
        const { room, act } = fixture(t, era, faction, environment);
        act("sweep_confirm");
        assert.equal(room.phase, "deployment", era + "/" + faction + "/" + environment);
        assert.equal(G.getMap(room.game.mapId).environment, environment);
        assert(room.game.units.some((u) => u.team === 1));
        const enemyUnits = room.game.units.filter((u) => u.team === 1);
        assert(
          enemyUnits.every(
            (u) => G.isFleetCarrier(G.modelOf(u)) || G.modelOf(u).tags.includes(era),
          ),
        );
        assert(
          enemyUnits.some((u) => G.isFleetCarrier(G.modelOf(u)) && !u.embarked),
          era + "/" + faction + "/" + environment,
        );
        assert(
          enemyUnits.some((u) => u.embarked && !G.isFleetCarrier(G.modelOf(u))),
          era + "/" + faction + "/" + environment,
        );
      }
});
test("failed creation restores selected node, roster, seats and game, then the same node can be retried", (t) => {
  const { room, act, setFailure } = fixture(t);
  const before = structuredClone(room.sweep),
    game = room.game,
    mapId = room.settings.mapId;
  const seats = room.seats.map((p) => p && [p.id, p.seat, p.ws?.seat, p.formation]);
  setFailure(true);
  assert.throws(() => act("sweep_confirm"), /injected creation failure/);
  assert.equal(room.phase, "sweep_map");
  assert.equal(room.game, game);
  assert.equal(room.settings.mapId, mapId);
  assert.deepEqual(room.sweep, before);
  assert.deepEqual(
    room.seats.map((p) => p && [p.id, p.seat, p.ws?.seat, p.formation]),
    seats,
  );
  setFailure(false);
  act("sweep_confirm");
  assert.equal(room.phase, "deployment");
  assert.equal(room.sweep.battleIndex, 1);
});

test("successive sweep battles replace deployment confirmations and retain only living roster state", (t) => {
  const { room, act, engine } = fixture(t, "UC_0079_T2");
  for (let node = 0; node < 4; node++) {
    if (node) {
      const next = room.sweep.nodes.find((n) => S.view(room, room.hostId).reachable.includes(n.id));
      next.type = "battle";
      act("sweep_select", { nodeId: next.id });
    }
    act("sweep_confirm");
    assert.equal(room.phase, "deployment");
    assert.equal(room.game.deployment[0], false);
    assert.equal(room.game.deployment[1], true);
    assert.equal(room.sweep.battleIndex, node + 1);
    G.autoPlaceDeployment(room.game, 0);
    act("confirm_deployment");
    assert.equal(room.phase, "idle");
    room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
    room.game.winner = 0;
    room.phase = "finished";
    engine.broadcast(room);
    assert.equal(room.phase, "sweep_map");
    assert.equal(room.playback, null);
  }
});

test("sweep fleets mix affordable chassis and embark every non-carrier", () => {
  const room = {
    settings: {
      ...G.defaultRoomSettings(),
      mode: "sweep",
      sweepEra: "UC_0079_T1",
      sweepFaction: "ZEON",
      sweepEnvironment: "ground",
      costLimit: 10000,
    },
    seats: [{ seat: 0 }, { seat: 1, sweepEnemy: true }],
    sweep: { depth: 0 },
  };
  room.settings.mapId = S.mapPool(room, G)[0].id;
  for (const seed of [1, 7319, 98765]) {
    const army = S.enemies(room, G, seed);
    assert(new Set(army.filter((e) => e.preload).map((e) => e.unitId)).size >= 2);
    assert(army.every((e) => G.isFleetCarrier(G.formationModel(e)) || e.preload));
    const plan = G.planFormation(
      army,
      S.enemyLimits(room, G).costLimit,
      { ...S.enemyRestrictions(room, G), unitCostLimit: S.enemyLimits(room, G).unitCostLimit },
      G.catalog.formation.maxUnits,
    );
    assert.deepEqual(plan.reasons, {});
  }
});
test("enemy generation respects map placement and minimum budget across seeds and boss stages", () => {
  for (const environment of ["ground", "space"]) {
    const room = {
      settings: {
        ...G.defaultRoomSettings(),
        mode: "sweep",
        sweepEra: "0087T2",
        sweepFaction: "AEUG",
        sweepEnvironment: environment,
        costLimit: 1500,
      },
      seats: [{ seat: 0 }, { seat: 1, sweepEnemy: true }],
      sweep: { depth: 0 },
    };
    for (const map of S.mapPool(room, G))
      for (const seed of [1, 7319, 98765])
        for (const stage of ["battle", "elite", "boss"]) {
          room.settings.mapId = map.id;
          room.sweep.elite = stage === "elite";
          room.sweep.boss = stage === "boss";
          const limits = S.enemyLimits(room, G),
            army = S.enemies(room, G, seed);
          assert(army.length);
          assert(army.reduce((sum, e) => sum + G.formationModel(e).cost, 0) <= limits.costLimit);
          assert(
            G.deploymentPlacements(
              { mapId: map.id, tiles: map.tiles, environment, units: [] },
              army,
              1,
            ),
          );
        }
  }
});
