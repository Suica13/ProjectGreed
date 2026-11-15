const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const WebSocket = require("ws"),
  Wire = require("../shared/state-wire"),
  G = require("../shared/rules");
const { createServer } = require("../server");
test("3v3 battlefield broadcasts preserve legacy/delta clients and private reserves under repeated updates", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0, aiDelayMs: 999999 }),
    address = await app.listen(),
    peers = [];
  t.after(async () => {
    for (const peer of peers) peer.ws.terminate();
    await app.close();
  });
  async function connect(index) {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`),
      decoder = Wire.createDecoder(),
      frames = [],
      raw = [];
    const peer = { ws, frames, raw };
    peers.push(peer);
    ws.on("message", (data) => {
      const message = JSON.parse(data);
      raw.push(message);
      frames.push(index % 2 ? message : decoder.decode(message));
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    peer.wait = async (predicate, start = 0) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const found = frames.slice(start).find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error("Frame timeout " + JSON.stringify(frames.at(-1)));
    };
    ws.send(
      JSON.stringify({
        type: "hello",
        version: require("../project.json").version,
        stateDelta: index % 2 ? undefined : 1,
        room: "LOAD3V3",
        roomMode: "battlefield",
        mode: index ? "join" : "create",
        characterFaction: "PMC",
        licenses: { Medea: true },
        inventory: { Medea: 5 },
      }),
    );
    await peer.wait((f) => f.type === "state");
    peer.act = async (action, fields = {}) => {
      const room = app.rooms.get("LOAD3V3"),
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
      const result = await peer.wait(
        (f) => (f.type === "state" && f.ack === id) || (f.type === "error" && f.id === id),
        start,
      );
      assert.equal(result.type, "state", result.message);
      return result;
    };
    return peer;
  }
  for (let i = 0; i < 6; i++) await connect(i);
  const host = peers[0],
    room = app.rooms.get("LOAD3V3"),
    formation = [{ unitId: "Medea", kitId: "standard" }];
  await host.act("configure_room", { ...room.settings, fogMode: "disabled" });
  for (const peer of peers.slice(1)) await peer.act("set_ready", { ready: true, formation });
  await host.act("start_game", { formation });
  for (const peer of peers) await peer.act("confirm_formation");
  for (const peer of peers) await peer.act("confirm_deployment");
  assert.equal(room.phase, "idle");
  for (let i = room.game.units.length; i < 180; i++)
    room.game.units.push(
      G.makeUnit(
        { unitId: "Type61", kitId: "standard" },
        2 + (i % 6),
        "load-" + i,
        { x: 3 + (i % 20), y: 3 + Math.floor(i / 20) },
        0,
        7319,
      ),
    );
  const carrier = room.game.units.find((u) => u.ownerSeat === 2 && !u.facility);
  for (let i = 0; i < 8; i++) {
    const from = peers.map((p) => p.frames.length),
      state = await host.act("set_hangar_ai_access", { unitId: carrier.id, allowed: !!(i % 2) });
    for (const [index, peer] of peers.entries()) {
      const view = await peer.wait(
        (f) => f.type === "state" && f.revision === state.revision,
        from[index],
      );
      assert(view.game.units.length >= 180);
      assert.equal(view.game.units.find((u) => u.id === carrier.id).allowAIBoarding, !!(i % 2));
      assert.equal(view.game.seed, undefined);
      assert.equal(view.game.partSeed, undefined);
      assert(
        view.game.battlefield.reserves.every((r) => r.ownerSeat === view.you.seat && !r.template),
      );
    }
  }
  for (const [index, peer] of peers.entries())
    assert.equal(
      peer.raw.some((f) => f.type === "state_delta"),
      index % 2 === 0,
    );
});
