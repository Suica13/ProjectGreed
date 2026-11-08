const test = require("node:test"),
  assert = require("node:assert/strict"),
  zlib = require("node:zlib"),
  { decode, expandHTML } = require("../shared/catalog-codec.cjs"),
  AssetPool = require("../shared/asset-pool");
const source = {
  models: {},
  prefabs: [],
  units: [],
  assets: { unit: "data:image/png;base64,eA==" },
  sounds: {},
};
const pack = (value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    catalogEncoding: "gzip-base64",
    uncompressedBytes: bytes.length,
    payload: zlib.gzipSync(bytes).toString("base64"),
  };
};
test("standalone catalog compression is lossless and native/HTTP expansion retains resource pooling", () => {
  const packed = AssetPool.pack(source),
    wrapper = pack(packed);
  assert.deepEqual(decode(wrapper), packed);
  assert.deepEqual(AssetPool.unpack(wrapper), source);
  const html = '<script id="art" type="application/json">' + JSON.stringify(wrapper) + "</script>";
  const expanded = expandHTML(html);
  assert(!expanded.includes("gzip-base64"));
  assert(expanded.includes("assetSources"));
});
test("corrupt or oversized catalog containers are rejected", () => {
  assert.throws(() => decode({ ...pack(source), uncompressedBytes: 1 }));
  assert.throws(() => decode({ ...pack(source), uncompressedBytes: 1024 ** 3 }));
  assert.throws(() => decode({ ...pack(source), payload: "invalid" }));
});
