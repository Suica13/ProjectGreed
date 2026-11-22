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

test("complete standalone HTML stays below the V136 pre-cleanup size budget", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const bytes = fs.statSync(path.join(__dirname, "../public/client.html")).size;
  assert(bytes < 160249566, "Generated client regressed beyond the V136 baseline");
});

test("music and auxiliary icons share media without removing playlist entries or changing bytes", () => {
  const image = source.assets.unit,
    audio = "data:audio/mpeg;base64,YXVkaW8=";
  const catalog = {
    ...source,
    music: {
      tracks: [
        { name: "a", source: audio },
        { name: "b", source: audio },
      ],
    },
    clientData: { pilots: [{ icon: image }, { icon: image }], tree: { icon: image } },
  };
  const before = JSON.stringify(catalog),
    packed = AssetPool.pack(catalog);
  assert.equal(packed.assetSources.length, 2);
  assert.equal(packed.music.tracks.length, 2);
  assert.equal(packed.music.tracks[0].source, packed.music.tracks[1].source);
  assert.equal(JSON.stringify(AssetPool.unpack(structuredClone(packed))), before);
  assert.equal(JSON.stringify(catalog), before);
  packed.music.tracks[0].source = 999;
  assert.throws(() => AssetPool.unpack(packed), /Invalid pooled media reference/);
});
