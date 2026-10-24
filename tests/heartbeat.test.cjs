const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events");
const WebSocket = require("ws"),
  { createServer } = require("../server.js");

test("heartbeat tolerates multiple missed pongs, accepts transport-only keepalive and eventually closes dead sockets", async (t) => {
  const app = createServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatMs: 30,
    heartbeatTimeoutMs: 450,
  });
  const address = await app.listen();
  const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/ws", { autoPong: false });
  t.after(async () => {
    ws.terminate();
    await app.close();
  });
  const frames = [];
  ws.on("message", (raw) => frames.push(JSON.parse(raw)));
  let pings = 0;
  ws.on("ping", () => pings++);
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "hello", mode: "create", room: "HEARTBEAT", name: "Background" }));
  async function until(check) {
    const end = Date.now() + 1500;
    while (!check()) {
      assert.ok(Date.now() < end, "condition timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  await until(() => frames.some((f) => f.type === "state"));
  const room = app.rooms.get("HEARTBEAT"),
    revision = room.revision,
    memberId = room.hostId;
  await until(() => pings >= 4);
  assert.equal(
    ws.readyState,
    WebSocket.OPEN,
    "one missing pong must not disconnect a background player",
  );
  ws.send(JSON.stringify({ type: "ping" }));
  await until(() => frames.some((f) => f.type === "pong"));
  assert.equal(room.revision, revision, "keepalive must not change gameplay or readiness");
  assert.equal(room.hostId, memberId);
  await until(() => pings >= 8);
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.pong();
  await until(() => pings >= 12);
  assert.equal(ws.readyState, WebSocket.OPEN);
  const closed = once(ws, "close");
  await closed;
  assert.equal(ws.readyState, WebSocket.CLOSED, "genuine silent sockets are still reclaimed");
});
