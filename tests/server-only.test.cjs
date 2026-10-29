const test = require("node:test");
const assert = require("node:assert/strict");
const WS = require("ws");
const { version } = require("../project.json");
const { createServer } = require("../server.js");

test("dedicated server retains health and local activity administration, excludes game and developer routes", async (t) => {
  const app = createServer({ dedicated: true, host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  const ws = new WS(`ws://127.0.0.1:${address.port}/ws`);
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const joined = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("room join timeout")), 3000);
    ws.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (["joined", "error"].includes(message.type)) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  ws.send(
    JSON.stringify({
      type: "hello",
      version,
      characterFaction: "PMC",
      room: "DEDICATED",
      mode: "create",
      roomMode: "quick",
    }),
  );
  assert.equal((await joined).type, "joined");

  assert.equal((await (await fetch(base + "/health")).json()).ok, true);
  assert.match(await (await fetch(base + "/")).text(), /dedicated server/);
  const admin = await fetch(base + "/admin/activities.html");
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /<html/i);
  assert.ok((await (await fetch(base + "/api/activities/admin")).json()).activities.length);
  for (const route of [
    "/client.html",
    "/developer.html",
    "/api/developer/session",
    "/client-assets/missing.png",
  ]) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
});
