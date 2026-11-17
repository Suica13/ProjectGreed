const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  D = G.dominionMode,
  { createRoomEngine } = require("../shared/room-engine");
const settings = { mode: "dominion", mapId: D.defaultMapId, dominionEra: "UC_0079_T1" };
function game(
  players = [
    { seat: 0, characterFaction: "EFSF" },
    { seat: 1, characterFaction: "ZEON" },
  ],
) {
  return G.create(false, 7319, Array(4).fill(null), false, {
    ...settings,
    dominionPlayers: players,
  });
}
function fixture(t) {
  let n = 0;
  const frames = new Map(),
    engine = createRoomEngine({
      rules: G,
      randomId: () => "dom-" + ++n,
      randomToken: () => "tok-" + ++n,
      randomSeed: () => 7319,
      aiDelayMs: 999999,
      send: (ws, s) => frames.set(ws, s),
    });
  t.after(() => engine.close());
  const a = { readyState: 1 },
    b = { readyState: 1 },
    watch = { readyState: 1 };
  engine.join(a, { mode: "create", room: "DOM", roomMode: "dominion", characterFaction: "PMC" });
  engine.join(b, { mode: "join", room: "DOM", characterFaction: "PMC" });
  const room = engine.rooms.get("DOM");
  const act = (ws, action, fields = {}) => {
    const req = {
      id: "req-" + ++n,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    };
    engine.action(ws, req);
    return req;
  };
  act(b, "set_ready", { ready: true });
  act(a, "start_game");
  return { a, b, watch, act, room, engine, frames };
}
test("each player receives an independent headquarters, factories, refineries, lab and turrets", () => {
  const g = game([
    { seat: 0, characterFaction: "EFSF" },
    { seat: 1, characterFaction: "ZEON" },
    { seat: 2, characterFaction: "EFSF" },
    { seat: 3, characterFaction: "ZEON" },
  ]);
  assert.equal(g.deployment, null);
  assert.equal(Object.keys(g.dominion.players).length, 4);
  for (let seat = 0; seat < 4; seat++) {
    const structures = g.units.filter((u) => u.ownerSeat === seat);
    assert.equal(structures.length, 9);
    for (const [type, count] of [
      ["base", 1],
      ["factory", 2],
      ["refinery", 2],
      ["research", 1],
      ["machineGun", 3],
    ])
      assert.equal(structures.filter((u) => u.facility.type === type).length, count);
    assert.deepEqual(D.income(g, seat), { money: 500, supplies: 750, points: 250 });
  }
  assert.deepEqual(
    g.dominion.points.map((p) => p.size),
    [1, 3, 2],
  );
});
test("production spends only match resources, is one unit, respects research and spawns beside the factory next own turn", () => {
  const g = game(),
    f = g.units.find((u) => u.ownerSeat === 0 && u.facility.type === "factory"),
    p = g.dominion.players[0];
  assert.throws(() => D.produce(G, g, 1, f.id, "Type61", "standard"));
  assert.throws(() => D.produce(G, g, 0, f.id, "MS_06F", "machine_gun"));
  assert.throws(() => D.produce(G, g, 0, f.id, "ORX_012", "standard"));
  const offer = D.offers(G, g, 0).find((o) => o.unitId === "Type61" && o.kitId === "standard"),
    before = { ...p };
  D.produce(G, g, 0, f.id, offer.unitId, offer.kitId);
  assert.equal(p.money, before.money - offer.cost.money);
  assert.equal(p.supplies, before.supplies - offer.cost.supplies);
  assert.throws(() => D.produce(G, g, 0, f.id, offer.unitId, offer.kitId));
  G.end(g);
  G.end(g);
  assert.equal(g.round, 3);
  assert.equal(g.winner, null);
  const units = g.units.filter((u) => !u.facility);
  assert.equal(units.length, 1);
  assert.equal(units[0].ownerSeat, 0);
  assert(!units[0].moved && !units[0].acted);
  const money = p.money;
  D.advance(G, g);
  assert.equal(p.money, money);
  assert.equal(p.points, 250);
  assert(!f.dominionOrder);
});
test("match research uses its own faction, thresholds and prerequisites without personal unlocks", () => {
  const g = game(),
    p = g.dominion.players[0],
    lab = g.units.find((u) => u.ownerSeat === 0 && u.facility.type === "research");
  const nodes = require("../shared/development-tree.json").EFSF,
    node = nodes.find(
      (n) =>
        !p.researched.EFSF.includes(n.id) &&
        n.requires.every((id) => p.researched.EFSF.includes(id)),
    );
  assert.throws(() => D.research(G, g, 0, lab.id, node.id));
  p.points = node.points;
  D.research(G, g, 0, lab.id, node.id);
  assert(p.researched.EFSF.includes(node.id));
  assert.equal(p.points, node.points);
  assert.throws(() => D.research(G, g, 0, lab.id, node.id));
  assert.throws(() => D.research(G, g, 1, lab.id, node.id));
});
test("capture requires a suppressing uncontested unit and transfers the complete site to its player", () => {
  const g = game(),
    p = g.dominion.points[0],
    u = G.makeUnit({ unitId: "RGM_79", kitId: "machine_gun" }, 0, "capturer", {
      x: p.x,
      y: p.y + 1,
    });
  g.units.push(u);
  const e = G.makeUnit({ unitId: "MS_06F", kitId: "machine_gun" }, 1, "defender", {
    x: p.x + 1,
    y: p.y,
  });
  g.units.push(e);
  assert.throws(() => D.capture(G, g, 0, u.id, p.id));
  e.hp = 0;
  D.capture(G, g, 0, u.id, p.id);
  assert.equal(p.ownerSeat, 0);
  assert(u.acted);
  const site = g.units.filter((v) => v.facility?.siteId === p.id);
  assert.equal(site.length, 3);
  assert(site.every((v) => v.ownerSeat === 0 && v.hp > 0 && !v.dominionDormant));
  assert.deepEqual(D.income(g, 0), { money: 750, supplies: 1125, points: 500 });
  assert(!G.fits(g, u, p.x, p.y));
  u.acted = false;
  u.flying = true;
  assert.throws(() => D.capture(G, g, 0, u.id, g.dominion.points[1].id));
});
test("only the loss of all team headquarters determines defeat", () => {
  const g = game();
  for (const u of g.units) if (u.team === 1 && u.facility.type === "base") u.hp = 0;
  D.sync(G, g);
  assert.equal(g.winner, 0);
});
test("room authority starts without inventory, deduplicates orders, rejects spectators, and settles no persistent rewards", (t) => {
  const f = fixture(t),
    { room } = f;
  assert.equal(room.phase, "idle");
  assert.equal(room.settings.mode, "dominion");
  const factory = room.game.units.find((u) => u.ownerSeat === 0 && u.facility.type === "factory");
  const req = f.act(f.a, "dominion_produce", {
      factoryId: factory.id,
      unitId: "Type61",
      kitId: "standard",
    }),
    money = room.game.dominion.players[0].money;
  f.engine.action(f.a, req);
  assert.equal(room.game.dominion.players[0].money, money);
  assert.throws(() =>
    f.act(f.b, "dominion_produce", { factoryId: factory.id, unitId: "Type61", kitId: "standard" }),
  );
  f.engine.join(f.watch, { mode: "join", room: "DOM", characterFaction: "PMC" });
  assert.throws(() =>
    f.act(f.watch, "dominion_research", { labId: factory.id, techId: "invalid" }),
  );
  const state = f.frames.get(f.a);
  assert.deepEqual(Object.keys(state.game.dominion.players), ["0"]);
  assert.equal(state.game.seed, undefined);
  for (const u of room.game.units) if (u.facility?.type === "base" && u.team === 1) u.hp = 0;
  f.engine.broadcast(room);
  assert.equal(room.game.winner, 0);
  assert.equal(room.economyAwards.length, 0);
  assert.equal(room.techAwards.length, 0);
  assert.equal(room.pilotAwards.length, 0);
  assert.deepEqual(room.stockReservations, {});
});
test("era restrictions and forced team factions apply before readying", (t) => {
  let n = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id-" + ++n,
    randomToken: () => "tok-" + ++n,
    randomSeed: () => 7319,
    send: () => {},
    aiDelayMs: 999999,
  });
  t.after(() => engine.close());
  const a = { readyState: 1 };
  engine.join(a, { mode: "create", room: "ERA", roomMode: "dominion", characterFaction: "PMC" });
  const room = engine.rooms.get("ERA");
  const act = (action, fields) =>
    engine.action(a, { id: "req-" + ++n, revision: room.revision, action, ...fields });
  act("configure_room", {
    costLimit: 1500,
    dominionEra: "CE_0071_T1",
    teamFactions: ["OMNI", "ZAFT"],
  });
  assert.equal(room.seats[0].characterFaction, "OMNI");
  assert.throws(() => act("set_faction", { faction: "EFSF" }));
  assert.deepEqual(D.factionsForEra(G, "CE_0071_T1"), ["OMNI", "ZAFT"]);
});

test("dominion map metadata survives editor round trips and rejects malformed sites", () => {
  const M = require("../shared/map-document"),
    map = G.getMap(D.defaultMapId);
  const restored = M.compile(M.importMap(map));
  assert.deepEqual(restored.dominion, map.dominion);
  assert(D.validateMap(map));
  const invalid = structuredClone(map);
  invalid.dominion.points[0].size = 99;
  assert.throws(() => D.validateMap(invalid));
});

test("match saves preserve local resources, research, factory orders and neutral facilities", (t) => {
  const f = fixture(t),
    R = require("../shared/match-records");
  const factory = f.room.game.units.find((u) => u.ownerSeat === 0 && u.facility.type === "factory");
  f.act(f.a, "dominion_produce", { factoryId: factory.id, unitId: "Type61", kitId: "standard" });
  const save = R.validateSave(G, R.createSave(G, f.room));
  assert.deepEqual(save.game.dominion, f.room.game.dominion);
  assert.equal(save.game.units.find((u) => u.id === factory.id).dominionOrder.unitId, "Type61");
  const bad = structuredClone(save);
  bad.game.dominion.players[0].money = -1;
  assert.throws(() => R.validateSave(G, bad));
  f.room.resumeSave = structuredClone(save);
  f.room.started = false;
  f.room.phase = "waiting";
  f.room.game.dominion.players[0].money = 0;
  f.act(f.a, "start_game");
  assert.equal(f.room.phase, "idle");
  assert.deepEqual(f.room.game.dominion, save.game.dominion);
  assert(f.room.game.units.find((u) => u.id === factory.id).dominionOrder);
});

 test("all shared facilities occupy one cell and neutral plots do not reserve their neighbors", () => {
  const g = game();
  for (const u of g.units.filter(u => u.facility)) {
    assert.deepEqual(G.dimensions(u), {width:1,height:1});
    assert.equal(G.cells(u).length,1);
  }
  for (const model of Object.values(G.models).filter(m => m.facility || m.facilityType))
    assert.deepEqual(model.footprint || {width:1,height:1}, {width:1,height:1});
  const p=g.dominion.points[0], blocked=D.blockedCells(G,g);
  assert(blocked.has((p.x-4)+","+(p.y-4)));
  assert(!blocked.has((p.x-3)+","+(p.y-4)));
});
