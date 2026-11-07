const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createServer } = require("../server");
const version = require("../project.json").version;
test("two network PMC players use fixed faction AI slots and receive one authoritative battlefield result", async (t) => {
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
        room: "BFNETWORK",
        roomMode: "battlefield",
        characterFaction: "PMC",
        licenses: { Type61: true },
        inventory: {},
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
      async act(action, fields = {}) {
        const id = randomUUID(),
          from = frames.length;
        // Read the server revision in this harness so independent human acknowledgements do not race.
        const room = app.rooms.get("BFNETWORK");
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
    guest = await client("join");
  assert.equal(host.state.you.seat, 2);
  assert.equal(guest.state.you.seat, 3);
  assert.equal((await host.act("remove_ai", { seat: 1 })).type, "error");
  const formation = [{ unitId: "Type61", kitId: "standard" }];
  assert.equal((await guest.act("set_ready", { ready: true, formation })).type, "state");
  assert.equal((await host.act("start_game", { formation })).phase, "assembly");
  await host.act("confirm_formation");
  assert.equal((await guest.act("confirm_formation")).phase, "deployment");
  await host.act("confirm_deployment");
  assert.equal((await guest.act("confirm_deployment")).phase, "idle");
  const room = app.rooms.get("BFNETWORK");
  assert.equal(room.seats[0].bot, true);
  assert.equal(room.seats[1].bot, true);
  assert.deepEqual(room.stockReservations, {});
  room.game.units.find((unit) => unit.team === 1 && unit.facility?.type === "base").hp = 0;
  const result = await host.act("wait", {
    unitId: room.game.units.find((unit) => unit.ownerSeat === 2).id,
    single: true,
  });
  assert.equal(result.phase, "finished");
  assert.equal(result.game.winner, 0);
  assert.deepEqual(result.game.battlefield.strength, [20000, 0]);
  assert.equal(result.game.seed, undefined);
  assert.equal(result.game.partSeed, undefined);
  assert.deepEqual(room.economyAwards, []);
  assert.deepEqual(room.techAwards, []);
  const again = await host.act("sync");
  assert.deepEqual(again.game.battlefield.strength, result.game.battlefield.strength);
});
