const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveEditorHost } = require("../tools/developer-host.cjs");
const { createDeveloperServer } = require("../tools/developer-server.cjs");
const entry = (address, internal = false) => ({ address, family: "IPv4", internal });

test("LAN binding resolves one concrete private interface, excludes loopback and VPN", () => {
  const interfaces = { loopback: [entry("127.0.0.1", true)], vpn: [entry("25.1.2.3")], ethernet: [entry("192.168.0.234")] };
  assert.equal(resolveEditorHost("lan", interfaces), "192.168.0.234");
  assert.equal(resolveEditorHost("127.0.0.1", interfaces), "127.0.0.1");
  assert.equal(resolveEditorHost("10.0.0.7", interfaces), "10.0.0.7");
  assert.throws(() => resolveEditorHost("lan", { a: [entry("10.0.0.2")], b: [entry("192.168.0.3")] }), /无法唯一确定/);
  assert.throws(() => resolveEditorHost("lan", { loopback: [entry("127.0.0.1", true)] }), /可选：无/);
});

test("standalone HTML authentication supports CORS preflight, while foreign web origins remain blocked", async (t) => {
  const messages = [];
  const app = createDeveloperServer({ port: 0, logger: (message) => messages.push(message) });
  const address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  const preflight = await fetch(base + "/api/editor/session", {
    method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "null");
  const response = await fetch(base + "/api/editor/session", {
    method: "POST", headers: { Origin: "null", "Content-Type": "application/json" }, body: JSON.stringify({ key: "13450" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
  const session = await response.json();
  assert.equal(session.protocol, 2);
  assert(messages.some((message) => message.includes("127.0.0.1 认证通过 POST /api/editor/session HTTP 200")));
  assert(!messages.join("\n").includes(session.token));
  assert(!messages.join("\n").includes("13450"));
  const rejected = await fetch(base + "/api/editor/session", { headers: { Origin: "https://example.com" } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
  assert(messages.some((message) => message.includes("HTTP 403")));
});


test("remote bootstrap is compressed and excludes rendering data without changing source catalog", async (t) => {
  const source = require("../tools/load-catalog.cjs").loadCatalog({ embedAssets: false });
  const app = createDeveloperServer({ port: 0, catalog: () => source });
  const address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  const session = await (await fetch(base + "/api/editor/session", {
    method: "POST", body: JSON.stringify({ key: "13450" }),
  })).json();
  const response = await fetch(base + "/api/editor/bootstrap", {
    headers: { "X-Editor-Token": session.token, Origin: "null", "Accept-Encoding": "gzip" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  const text = await response.text();
  assert.equal(Buffer.byteLength(text), Number(response.headers.get("X-Editor-JSON-Bytes")));
  assert(Number(response.headers.get("Content-Length")) < Buffer.byteLength(text) / 4);
  const payload = JSON.parse(text);
  assert.deepEqual(payload.catalog.units, []);
  assert.deepEqual(payload.catalog.assets, {});
  assert.equal(payload.catalog.prefabs[0].layers, undefined);
  assert.equal(payload.catalog.prefabs.length, source.prefabs.length);
  assert(source.units.length > 0);
  assert(source.prefabs[0].layers.length > 0);
  assert(Object.values(payload.catalog.models).some((model) => model.prefabId === "RX_78_2" && model.hp > 0));
  const deltaResponse = await fetch(base + "/api/editor/catalog?ids=RX_78_2,Removed_Test_Unit", {
    headers: { "X-Editor-Token": session.token },
  });
  const delta = await deltaResponse.json();
  assert.equal(delta.partial, true);
  assert.deepEqual(delta.ids, ["RX_78_2", "Removed_Test_Unit"]);
  assert.deepEqual(delta.prefabs.map((prefab) => prefab.id), ["RX_78_2"]);
  assert(Object.values(delta.models).every((model) => model.prefabId === "RX_78_2"));
  assert.deepEqual(Object.keys(delta.production.defaultKits), ["RX_78_2"]);
  assert(Number(deltaResponse.headers.get("Content-Length")) < Number(response.headers.get("Content-Length")) / 10);
});
