const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createServer } = require("../server");
const version = require("../project.json").version;
const G = require("../shared/rules");
test("dominion WebSocket production is authoritative, private, idempotent and independent of permanent rewards", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1", aiDelayMs: 999999 });
  const address = await app.listen(),
    sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
  });
  async function client(mode) {
    const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/ws");
    sockets.push(ws);
    const frames = [],
      listeners = new Set();
    let state = null;
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw);
      frames.push(frame);
      if (frame.type === "state") state = frame;
      for (const notify of listeners) notify();
    });
    const wait = (predicate, from = 0) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(run);
          reject(Error("battlefield frame timeout: " + JSON.stringify(frames.at(-1))));
        }, 5000);
        const run = () => {
          const frame = frames.slice(from).find(predicate);
          if (frame) {
            clearTimeout(timeout);
            listeners.delete(run);
            resolve(frame);
          }
        };
        listeners.add(run);
        run();
      });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        type: "hello",
        version,
        mode,
        room: "DOMNETWORK",
        roomMode: "dominion",
        characterFaction: "PMC",
        licenses: { Medea: true },
        inventory: { Medea: 5 },
        kits: {},
      }),
    );
    await wait((frame) => frame.type === "joined");
    await wait((frame) => frame.type === "state");
    return {
      get state() {
        return state;
      },
      frames,
      ws,
      async act(action, fields = {}) {
        const id = randomUUID(),
          from = frames.length;
        // Read the server revision in this harness so independent human acknowledgements do not race.
        const room = app.rooms.get("DOMNETWORK");
        ws.send(
          JSON.stringify({
            type: "action",
            id,
            revision: room.revision,
            round: room.game.round,
            matchId: room.matchId,
            phase: room.phase,
            action,
            ...fields,
          }),
        );
        return wait(
          (frame) =>
            (frame.type === "state" && frame.ack === id) ||
            (frame.type === "error" && frame.id === id),
          from,
        );
      },
    };
  }

  const host = await client("create"),
    guest = await client("join"),
    room = app.rooms.get("DOMNETWORK");
  assert.equal((await guest.act("set_ready", { ready: true })).type, "state");
  assert.equal((await host.act("start_game")).phase, "idle");
  const factory = room.game.units.find((u) => u.ownerSeat === 0 && u.facility.type === "factory");
  const result = await host.act("dominion_produce", {
    factoryId: factory.id,
    unitId: "Type61",
    kitId: "standard",
  });
  assert.equal(result.type, "state");
  assert.deepEqual(Object.keys(result.game.dominion.players), ["0"]);
  assert.equal(result.game.seed, undefined);
  const money = room.game.dominion.players[0].money;
  host.ws.send(
    JSON.stringify({
      type: "action",
      id: result.ack,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action: "dominion_produce",
      factoryId: factory.id,
      unitId: "Type61",
      kitId: "standard",
    }),
  );
  await host.act("sync");
  assert.equal(room.game.dominion.players[0].money, money);
  assert.equal(
    (
      await guest.act("dominion_produce", {
        factoryId: factory.id,
        unitId: "Type61",
        kitId: "standard",
      })
    ).type,
    "error",
  );
  const watch = await client("join");
  assert.equal(watch.state.you.seat, null);
  assert.deepEqual(watch.state.game.dominion.players, {});
  assert.equal(
    (
      await watch.act("dominion_produce", {
        factoryId: factory.id,
        unitId: "Type61",
        kitId: "standard",
      })
    ).type,
    "error",
  );
  room.game.round = 3;
  G.dominionMode.advance(G, room.game);
  const updated = await host.act("sync");
  assert(updated.game.units.some((u) => u.ownerSeat === 0 && !u.facility));
  for (const u of room.game.units) if (u.facility?.type === "base" && u.team === 1) u.hp = 0;
  const final = await host.act("wait", { unitId: factory.id, single: true });
  assert.equal(final.phase, "finished");
  assert.equal(final.game.winner, 0);
  assert.deepEqual(room.economyAwards, []);
  assert.deepEqual(room.techAwards, []);
  assert.deepEqual(room.pilotAwards, []);
});
