const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http"),
  zlib = require("node:zlib");
const Pool = require("../shared/asset-pool.js"),
  Wire = require("../shared/state-wire.js");
test("asset pool round-trips the complete live catalog without losing any IDs or source metadata", () => {
  const catalog = require("../tools/load-catalog.cjs").loadCatalog({ embedMusic: true }),
    before = JSON.stringify(catalog),
    packed = Pool.pack(catalog),
    encoded = JSON.stringify(packed);
  assert(encoded.length < before.length * 0.8);
  assert.equal(JSON.stringify(catalog), before);
  assert.equal(JSON.stringify(Pool.unpack(JSON.parse(encoded))), before);
  assert.throws(() =>
    Pool.unpack({ assetPoolVersion: 1, assetSources: [], assets: { bad: 9 }, sounds: {} }),
  );
});
function state() {
  return {
    type: "state",
    room: "TEST",
    you: { id: "p", seat: 0 },
    viewTeam: 0,
    matchId: "match",
    revision: 1,
    game: {
      units: [
        { id: "a", hp: 100, pilot: { name: "custom" } },
        { id: "b", hp: 50 },
      ],
      tiles: Array.from({ length: 32 }, () => Array(32).fill("plain")),
      round: 1,
    },
    log: [],
    ack: "one",
  };
}
test("state deltas exactly reconstruct mutations, deletions, order and removed top-level fields", () => {
  const encoder = Wire.createEncoder(),
    decoder = Wire.createDecoder(),
    source = state();
  const first = JSON.parse(encoder.encode(source));
  assert(first.wireSequence);
  assert.deepEqual(decoder.decode(first), source);
  source.game.units[0].hp = 90;
  delete source.ack;
  source.game.units.reverse();
  source.revision++;
  const patch = JSON.parse(encoder.encode(source));
  assert.equal(patch.type, "state_delta");
  assert.deepEqual(decoder.decode(patch), source);
  const delivered = decoder.decode(JSON.parse(encoder.encode(source)));
  delivered.game.units[0].hp = -999;
  source.game.units.pop();
  source.game.units.push({ id: "c", hp: 12 });
  source.log.unshift("event");
  source.game.tiles[0][0] = "rock";
  assert.deepEqual(decoder.decode(JSON.parse(encoder.encode(source))), source);
  source.game.units = [];
  assert.deepEqual(decoder.decode(JSON.parse(encoder.encode(source))), source);
});
test("connection, match and perspective changes reset to full; lost deltas require resynchronization", () => {
  const encoder = Wire.createEncoder(),
    decoder = Wire.createDecoder(),
    source = state();
  decoder.decode(JSON.parse(encoder.encode(source)));
  source.revision++;
  encoder.encode(source);
  source.revision++;
  assert.throws(() => decoder.decode(JSON.parse(encoder.encode(source))), /baseline/);
  encoder.reset();
  assert.deepEqual(decoder.decode(JSON.parse(encoder.encode(source))), source);
  for (const change of [
    { viewTeam: 1 },
    { matchId: "new" },
    { room: "OTHER" },
    { you: { id: "other", seat: null } },
  ]) {
    Object.assign(source, change);
    const message = JSON.parse(encoder.encode(source));
    assert.equal(message.type, "state");
    assert.deepEqual(decoder.decode(message), source);
  }
});
test("hidden units are removed and no seed or token can enter a filtered state through delta reuse", () => {
  const encoder = Wire.createEncoder(),
    decoder = Wire.createDecoder(),
    source = state();
  decoder.decode(JSON.parse(encoder.encode(source)));
  source.game.units = [source.game.units[0]];
  source.revision++;
  const raw = encoder.encode(source),
    result = decoder.decode(JSON.parse(raw));
  assert.equal(result.game.units.length, 1);
  assert(!raw.includes("seed"));
  assert(!raw.includes("token"));
});
function request(port, method = "GET", headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/", method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}
test("encoding negotiation honors explicit exclusions, wildcard exclusions and quality weights", () => {
  const { encoding } = require("../tools/static-client.cjs");
  assert.equal(encoding("*;q=0"), null);
  assert.equal(encoding("br;q=0,gzip;q=0.5"), "gzip");
  assert.equal(encoding("gzip;q=invalid"), "identity");
});
test("HTML negotiates compression, revalidates cache, avoids HEAD bodies and refreshes after rebuild", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "greed-http-")),
    file = path.join(directory, "client.html"),
    content = "hello world ".repeat(20000);
  fs.writeFileSync(file, content);
  const serve = require("../tools/static-client.cjs").createStaticClient(),
    server = http.createServer((req, res) => serve(req, res, file));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const port = server.address().port;
  const gzip = await request(port, "GET", { "accept-encoding": "gzip" });
  assert.equal(gzip.headers["content-encoding"], "gzip");
  assert.equal(zlib.gunzipSync(gzip.body).toString(), content);
  const br = await request(port, "GET", { "accept-encoding": "gzip;q=0.5, br" });
  assert.equal(br.headers["content-encoding"], "br");
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), content);
  const plain = await request(port, "GET", { "accept-encoding": "br;q=0,gzip;q=0" });
  assert.equal(plain.body.toString(), content);
  const cached = await request(port, "GET", { "if-none-match": gzip.headers.etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  const head = await request(port, "HEAD");
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(content));
  fs.writeFileSync(file, "updated " + content);
  const updated = await request(port, "GET", {
    "accept-encoding": "gzip",
    "if-none-match": gzip.headers.etag,
  });
  assert.equal(updated.status, 200);
  assert.equal(zlib.gunzipSync(updated.body).toString(), "updated " + content);
  assert.equal(
    (await request(port, "GET", { "accept-encoding": "gzip;q=0,br;q=0,identity;q=0" })).status,
    406,
  );
});
