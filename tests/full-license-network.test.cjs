const test = require("node:test"),
  assert = require("node:assert/strict");
const WebSocket = require("ws"),
  G = require("../shared/rules"),
  { createServer } = require("../server");
const project = require("../project.json");
function profile() {
  const ids = G.catalog.prefabs.map((p) => p.id);
  return {
    characterFaction: "PMC",
    licenses: Object.fromEntries(ids.map((id) => [id, true])),
    inventory: Object.fromEntries(ids.map((id) => [id, 5])),
  };
}
async function connect(url, t) {
  const ws = new WebSocket(url),
    frames = [];
  ws.on("message", (data) => frames.push(JSON.parse(data)));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  t?.after(() => ws.terminate());
  const send = (msg) => ws.send(JSON.stringify(msg));
  const wait = async (predicate) => {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const frame = frames.find(predicate);
      if (frame) return frame;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error(JSON.stringify(frames.at(-1)));
  };
  return { ws, frames, send, wait };
}
test("full catalog licenses and inventory can create, join and resume online rooms", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1" });
  t.after(() => app.close());
  const address = await app.listen(),
    url = `ws://127.0.0.1:${address.port}/ws`,
    stock = profile();
  const hello = {
    type: "hello",
    version: project.version,
    ...stock,
    room: "FULLLICENSE",
    roomMode: "quick",
  };
  assert(Buffer.byteLength(JSON.stringify(hello)) > 16384, "fixture must reproduce the old limit");
  const host = await connect(url, t);
  host.send({ ...hello, mode: "create" });
  const joined = await host.wait((m) => m.type === "joined" || m.type === "error");
  assert.equal(joined.type, "joined", joined.message);
  const guest = await connect(url, t);
  guest.send({ ...hello, mode: "join" });
  const joinedGuest = await guest.wait((m) => m.type === "joined" || m.type === "error");
  assert.equal(joinedGuest.type, "joined", joinedGuest.message);
  const room = app.rooms.get("FULLLICENSE"),
    member = room.members.get(joined.memberId);
  assert.equal(
    Object.keys(member.licenses).length,
    Object.keys(G.normalizeLicenses(stock.licenses)).length,
  );
  await host.wait((m) => m.type === "state");
  host.send({
    type: "action",
    action: "set_ready",
    id: "full-profile-ready",
    revision: room.revision,
    ...stock,
    ready: false,
  });
  const result = await host.wait(
    (m) => m.id === "full-profile-ready" || m.ack === "full-profile-ready",
  );
  assert.notEqual(result.type, "error", result.message);
  host.ws.terminate();
  await new Promise((r) => setTimeout(r, 40));
  const resumed = await connect(url, t);
  resumed.send({ ...hello, mode: "resume", token: joined.token });
  const rejoined = await resumed.wait((m) => m.type === "joined" || m.type === "error");
  assert.equal(rejoined.type, "joined", rejoined.message);
  assert.equal(rejoined.memberId, joined.memberId);
});
test("ordinary messages retain the smaller size limit", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1" });
  t.after(() => app.close());
  const address = await app.listen(),
    client = await connect(`ws://127.0.0.1:${address.port}/ws`, t);
  client.send({ type: "ping", padding: "x".repeat(17000) });
  const reply = await client.wait((m) => m.type === "error");
  assert.equal(reply.message, "消息过大。");
});
