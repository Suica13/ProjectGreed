const test = require("node:test"),
  assert = require("node:assert/strict");
const Wire = require("../shared/state-wire"),
  G = require("../shared/rules");
const { createRoomEngine } = require("../shared/room-engine");
const { createStateOutbox } = require("../tools/state-outbox.cjs");

test("broadcast serialization reuse ends before delayed snapshots or the next mutation", async (t) => {
  const values = [],
    contexts = [],
    batch = new Map(),
    ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: (value) => values.push(JSON.parse(value)),
      terminate() {},
    };
  const encoder = Wire.createEncoder(),
    decoder = Wire.createDecoder(),
    batches = new WeakMap();
  const outbox = createStateOutbox({
    pollMs: 5,
    highWater: 10,
    encode(socket, state, context) {
      contexts.push(context);
      let cache;
      if (context) {
        cache = batches.get(context);
        if (!cache) batches.set(context, (cache = new WeakMap()));
      }
      return encoder.encode(state, cache);
    },
  });
  t.after(() => outbox.close());
  const state = {
    type: "state",
    room: "cache",
    matchId: "m",
    game: { units: [{ id: "u", hp: 100 }], tiles: [["plain"]] },
  };
  outbox.send(ws, state, batch);
  assert.equal(contexts[0], batch);
  assert.equal(decoder.decode(values[0]).game.units[0].hp, 100);
  ws.bufferedAmount = 20;
  state.game.units[0].hp = 75;
  outbox.send(ws, state, batch);
  state.game.units[0].hp = 1;
  ws.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(contexts[1], undefined);
  assert.equal(decoder.decode(values[1]).game.units[0].hp, 75);
  outbox.send(ws, state, new Map());
  assert.equal(decoder.decode(values[2]).game.units[0].hp, 1);
});

test("wire baselines remain immutable through reused actors, field removal, reordering and periodic full frames", () => {
  const state = {
    type: "state",
    room: "load",
    matchId: "match",
    viewTeam: 0,
    you: { id: "p", seat: 2 },
    revision: 0,
    game: {
      tiles: [["plain"]],
      units: Array.from({ length: 30 }, (_, i) => ({
        id: "u" + i,
        hp: 100,
        model: "test",
        pilot: { name: '驾驶员 " \\ \n ' + i, stats: { speed: 100 } },
        optional: null,
      })),
    },
    log: [],
  };
  const encoder = Wire.createEncoder(),
    decoder = Wire.createDecoder();
  for (let i = 0; i < 260; i++) {
    const actor = state.game.units[i % state.game.units.length];
    actor.hp = i;
    actor.pilot.stats.speed = i;
    if (i % 3) delete actor.optional;
    else actor.optional = { nested: [i, null] };
    if (i % 7 === 0) state.game.units.reverse();
    if (i === 90) state.game.units.splice(3, 1);
    if (i === 160)
      state.game.units.push({
        id: "new",
        hp: 10,
        model: "test",
        pilot: { name: "新", stats: { speed: 1 } },
      });
    state.revision = i;
    state.log.unshift('line " ' + i);
    const frame = JSON.parse(encoder.encode(state)),
      shown = decoder.decode(frame);
    assert.deepEqual(shown, JSON.parse(JSON.stringify(state)));
    shown.game.units[0].hp = -999;
    shown.game.units[0].pilot.name = "local animation mutation";
    if (i === 170) encoder.reset();
  }
});

test("derived pilot attributes reuse equivalent snapshots and respond to changed stats and damage", () => {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const unit = G.makeUnit(entry, 2, "pilot-reuse", { x: 2, y: 2 }, 0, 7319);
  const before = G.modelOf(unit),
    copy = structuredClone(unit);
  assert.equal(G.modelOf(copy), before);
  copy.pilot.stats.speed += 100;
  assert.notEqual(G.modelOf(copy).move, before.move);
  assert.equal(G.modelOf(unit), before);
  const faster = G.modelOf(copy);
  copy.brokenParts = { backpack: true };
  assert(G.modelOf(copy).move < faster.move);
});

test("3v3 shared team views keep reserves, templates and private random state isolated", (t) => {
  let serial = 0;
  const frames = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "reuse-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: (ws, snapshot) => {
      if (ws && snapshot.type === "state") frames.push({ ws, snapshot: structuredClone(snapshot) });
    },
  });
  t.after(() => engine.close());
  const sockets = Array.from({ length: 6 }, () => ({ readyState: 1 }));
  for (const [i, ws] of sockets.entries())
    engine.join(ws, {
      mode: i ? "join" : "create",
      room: "PRIVACY",
      roomMode: "battlefield",
      characterFaction: "PMC",
      licenses: { Medea: true },
      inventory: { Medea: 5 },
    });
  const room = engine.rooms.get("PRIVACY"),
    armies = Array(12).fill(null);
  for (const p of room.seats.filter((p) => p && !p.bot))
    armies[p.seat] = [{ unitId: "Medea", kitId: "standard" }];
  room.game = G.create(false, 7319, armies, false, { ...room.settings, fogMode: "disabled" });
  for (const u of room.game.units.filter((u) => !u.facility && u.ownerSeat >= 2))
    room.game.battlefield.reserves.push({
      id: "private-" + u.ownerSeat,
      ownerSeat: u.ownerSeat,
      formationIndex: u.formationIndex,
      unitId: "Medea",
      kitId: "standard",
      readyRound: null,
      losses: 0,
      template: { secret: "must not be public" },
    });
  Object.assign(room, {
    started: true,
    phase: "idle",
    matchId: "privacy",
    activeSeats: room.seats.map(Boolean),
    turnDone: Array(12).fill(false),
  });
  frames.length = 0;
  engine.broadcast(room);
  assert.equal(frames.length, 6);
  for (const { snapshot } of frames) {
    assert.equal(snapshot.game.seed, undefined);
    assert.equal(snapshot.game.partSeed, undefined);
    assert.equal(snapshot.game.battlefield.reinforcementQueue, undefined);
    assert(snapshot.game.battlefield.reserves.length >= 1);
    assert(
      snapshot.game.battlefield.reserves.every(
        (r) => r.ownerSeat === snapshot.you.seat && !r.template,
      ),
    );
    assert(
      snapshot.members
        .filter((m) => m.id !== snapshot.you.id)
        .every((m) => !m.inventory && !m.licenses),
    );
  }
});
