const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createServer } = require("../server"),
  G = require("../shared/rules");
test("real WebSocket cooperative sweep synchronizes routes, partial defeat, restock and private one-time extraction", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1", aiDelayMs: 999999 });
  const address = await app.listen(),
    sockets = [];
  t.after(async () => {
    for (const s of sockets) s.terminate();
    await app.close();
  });
  async function connect(mode) {
    const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/ws");
    sockets.push(ws);
    const frames = [],
      listeners = new Set();
    let state;
    ws.on("message", (raw) => {
      const f = JSON.parse(raw);
      frames.push(f);
      if (f.type === "state") state = f;
      for (const run of listeners) run();
    });
    const wait = (predicate, from = 0) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(run);
          reject(Error(JSON.stringify(frames.at(-1))));
        }, 5000);
        const run = () => {
          const f = frames.slice(from).find(predicate);
          if (f) {
            clearTimeout(timer);
            listeners.delete(run);
            resolve(f);
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
        version: require("../project.json").version,
        mode,
        room: "SWEEPNET",
        roomMode: "sweep",
        characterFaction: "PMC",
        inventory: { Type61: 5 },
        licenses: { Type61: true },
      }),
    );
    await wait((f) => f.type === "joined");
    await wait((f) => f.type === "state");
    return {
      get state() {
        return state;
      },
      frames,
      wait,
      async act(action, fields = {}) {
        const room = app.rooms.get("SWEEPNET"),
          id = randomUUID(),
          from = frames.length;
        ws.send(
          JSON.stringify({
            type: "action",
            id,
            revision: room.revision,
            matchId: room.matchId,
            round: room.game.round,
            phase: room.phase,
            action,
            ...fields,
          }),
        );
        return wait(
          (f) => (f.type === "state" && f.ack === id) || (f.type === "error" && f.id === id),
          from,
        );
      },
    };
  }
  const host = await connect("create"),
    guest = await connect("join"),
    room = app.rooms.get("SWEEPNET");
  const map = Object.values(G.catalog.maps).find(
    (m) =>
      m.spawns.length === 4 &&
      !m.strategic &&
      !m.battlefield &&
      (m.supportedModes || ["regular"]).includes("regular"),
  );
  assert.equal(
    (await host.act("configure_room", { ...room.settings, mapId: map.id, battleMode: "sweep" }))
      .type,
    "state",
  );
  // A two-seat lobby can place a joining player in observation; explicitly take
  // an allied slot once the four-seat map is configured.
  if (guest.state.you.seat === null)
    assert.equal((await guest.act("switch_seat", { seat: 2 })).type, "state");
  assert.equal(host.state.you.seat, 0);
  assert.equal(guest.state.you.seat, 2);
  const formation = [{ unitId: "Type61", kitId: "standard" }];
  assert.equal((await guest.act("set_ready", { ready: true, formation })).type, "state");
  assert.equal((await host.act("start_game", { formation })).phase, "assembly");
  await host.act("confirm_formation");
  assert.equal((await guest.act("confirm_formation")).phase, "sweep_map");
  assert.equal((await guest.act("sweep_select", { nodeId: "0:1" })).type, "error");
  const chosen = await host.act("sweep_select", { nodeId: "0:1" });
  await guest.wait((f) => f.type === "state" && f.sweep?.selected === "0:1");
  assert.equal(chosen.sweep.seed, undefined);
  assert.equal((await host.act("sweep_confirm")).phase, "deployment");
  await host.act("confirm_deployment");
  await guest.act("confirm_deployment");
  const dead = room.game.units.find((u) => u.ownerSeat === 2);
  dead.hp = 0;
  room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
  room.game.winner = 0;
  room.phase = "finished";
  await connect("join"); // A late spectator also exercises the normal broadcast/checkpoint path.
  assert.equal((await host.act("sync")).phase, "sweep_map");
  assert.equal(room.seats[2].inventory.Type61, 4);
  assert(!room.sweep.ended);
  assert(!room.economyAwards.some((a) => a.kind === "result"));
  await host.act("sweep_select", { nodeId: "1:1" });
  room.sweep.nodes.find((n) => n.id === "1:1").type = "battle";
  assert.equal((await host.act("sweep_confirm")).phase, "deployment");
  assert(!room.game.units.some((u) => u.ownerSeat === 2));
  assert.equal((await host.act("confirm_deployment")).phase, "idle");
  assert.equal(room.game.deployment[2], true); // Empty allied armies are already confirmed.
  room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
  room.game.winner = 0;
  room.phase = "finished";
  await connect("join");
  await host.act("sweep_select", { nodeId: "2:1" });
  room.sweep.nodes.find((n) => n.id === "2:1").type = "rest";
  await host.act("sweep_confirm");
  await host.act("sweep_event", { choice: 1 });
  assert.equal(
    (await guest.act("sweep_reinforce", { entry: formation[0] })).phase,
    "sweep_resupply",
  );
  assert.equal(room.sweep.rosters[room.seats[2].id].length, 1);
  await host.act("sweep_resupply_done");
  // Both sides now participate again; a second battle must not require a dead
  // player's old formation or silently duplicate any reward receipt.
  await host.act("sweep_select", { nodeId: "3:1" });
  room.sweep.nodes.find((n) => n.id === "3:1").type = "battle";
  assert.equal((await host.act("sweep_confirm")).phase, "deployment");
  await host.act("confirm_deployment");
  assert.equal((await guest.act("confirm_deployment")).phase, "idle");
  room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
  room.game.winner = 0;
  room.phase = "finished";
  await connect("join");
  room.sweep.pending[room.seats[0].id].inventory.RGZ_91 = 1;
  assert.equal((await host.act("sweep_extract")).phase, "finished");
  const results = room.economyAwards.filter((a) => a.kind === "result");
  assert.equal(results.length, 2);
  const result = await guest.act("sync");
  assert.equal(room.economyAwards.filter((a) => a.kind === "result").length, 2);
  const guestIds = new Set(
    room.economyAwards.filter((a) => a.memberId === room.seats[2].id).map((a) => a.id),
  );
  assert(result.economyAwards.every((a) => guestIds.has(a.id)));
  assert(!result.economyAwards.some((a) => a.stockGained?.inventory.RGZ_91));
});
