const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules");
const B = G.battlefieldMode;
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
function game() {
  const armies = Array(10).fill(null);
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
  assert.throws(() =>
    G.create(false, 1, [null, null], false, { mode: "battlefield", mapId: "frontier_1v1" }),
  );
  assert.throws(() =>
    G.create(false, 1, Array(10).fill(null), false, { mode: "regular", mapId: B.defaultMapId }),
  );
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
test("reinforcement waves advance technology, respect chosen faction/era and cannot duplicate a round", () => {
  const g = game();
  g.round = 6;
  B.advance(G, g);
  assert.equal(g.battlefield.wave, 1);
  const units = g.units.filter((unit) => unit.airdropRound === 6);
  assert.equal(units.length, 8);
  assert(units.every((unit) => G.fits(g, unit) && G.modelOf(unit).tags.includes("0079T1")));
  B.advance(G, g);
  assert.equal(g.battlefield.wave, 1);
  for (const team of [0, 1]) {
    const early = B.pool(G, { ...g.battlefield, completed: 0 }, team);
    const late = B.pool(G, { ...g.battlefield, completed: 30, wave: 8 }, team);
    assert.equal(early.era, "0079T1");
    assert.equal(late.era, "0079T2");
    assert(late.choices.every((entry) => entry.unitId !== "MS_06C"));
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
    licenses: { Type61: true },
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
test("fixed AI slots cannot be removed, taken or relocated by host requests", (t) => {
  const { room, act } = roomFixture(t);
  assert(room.seats[0].battlefieldAI && room.seats[1].battlefieldAI);
  assert.equal(room.seats[2].characterFaction, "PMC");
  assert.throws(() => act("remove_ai", { seat: 0 }));
  assert.throws(() => act("switch_seat", { seat: 1 }));
  assert.throws(() => act("move_player", { memberId: room.seats[0].id, seat: 4 }));
});
test("PMC deploys with a license and zero stock; winning does not change stock or award resources or XP", (t) => {
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
  assert.deepEqual(room.economyAwards, []);
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
