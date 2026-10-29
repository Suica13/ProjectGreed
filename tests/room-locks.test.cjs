const test = require("node:test"),
  assert = require("node:assert/strict");
const WS = require("ws"),
  { createServer } = require("../server.js"),
  version = require("../project.json").version;
test("WebSocket room locks enforce passwords for players and spectators, expose only lock state, and permit token resume", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    await app.close();
  });
  async function request(body) {
    const ws = new WS(`ws://127.0.0.1:${address.port}/ws`);
    clients.push(ws);
    const messages = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw)));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify(body));
    const wait = async (predicate) => {
      const end = Date.now() + 4000;
      while (Date.now() < end) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error(JSON.stringify(messages));
    };
    return {
      ws,
      messages,
      wait,
      reply: await wait((m) => ["joined", "error", "rooms"].includes(m.type)),
    };
  }
  const hello = { type: "hello", version, characterFaction: "PMC", room: "LOCKTEST" };
  const invalid = await request({ ...hello, mode: "create", locked: true, password: "" });
  assert.equal(invalid.reply.type, "error");
  assert.equal(app.rooms.size, 0);
  const host = await request({
    ...hello,
    mode: "create",
    roomMode: "quick",
    locked: true,
    password: "Secret-123",
  });
  assert.equal(host.reply.type, "joined");
  const state = await host.wait((m) => m.type === "state");
  assert.equal(state.settings.costLimit, 1000);
  assert.equal(state.settings.unitCostLimit, 200);
  assert.equal(state.settings.unitLimit, 12);
  assert.equal(state.settings.mode, "quick");
  const list = await request({ type: "list_rooms" });
  assert.equal(list.reply.rooms[0].locked, true);
  for (const password of [undefined, "wrong", 123, "x".repeat(65)]) {
    const rejected = await request({ ...hello, mode: "join", password });
    assert.equal(rejected.reply.type, "error");
  }
  const guest = await request({ ...hello, mode: "join", password: "Secret-123" });
  assert.equal(guest.reply.type, "joined");
  const room = app.rooms.get("LOCKTEST");
  room.started = true;
  room.phase = "idle";
  const deniedSpectator = await request({ ...hello, mode: "join" });
  assert.equal(deniedSpectator.reply.type, "error");
  const spectator = await request({ ...hello, mode: "join", password: "Secret-123" });
  assert.equal(spectator.reply.seat, null);
  const resumed = await request({ ...hello, mode: "resume", token: host.reply.token });
  assert.equal(resumed.reply.seat, host.reply.seat);
  const badResume = await request({ ...hello, mode: "resume", token: "invalid" });
  assert.equal(badResume.reply.type, "error");
  for (const client of [host, guest, list, spectator, resumed]) {
    const text = JSON.stringify(client.messages);
    assert.ok(!text.includes("Secret-123"));
    assert.ok(!text.includes("passwordMatches"));
  }
  const open = await request({ ...hello, room: "OPENROOM", mode: "create" });
  assert.equal(open.reply.type, "joined");
  const openGuest = await request({ ...hello, room: "OPENROOM", mode: "join" });
  assert.equal(openGuest.reply.type, "joined");
});
