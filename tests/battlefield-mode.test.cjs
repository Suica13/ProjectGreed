const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules");
const B = G.battlefieldMode;
const Economy = require("../shared/economy.js");
const { createRoomEngine } = require("../shared/room-engine");
test("every offered faction and era has an initial force inside the selected year", () => {
  for (const faction of B.factions) for (const era of B.erasForFaction(G, faction)) {
    const selection = B.teams(G, [{faction, era}, {faction, era}]);
    const result = B.pool(G, {teams:selection, completed:0, wave:0}, 0);
    assert(result.choices.length > 0, faction + "/" + era);
    assert.equal(result.era.slice(0, 4), era.slice(0, 4));
    assert(result.choices.every(entry => G.models[entry.unitId + "__" + entry.kitId].tags.some(
      tag => tag.startsWith(era.slice(0, 4)))));
  }
});

test("0079 fixed waves scale every contingent by surviving bases and honor exact phase boundaries", () => {
  for (const faction of B.factions) for (const era of B.erasForFaction(G,faction)) for (const round of [1, 9, 10, 50, 51, 100]) {
    const stage = B.waveStage(round), row = B.fixedWaves[era][stage];
    const entries = B.wavePlan(G, { faction, era }, round, 2, () => 0.99);
    for (const [id, count] of Object.entries(row[faction]))
      assert.equal(entries.filter(entry => entry.unitId === id && entry.group.endsWith(":" + id)).length, count * 2);
    assert.equal(entries.filter(entry => entry.group.endsWith(":random-ms")).length, row.randomMS * 2);
    assert.equal(entries.filter(entry => entry.group.endsWith(":ship")).length, 0);
    const ships = B.wavePlan(G, { faction, era }, round, 2, () => 0);
    assert.equal(ships.filter(entry => entry.group.endsWith(":ship")).length, 2);
  }
  assert.equal(B.waveStage(9), "early"); assert.equal(B.waveStage(10), "middle");
  assert.equal(B.waveStage(50), "middle"); assert.equal(B.waveStage(51), "late");
  assert.throws(() => B.teams(G, [{ faction: "EFSF", era: "0087T1" }, { faction: "ZEON", era: "0079T1" }]));
  assert(B.eras.includes("0087T1") && B.factions.includes("AEUG"));
});
function game() {
  const armies = Array(12).fill(null);
  armies[2] = [{ unitId: "Type61", kitId: "standard" }];
  return G.create(false, 7319, armies, false, { mode: "battlefield", mapId: B.defaultMapId });
}
test("dedicated battlefield map creates six reusable facility types for each team", () => {
  const g = game();
  assert.equal(g.units.filter((unit) => unit.facility).length, 12);
  for (const team of [0, 1])
    assert.equal(
      new Set(
        g.units
          .filter((unit) => unit.team === team && unit.facility)
          .map((unit) => unit.facility.type),
      ).size,
      6,
    );
  assert.equal(g.battlefield.points.length, 4);
  assert.deepEqual(g.battlefield.strength, [20000, 20000]);
  assert(g.units.filter((unit) => unit.facility).every((unit) => G.modelOf(unit).move === 0));
  assert(g.units.filter(unit => unit.facility?.type === "base").every(unit => unit.hp === 300000));
  assert(g.units.filter(unit => ["machineGun", "beam", "missile", "cannon"].includes(unit.facility?.type))
    .every(unit => unit.hp === 25000));
  assert.throws(() =>
    G.create(false, 1, [null, null], false, { mode: "battlefield", mapId: "frontier_1v1" }),
  );
  assert.throws(() =>
    G.create(false, 1, Array(10).fill(null), false, { mode: "regular", mapId: B.defaultMapId }),
  );
});

test("PMC casualties repair on campaign production timing, deploy next round and can suffer repeated losses", () => {
  const g = game(), state = g.battlefield, original = g.units.find(unit => !unit.facility);
  const reserve = state.reserves[0], site = B.deploymentSites(G, g, 0)[0];
  assert.throws(() => B.requestDeployment(G, g, 2, reserve.id, site.id), /阵亡/);
  original.hp = 0;
  B.sync(G, g);
  const loss = G.modelOf(original).cost;
  assert.equal(reserve.readyRound, g.round + Economy.productionTiming(reserve.unitId, reserve.kitId).turns);
  assert.throws(() => B.requestDeployment(G, g, 2, reserve.id, site.id), /维修/);
  g.round = reserve.readyRound;
  assert.throws(() => B.requestDeployment(G, g, 4, reserve.id, site.id), /自己/);
  assert.throws(() => B.requestDeployment(G, g, 2, reserve.id, "base:enemy"), /己方/);
  B.requestDeployment(G, g, 2, reserve.id, site.id);
  const before = g.units.length;
  B.advance(G, g);
  assert.equal(g.units.length, before);
  assert.throws(() => B.requestDeployment(G, g, 2, reserve.id, site.id), /已申请/);
  g.round++;
  B.advance(G, g);
  const restored = g.units.find(unit => unit.id.startsWith("pmc-airdrop-"));
  assert(restored && restored.hp === G.modelOf(restored).hp && G.fits(g, restored));
  assert.equal(restored.ownerSeat, original.ownerSeat);
  assert.equal(restored.formationIndex, original.formationIndex);
  assert.deepEqual(restored.pilot, original.pilot);
  assert.equal(restored.airdropRound, g.round);
  assert.equal(reserve.readyRound, null);
  B.advance(G, g);
  assert.equal(g.units.length, before + 1);
  restored.hp = 0; B.sync(G, g);
  assert.equal(state.losses[0], loss * 2);
  assert.equal(reserve.readyRound, g.round + reserve.repairTurns);
});

test("a captured destination cancels deployment; occupied landing cells wait without overwriting units", () => {
  const g = game(), state = g.battlefield, reserve = state.reserves[0];
  g.units.find(unit => !unit.facility).hp = 0;
  B.sync(G, g); g.round = reserve.readyRound;
  const point = state.points[0]; point.owner = 0;
  const siteId = "point:" + point.id;
  B.requestDeployment(G, g, 2, reserve.id, siteId);
  g.round++; point.owner = 1; B.advance(G, g);
  assert.equal(reserve.request, null);
  assert(reserve.readyRound <= g.round);
  point.owner = 0;
  B.requestDeployment(G, g, 2, reserve.id, siteId);
  g.round++;
  const count = g.units.length;
  B.advance({ ...G, placementQuery: () => ({ fits: () => false, include() {} }) }, g);
  assert.equal(g.units.length, count);
  assert(reserve.request);
  B.advance(G, g);
  assert.equal(g.units.length, count + 1);
  assert.equal(reserve.request, null);
});

test("surviving escape components prevent duplicate chassis repair", () => {
  const g = game(), original = g.units.find(unit => !unit.facility), reserve = g.battlefield.reserves[0];
  original.hp = 0;
  const escape = { ...structuredClone(original), id: original.id + "-escape-1", hp: 100 };
  g.units.push(escape); B.sync(G, g);
  assert.equal(reserve.readyRound, null);
  escape.hp = 0; B.sync(G, g);
  assert(reserve.readyRound > g.round);
});
test("unit losses count once and base damage deducts the same percentage of initial strength", () => {
  const g = game(),
    tank = g.units.find((unit) => !unit.facility),
    base = g.units.find((unit) => unit.facility?.type === "base" && unit.team === 0);
  tank.hp = 0;
  base.hp *= 0.75;
  B.sync(G, g);
  assert.equal(g.battlefield.strength[0], 15000 - G.modelOf(tank).cost);
  const expected = structuredClone(g.battlefield.strength);
  B.sync(G, g);
  assert.deepEqual(g.battlefield.strength, expected);
  base.hp = G.modelOf(base).hp;
  B.sync(G, g);
  assert.equal(base.hp, G.modelOf(base).hp * 0.75);
  assert.deepEqual(g.battlefield.strength, expected);
});
test("a destroyed base wins despite surviving defenders; zero strength and time limit also decide results", () => {
  const g = game();
  g.units.find((unit) => unit.facility?.type === "base" && unit.team === 1).hp = 0;
  B.sync(G, g);
  assert.equal(g.winner, 0);
  const zero = game();
  zero.battlefield.losses[0] = 20000;
  B.sync(G, zero);
  assert.equal(zero.winner, 1);
  const timed = game();
  timed.battlefield.completed = 100;
  timed.battlefield.losses[1] = 25;
  B.sync(G, timed);
  assert.equal(timed.winner, 0);
  const tie = game();
  tie.battlefield.completed = 100;
  B.sync(G, tie);
  assert.equal(tie.winner, -1);
});
test("maps support multiple main bases and proportional aggregate base damage", () => {
  const map = G.getMap(B.defaultMapId),
    original = structuredClone(map.battlefield.facilities);
  try {
    map.battlefield.facilities.push({ id: "second-base", type: "base", team: 1, x: 60, y: 34 });
    const g = game(),
      bases = g.units.filter((unit) => unit.team === 1 && unit.facility?.type === "base");
    bases[0].hp = 0;
    B.sync(G, g);
    assert.equal(g.winner, null);
    assert.equal(g.battlefield.strength[1], 10000);
    bases[1].hp = 0;
    B.sync(G, g);
    assert.equal(g.winner, 0);
  } finally {
    map.battlefield.facilities = original;
  }
});
test("neutral capture is proximity based, contested sites do not change owner, previews do not capture", () => {
  const g = game(),
    point = g.battlefield.points[0],
    unit = g.units.find((unit) => !unit.facility);
  Object.assign(unit, { x: point.x, y: point.y, pendingMove: { x: point.x, y: point.y } });
  B.captureNearby(G, g);
  assert.equal(point.owner, null);
  delete unit.pendingMove;
  B.captureNearby(G, g);
  assert.equal(point.owner, 0);
  const enemy = G.makeUnit({ unitId: "MS_06F", kitId: "machine_gun" }, 1, "capture-enemy", point);
  g.units.push(enemy);
  B.captureNearby(G, g);
  assert.equal(point.owner, 0);
  unit.x = 0;
  unit.y = 0;
  B.captureNearby(G, g);
  assert.equal(point.owner, 1);
});
test("fixed waves include the first force, selected-era pools and idempotent later reinforcement", () => {
  const g = game();
  assert.equal(g.battlefield.wave, 1);
  const initial = g.units.filter(unit => unit.ownerSeat === 0 && !unit.facility);
  assert(initial.length >= 12);
  g.round = 6; B.advance(G, g);
  assert.equal(g.battlefield.wave, 2);
  const count = g.units.length;
  B.advance(G, g);
  assert.equal(g.units.length, count);
  for (const team of [0, 1]) {
    const available = B.pool(G, g.battlefield, team);
    assert.equal(available.era, "0079T2");
    assert(available.ms.every(entry => G.models[entry.unitId + "__" + entry.kitId].unitTags.includes("MS")));
    assert(available.choices.every(entry => entry.unitId !== "MS_06C"));
  }
});

test("point advantage drains one percent of initial strength once per round and persists through sync", () => {
  const g = game(), state = g.battlefield;
  state.points[0].owner = 0;
  B.advance(G, g);
  assert.deepEqual(state.strength, [20000, 20000], "no drain before a completed round");
  g.round = 2;
  B.advance(G, g);
  assert.deepEqual(state.strength, [20000, 19800]);
  B.advance(G, g);
  B.sync(G, g);
  assert.deepEqual(state.strength, [20000, 19800], "duplicate settlement and snapshots cannot drain twice");
  state.points[1].owner = 0;
  state.losses[1] = 1000;
  g.round = 3;
  B.advance(G, g);
  assert.deepEqual(state.strength, [20000, 18600], "multiple extra points still drain a flat 200");
  const restored = structuredClone(g);
  B.advance(G, restored);
  assert.deepEqual(restored.battlefield.strength, state.strength, "serialized settlement marker survives reload");
});

test("tied points stop the drain and a reversed advantage drains the other team", () => {
  const g = game(), state = g.battlefield;
  state.points[0].owner = 0;
  state.points[1].owner = 1;
  g.round = 2;
  B.advance(G, g);
  assert.deepEqual(state.strength, [20000, 20000]);
  state.points[2].owner = 1;
  g.round = 3;
  B.advance(G, g);
  assert.deepEqual(state.strength, [19800, 20000]);
  state.points[3].owner = 0;
  g.round = 4;
  B.advance(G, g);
  assert.deepEqual(state.strength, [19800, 20000]);
});

test("point drain can end a battle before reinforcements or decide the final round", () => {
  for (const round of [6, 101]) {
    const g = game(), state = g.battlefield;
    state.points[0].owner = 0;
    state.losses[1] = 19800;
    g.round = round;
    B.advance(G, g);
    assert.equal(g.winner, 0);
    assert.equal(state.strength[1], 0);
    assert.equal(state.wave, 1);
    const before = structuredClone(state.controlLosses);
    g.round++;
    B.advance(G, g);
    assert.deepEqual(state.controlLosses, before, "finished battles cannot continue draining");
  }
});
test("repair skills do not offer the battlefield main base as a target", () => {
  const g = game(),
    base = g.units.find((unit) => unit.facility?.type === "base" && unit.team === 0);
  const model = G.models.Type61__standard,
    previous = model.skills;
  try {
    model.skills = [
      {
        id: "TestRepair",
        name: "Repair",
        type: "repair",
        range: 3,
        enCost: 0,
        maxUses: 99,
        hpRecoveryPercent: 25,
        enRecoveryPercent: 0,
        shieldRecoveryPercent: 0,
        consumeAction: true,
      },
    ];
    const actor = G.makeUnit({ unitId: "Type61", kitId: "standard" }, 2, "repair-unit", {
      x: base.x - 1,
      y: base.y,
    });
    g.units.push(actor);
    base.hp -= 10000;
    assert(
      !G.skillTargets(g, actor, "TestRepair").some((cell) =>
        G.cells(base).some((b) => b.x === cell.x && b.y === cell.y),
      ),
    );
  } finally {
    model.skills = previous;
  }
});
function roomFixture(t, options = {}) {
  let serial = 0;
  const messages = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "bf-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: (ws, message) => messages.push(message),
    ...options,
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "BATTLEFIELD",
    roomMode: "battlefield",
    characterFaction: "PMC",
    licenses: { Type61: true }, inventory: { Type61: 5 }, kits: { Type61__standard: 5 },
  });
  const room = engine.rooms.get("BATTLEFIELD");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: "request-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      phase: room.phase,
      action,
      ...fields,
    });
  return { engine, ws, room, act, messages };
}

test("deployment requests enforce turn ownership and deduplicate, with private reserve snapshots", (t) => {
  const { engine, room, act, ws, messages } = roomFixture(t);
  act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
  act("confirm_formation"); act("confirm_deployment");
  const reserve = room.game.battlefield.reserves[0];
  const actor = room.game.units.find(unit => unit.ownerSeat === 2);
  actor.hp = 0; engine.broadcast(room);
  const snapshot = messages.filter(message => message.type === "state").at(-1);
  assert.equal(snapshot.game.battlefield.reserves.length, 1);
  assert.equal(snapshot.game.battlefield.reserves[0].template, undefined);
  const site = B.deploymentSites(G, room.game, 0)[0];
  assert.throws(() => act("battlefield_deploy", { reserveId: reserve.id, siteId: site.id }), /维修/);
  room.game.round = reserve.readyRound;
  room.game.team = 1;
  assert.throws(() => act("battlefield_deploy", { reserveId: reserve.id, siteId: site.id }), /回合/);
  room.game.team = 0;
  const request = { id: "respawn-unique-request", revision: room.revision,
    round: room.game.round, matchId: room.matchId, phase: room.phase,
    action: "battlefield_deploy", reserveId: reserve.id, siteId: site.id };
  engine.action(ws, request);
  const before = structuredClone(reserve.request);
  engine.action(ws, request);
  assert.deepEqual(reserve.request, before);
  assert.equal(room.log.filter(line => line.includes("申请部署维修完成")).length, 1);
});

test("battlefield losses consume stock once, reserve concurrent deployments and block empty stock", (t) => {
  const { engine, room, act } = roomFixture(t);
  act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }, { unitId: "Type61", kitId: "standard" }] });
  act("confirm_formation"); act("confirm_deployment");
  const player = room.seats[2], reserves = room.game.battlefield.reserves;
  player.inventory.Type61 = player.kits.Type61__standard = 3;
  const own = room.game.units.filter(unit => unit.ownerSeat === 2);
  own.forEach(unit => unit.hp = 0); engine.broadcast(room);
  assert.equal(player.inventory.Type61, 1); assert.equal(player.kits.Type61__standard, 1);
  const receipts = room.economyAwards.filter(award => award.kind === "loss");
  assert.equal(receipts.length, 2);
  engine.broadcast(room); assert.equal(room.economyAwards.filter(award => award.kind === "loss").length, 2);
  room.game.round = Math.max(...reserves.map(item => item.readyRound));
  const site = B.deploymentSites(G, room.game, 0)[0];
  act("battlefield_deploy", { reserveId: reserves[0].id, siteId: site.id });
  assert.throws(() => act("battlefield_deploy", { reserveId: reserves[1].id, siteId: site.id }), /库存/);
  room.game.round++; B.advance(G, room.game); engine.broadcast(room);
  const arrival = room.game.units.find(unit => unit.id.startsWith("pmc-airdrop-"));
  arrival.hp = 0; engine.broadcast(room);
  assert.equal(player.inventory.Type61, 0);
  assert.equal(player.kits.Type61__standard, 0);
  room.game.round = reserves[0].readyRound;
  assert.throws(() => act("battlefield_deploy", { reserveId: reserves[0].id, siteId: site.id }), /库存/);
  // Settlement markers belong to the saved game, not an ephemeral room counter.
  room.game = structuredClone(room.game); engine.broadcast(room);
  assert.equal(room.economyAwards.filter(award => award.kind === "loss").length, 3);
});

test("ordinary AI players automatically request repaired roster units", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const { engine, room, act } = roomFixture(t, { aiDelayMs: 1, randomAIMoveDelay: () => 0 });
  act("add_ai", { seat: 4 });
  act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
  act("confirm_formation"); act("confirm_deployment");
  const reserve = room.game.battlefield.reserves.find(item => item.ownerSeat === 4);
  assert(reserve);
  for (const unit of room.game.units) {
    if (unit.ownerSeat === 4) unit.hp = 0;
    else if (unit.ownerSeat < 2) { unit.moved = true; unit.acted = true; }
  }
  B.sync(G, room.game);
  room.game.round = Math.max(...room.game.battlefield.reserves.filter(item => item.ownerSeat === 4).map(item => item.readyRound));
  room.turnDone[0] = true; room.turnDone[4] = false;
  engine.broadcast(room);
  const deadline = Date.now() + 12000;
  while (!reserve.request && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert(reserve.request, "ordinary AI must request a repaired unit before ending its turn");
  assert.equal(reserve.request.arrivalRound, room.game.round + 1);
  room.game.round++; B.advance(G, room.game);
  assert(room.game.units.some(unit => unit.ownerSeat === 4 && unit.hp > 0 && unit.id.startsWith("pmc-airdrop-")));
  assert.deepEqual(errors, []);
});

test("hostile kills pay COST/8, zero-damage attack participation pays COST/16 and result follows team era", (t) => {
  let target, killNext = false;
  // Exercise authoritative accounting independently of weapon hit randomness.
  const rules = { ...G,
    unitSkills: unit => [...G.unitSkills(unit), { id: "TestIrradiation", name: "测试照射", type: "irradiation" }],
    useSkill(game, unit) {
      const before = target.hp, after = killNext ? 0 : before;
      target.hp = after;
      return { type: "skill", skillId: "TestIrradiation", unitId: unit.id, resultId: unit.id,
        irradiation: true, evacuations: [], hits: [{ unitId: target.id, before, after, damage: before - after }] };
    },
  };
  const { engine, room, act } = roomFixture(t, { rules });
  act("configure_room", { ...room.settings, battleMode: "battlefield", battlefieldTeams: [{ faction: "EFSF", era: "0079T1" }, { faction: "ZEON", era: "0079T2" }] });
  const allySocket = { readyState: 1 };
  engine.join(allySocket, { mode: "join", room: "BATTLEFIELD", characterFaction: "PMC",
    licenses: { Type61: true }, inventory: { Type61: 5 }, kits: { Type61__standard: 5 } });
  let serial = 0;
  const allyAct = (action, fields = {}) => engine.action(allySocket, { id: "ally-" + ++serial,
    revision: room.revision, round: room.game.round, matchId: room.matchId, action, ...fields });
  allyAct("switch_seat", { seat: 4 });
  const formation = [{ unitId: "Type61", kitId: "standard" }];
  allyAct("set_ready", { ready: true, formation });
  act("start_game", { formation });
  act("confirm_formation"); allyAct("confirm_formation");
  act("confirm_deployment"); allyAct("confirm_deployment");
  target = room.game.units.find(unit => unit.ownerSeat === 1 && !unit.facility);
  const cost = G.modelOf(target).cost;
  allyAct("skill", { unitId: room.game.units.find(unit => unit.ownerSeat === 4).id, skillId: "TestIrradiation" });
  assert.equal(room.economyAwards.filter(award => award.kind === "assist").length, 0);
  room.playback = null; room.phase = "idle";
  killNext = true;
  act("skill", { unitId: room.game.units.find(unit => unit.ownerSeat === 2).id, skillId: "TestIrradiation" });
  const kill = room.economyAwards.find(award => award.kind === "kill");
  const assist = room.economyAwards.find(award => award.kind === "assist");
  assert.deepEqual([kill.money, kill.supplies], [Math.floor(cost / 8), Math.floor(cost / 8)]);
  assert.deepEqual([assist.money, assist.supplies], [Math.floor(cost / 16), Math.floor(cost / 16)]);
  assert.equal(assist.memberId, room.seats[4].id);
  engine.broadcast(room); engine.broadcast(room);
  assert.equal(room.economyAwards.filter(award => award.kind === "kill" || award.kind === "assist").length, 2);
  room.playback = null; room.phase = "idle";
  room.game.units.find(unit => unit.team === 1 && unit.facility?.type === "base").hp = 0;
  engine.broadcast(room);
  const results = room.economyAwards.filter(award => award.kind === "result");
  assert.equal(results.length, 2);
  assert(results.every(award => award.money === 1125 && award.supplies === 2250));
  assert.deepEqual(room.techAwards, []); assert.deepEqual(room.pilotAwards, []);
});
test("fixed AI slots cannot be removed, taken or relocated by host requests", (t) => {
  const { room, act } = roomFixture(t);
  assert(room.seats[0].battlefieldAI && room.seats[1].battlefieldAI);
  assert.equal(room.seats[2].characterFaction, "PMC");
  assert.throws(() => act("remove_ai", { seat: 0 }));
  assert.throws(() => act("switch_seat", { seat: 1 }));
  assert.throws(() => act("move_player", { memberId: room.seats[0].id, seat: 4 }));
});
test("PMC deployment uses inventory and receives fixed era rewards without technology or pilot XP", (t) => {
  const { engine, ws, room, act, messages } = roomFixture(t);
  act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
  assert.equal(room.phase, "assembly");
  act("confirm_formation");
  act("confirm_deployment");
  assert.equal(room.phase, "idle");
  const player = room.seats[2],
    before = structuredClone({ inventory: player.inventory, kits: player.kits });
  assert.deepEqual(room.stockReservations, {});
  room.game.units.find((unit) => unit.facility?.type === "base" && unit.team === 1).hp = 0;
  engine.broadcast(room);
  assert.equal(room.game.winner, 0);
  assert.equal(room.phase, "finished");
  assert.deepEqual(room.economyAwards.map(award => [award.kind, award.money, award.supplies]), [["result", 1250, 2500]]);
  assert.deepEqual(room.techAwards, []);
  assert.deepEqual(room.pilotAwards, []);
  assert.deepEqual({ inventory: player.inventory, kits: player.kits }, before);
  const publicState = messages.filter((message) => message.type === "state").at(-1);
  assert.equal(publicState.game.seed, undefined);
  assert.equal(publicState.game.partSeed, undefined);
});

test("live faction AI advances mobile troops toward objectives while fixed facilities stay in place", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const { room, act } = roomFixture(t, { aiDelayMs: 1, randomAIMoveDelay: () => 0 });
  act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
  act("confirm_formation");
  act("confirm_deployment");
  const facilities = room.game.units
    .filter((unit) => unit.facility)
    .map((unit) => ({ id: unit.id, x: unit.x, y: unit.y }));
  const initial = new Map(
    room.game.units
      .filter((unit) => unit.ownerSeat === 0 && !unit.facility)
      .map((unit) => [unit.id, { x: unit.x, y: unit.y }]),
  );
  const deadline = Date.now() + 12000;
  while (
    Date.now() < deadline &&
    !room.game.units.some(
      (unit) =>
        initial.has(unit.id) &&
        (unit.x !== initial.get(unit.id).x || unit.y !== initial.get(unit.id).y),
    )
  )
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert(
    room.game.units.some(
      (unit) =>
        initial.has(unit.id) &&
        (unit.x !== initial.get(unit.id).x || unit.y !== initial.get(unit.id).y),
    ),
    "faction AI must actually move",
  );
  for (const expected of facilities) {
    const unit = room.game.units.find((unit) => unit.id === expected.id);
    assert.equal(unit.x, expected.x);
    assert.equal(unit.y, expected.y);
    assert(!G.squadEligible(unit));
  }
  assert.deepEqual(errors, []);
});

test("canyon highlands retain four sites and connected two-cell-wide ground approaches", () => {
  const map = G.getMap(B.defaultMapId);
  assert.deepEqual(map.battlefield.points.map(point => point.id), ["point-1", "point-2", "point-4", "point-5"]);
  assert(map.width > map.height);
  const bases = map.battlefield.facilities.filter(unit => unit.type === "base");
  for (const facility of map.battlefield.facilities) {
    const size = facility.type === "base" ? 3 : 1;
    for (let y = facility.y; y < facility.y + size; y++)
      for (let x = facility.x; x < facility.x + size; x++) assert.equal(map.tiles[y][x], "highland");
  }
  assert(map.tiles.flat().filter(tile => tile === "plain").length > map.width * map.height / 3);
  const fits = (x,y) => [0,1].every(dy => [0,1].every(dx =>
    ["plain", "highland", "rubble"].includes(map.tiles[y+dy]?.[x+dx])));
  const start = bases[0], queue = [[start.x,start.y]], seen = new Set([start.x+","+start.y]);
  for (let i=0;i<queue.length;i++) for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x=queue[i][0]+dx,y=queue[i][1]+dy,key=x+","+y;
    if (!seen.has(key) && fits(x,y)) { seen.add(key);queue.push([x,y]); }
  }
  for (const site of [...bases,...map.battlefield.points])
    assert(seen.has(site.x+","+site.y), "Ground route to "+site.id);
  for (const spawn of map.spawns) assert.equal(map.tiles[spawn.y][spawn.x], "highland");
});

test("opening climate and actual weather/time changes enter both team logs once", (t) => {
  const {engine,room,act} = roomFixture(t);
  act("start_game", {formation:[{unitId:"Type61",kitId:"standard"}]});
  assert(!room.log.some(line=>line.includes("[战场环境]")));
  act("confirm_formation");
  const initial=room.log.filter(line=>line.includes("[战场环境]"));
  assert.equal(initial.length,1);
  assert(initial[0].includes("天气：") && initial[0].includes("时间：清晨"));
  engine.broadcast(room);engine.broadcast(room);
  assert.equal(room.log.filter(line=>line.includes("[战场环境]")).length,1);
  room.game.round=6;engine.broadcast(room);
  const changes=room.log.filter(line=>line.includes("[环境变化]"));
  assert.equal(changes.length,1);assert(changes[0].includes("时间：上午"));
  room.game.climateSettings={...room.game.climateSettings,weather:"blizzard"};
  engine.broadcast(room);
  assert.equal(room.log.filter(line=>line.includes("[环境变化]")).length,2);
  assert(room.log[0].includes("天气：暴雪"));
  engine.broadcast(room);
  assert.equal(room.log.filter(line=>line.includes("[环境变化]")).length,2);
  for(const team of [0,1]) {
    assert(room.teamLogs[team].includes(initial[0]));
    assert(room.teamLogs[team].some(line=>line.includes("天气：暴雪")));
  }
  const old = room.game;
  room.game=structuredClone(old);engine.broadcast(room);
  assert.equal(room.log.filter(line=>line.includes("[战场环境]")).length,2);
});
