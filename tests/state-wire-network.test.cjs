const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws"),
  { createServer } = require("../server.js"),
  Wire = require("../shared/state-wire.js"),
  version = require("../project.json").version;
async function peer(url, delta) {
  const ws = new WebSocket(url),
    decoder = Wire.createDecoder(),
    raw = [],
    messages = [],
    listeners = new Set();
  ws.on("message", (data) => {
    const message = JSON.parse(data);
    raw.push(message);
    messages.push(delta ? decoder.decode(message) : message);
    for (const fn of listeners) fn();
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  function wait(predicate, from = 0) {
    return new Promise((resolve, reject) => {
      const done = () => {
        const found = messages.slice(from).find(predicate);
        if (found) {
          clearTimeout(timer);
          listeners.delete(done);
          resolve(found);
        }
      };
      const timer = setTimeout(() => {
        listeners.delete(done);
        reject(Error("WS timeout"));
      }, 4000);
      listeners.add(done);
      done();
    });
  }
  return { ws, raw, messages, wait, send: (value) => ws.send(JSON.stringify(value)) };
}
test("negotiated real WebSockets receive deltas, legacy peers receive full states, sync and reconnect reset baselines", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    url = `ws://127.0.0.1:${address.port}/ws`,
    host = await peer(url, true),
    guest = await peer(url, false);
  t.after(async () => {
    host.ws.terminate();
    guest.ws.terminate();
    await app.close();
  });
  host.send({
    type: "hello",
    version,
    stateDelta: 1,
    characterFaction: "PMC",
    mode: "create",
    room: "WIRETEST",
    inventory: { Type61: 10 },
  });
  const joined = await host.wait((m) => m.type === "joined");
  await host.wait((m) => m.type === "state");
  guest.send({ type: "hello", version, characterFaction: "PMC", mode: "join", room: "WIRETEST" });
  await guest.wait((m) => m.type === "state");
  for (let i = 0; i < 4; i++) {
    const from = host.messages.length,
      id = randomUUID(),
      state = [...host.messages].reverse().find((m) => m.type === "state");
    host.send({
      type: "action",
      action: "set_ready",
      ready: false,
      formation: [{ unitId: "Type61", kitId: "standard" }],
      id,
      revision: state.revision,
    });
    const next = await host.wait((m) => m.type === "state" && m.ack === id, from);
    assert(!("seed" in next.game));
    assert(!("partSeed" in next.game));
    assert(next.members.every((m) => m.id === joined.memberId || m.inventory === undefined));
  }
  assert(host.raw.some((m) => m.type === "state_delta"));
  assert(!guest.raw.some((m) => m.type === "state_delta" || m.wireSequence));
  const sync = randomUUID(),
    from = host.raw.length;
  host.send({ type: "action", action: "sync", id: sync });
  await host.wait((m) => m.ack === sync);
  assert.equal(host.raw[from].type, "state");
  assert(host.raw[from].wireSequence);
  const again = await peer(url, true);
  t.after(() => again.ws.terminate());
  again.send({
    type: "hello",
    version,
    stateDelta: 1,
    characterFaction: "PMC",
    mode: "resume",
    room: "WIRETEST",
    token: joined.token,
  });
  await again.wait((m) => m.type === "state");
  assert.equal(again.raw.find((m) => m.type === "state").wireSequence, 1);
});
