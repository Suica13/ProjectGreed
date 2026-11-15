const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createServer } = require("../server"),
  G = require("../shared/rules");

test("two sweep players receive fresh deployment on successive nodes while observers never block progress", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1", aiDelayMs: 999999 });
  const address = await app.listen(),
    sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
  });
  async function connect(mode) {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`),
      frames = [];
    sockets.push(ws);
    ws.on("message", (raw) => frames.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    async function wait(predicate, start = 0) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const frame = frames.slice(start).find(predicate);
        if (frame) return frame;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error("Timed out: " + JSON.stringify(frames.at(-1)));
    }
    ws.send(
      JSON.stringify({
        type: "hello",
        version: require("../project.json").version,
        mode,
        room: "SWEEPNODES",
        roomMode: "sweep",
        characterFaction: "PMC",
        inventory: { Medea: 5 },
        licenses: { Medea: true },
      }),
    );
    await wait((f) => f.type === "state");
    return {
      ws,
      frames,
      wait,
      async act(action, fields = {}) {
        const room = app.rooms.get("SWEEPNODES"),
          id = randomUUID(),
          start = frames.length;
        ws.send(
          JSON.stringify({
            type: "action",
            id,
            action,
            revision: room.revision,
            phase: room.phase,
            round: room.game.round,
            matchId: room.matchId,
            ...fields,
          }),
        );
        const result = await wait(
          (f) => (f.type === "state" && f.ack === id) || (f.type === "error" && f.id === id),
          start,
        );
        assert.equal(result.type, "state", result.message);
        return result;
      },
    };
  }
  const host = await connect("create"),
    guest = await connect("join"),
    room = app.rooms.get("SWEEPNODES");
  const formation = [{ unitId: "Medea", kitId: "standard" }];
  await guest.act("set_ready", { formation, ready: true });
  await host.act("start_game", { formation });
  await host.act("confirm_formation");
  await guest.act("confirm_formation");
  assert.equal(room.phase, "sweep_map");
  for (let node = 0; node < 2; node++) {
    const next = require("../shared/sweep-mode").view(room, room.hostId).reachable[0];
    room.sweep.nodes.find((n) => n.id === next).type = "battle";
    await host.act("sweep_select", { nodeId: next });
    const launch = await host.act("sweep_confirm");
    assert.equal(launch.phase, "deployment");
    const remote = await guest.wait(
      (f) => f.type === "state" && f.phase === "deployment" && f.sweep?.battleIndex === node + 1,
    );
    assert.equal(remote.sweep.battleIndex, node + 1);
    assert.equal(room.game.deployment[0], false);
    assert.equal(room.game.deployment[2], false);
    assert(room.game.units.some((u) => u.team === 1 && u.embarked));
    await host.act("confirm_deployment");
    assert.equal((await guest.act("confirm_deployment")).phase, "idle");
    room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
    room.game.winner = 0;
    room.phase = "finished";
    const observer = await connect("join");
    const route = await host.act("sync");
    assert.equal(route.phase, "sweep_map");
    observer.ws.terminate();
    await guest.wait(
      (f) => f.type === "state" && f.phase === "sweep_map" && f.sweep?.depth === node,
    );
    assert.equal(room.sweep.ended, false);
  }
});
