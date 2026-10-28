"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http");
const Pool = require("../shared/asset-pool.js");
const { createClientResources } = require("../tools/client-resources.cjs");
const G = require("../shared/rules.js");
test("animations and payloads share immutable templates while weapon names remain independent", () => {
  const clip = {
    duration: 1,
    curves: {
      Body: {
        x: [
          [0, 0],
          [1, 5],
        ],
      },
    },
  };
  const weapon = { name: "Test", attack: { steps: [{ shots: 1 }] }, damageComponents: { beam: 5 } };
  const source = {
    assets: {},
    sounds: {},
    units: [{ animations: { idle: clip } }, { animations: { idle: clip } }],
    prefabs: [],
    models: { a: { weapons: [weapon] }, b: { weapons: [weapon] } },
  };
  const restored = Pool.unpack(JSON.parse(JSON.stringify(Pool.pack(source))));
  assert.equal(restored.units[0].animations.idle, restored.units[1].animations.idle);
  assert.equal(restored.models.a.weapons[0].attack, restored.models.b.weapons[0].attack);
  restored.models.a.weapons[0].name = "Edited";
  assert.equal(restored.models.b.weapons[0].name, "Test");
  assert.throws(() => {
    restored.models.a.weapons[0].attack.steps[0].shots = 5;
  }, TypeError);
});
test("MS COST follows native level conversion with the two requested exceptions", () => {
  const overrides = { MS_06C: 500, MS_07B3: 375 };
  for (const prefab of G.catalog.prefabs.filter((p) => p.sourceStats?.nativeTags?.includes("MS"))) {
    const expected =
      overrides[prefab.id] ||
      Math.max(25, Math.floor(prefab.sourceStats.unitLevel / 100 + 0.5) * 25);
    assert.equal(prefab.stats.cost, expected, prefab.id);
  }
  assert.equal(G.models.MS_14A__machine_gun.cost, 375);
  assert.equal(G.catalog.prefabs.find((p) => p.id === "RX_78NT_1").stats.cost, 875);
});
test("HTTP media and icons are content-addressed while the source document stays standalone", async (t) => {
  const service = createClientResources();
  const audio = "data:audio/ogg;base64," + Buffer.from("0123456789").toString("base64");
  const icon = "data:image/png;base64," + Buffer.from("icon").toString("base64");
  const catalog = {
    assetSources: [icon, audio],
    assets: { icon: 0 },
    units: [{ icon: "icon" }],
    music: { tracks: [{ source: audio }] },
  };
  const original =
    '<script id="art" type="application/json">' + JSON.stringify(catalog) + "</script>";
  const transformed = (await service.transform(Buffer.from(original))).toString();
  const parsed = JSON.parse(transformed.match(/>(.*)</)[1]);
  assert.match(parsed.assetSources[0], /^\/client-assets\//);
  assert(original.includes(icon));
  assert.equal(parsed.assetSources[1], parsed.music.tracks[0].source);
  assert(original.includes(audio));
  const server = http.createServer(
    (req, res) => service.serve(req, res, req.url) || res.end("none"),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(path, headers = {}) {
    return new Promise((resolve, reject) =>
      http
        .get({ hostname: "127.0.0.1", port: server.address().port, path, headers }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        })
        .on("error", reject),
    );
  }
  const url = parsed.music.tracks[0].source;
  const full = await request(url);
  assert.equal(full.body, "0123456789");
  assert.match(full.headers["cache-control"], /immutable/);
  assert.equal((await request(url, { "If-None-Match": full.headers.etag })).status, 304);
  const part = await request(url, { Range: "bytes=2-5" });
  assert.equal(part.status, 206);
  assert.equal(part.body, "2345");
  assert.equal((await request(url, { Range: "bytes=100-" })).status, 416);
  assert.equal((await request("/client-assets/../../cfg.json")).status, 404);
});
const crypto = require("node:crypto");
test("restored tabs can load cached media URLs before fetching HTML after server restart", async (t) => {
  const audio = "data:audio/ogg;base64," + Buffer.from("restart-media").toString("base64");
  const html =
    '<script id="art" type="application/json">' +
    JSON.stringify({ assetSources: [audio], assets: {}, units: [] }) +
    "</script>";
  let documents = 0;
  const service = createClientResources({
    loadDocument: async () => {
      documents++;
      return Buffer.from(html);
    },
  });
  const server = http.createServer(
    (req, res) => service.serve(req, res, req.url) || res.end("none"),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url =
    "/client-assets/" + crypto.createHash("sha256").update("restart-media").digest("hex") + ".ogg";
  const body = await new Promise((resolve, reject) =>
    http
      .get({ hostname: "127.0.0.1", port: server.address().port, path: url }, (response) => {
        assert.equal(response.statusCode, 200);
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString()));
      })
      .on("error", reject),
  );
  assert.equal(body, "restart-media");
  assert.equal(documents, 1);
});
