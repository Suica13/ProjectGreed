/* Reproducible size report for the standalone HTML and its embedded catalog. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const root = path.resolve(__dirname, "..");
function audit(filename = path.join(root, "public/client.html")) {
  const html = fs.readFileSync(filename, "utf8");
  const match = /<script\s+id="art"\s+type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw Error("Client catalog not found");
  const catalog = require(path.join(root, "shared/catalog-codec.cjs")).decode(JSON.parse(match[1]));
  const fields = Object.entries(catalog)
    .map(([name, value]) => ({ name, bytes: Buffer.byteLength(JSON.stringify(value)) }))
    .sort((a, b) => b.bytes - a.bytes);
  const media = new Map();
  for (const uri of catalog.assetSources || []) {
    const mime = /^data:([^;,]+)/.exec(uri)?.[1] || "external";
    const item = media.get(mime) || { mime, count: 0, bytes: 0 };
    item.count++;
    item.bytes += Buffer.byteLength(uri);
    media.set(mime, item);
  }
  return {
    htmlBytes: Buffer.byteLength(html),
    catalogHTMLBytes: Buffer.byteLength(match[1]),
    otherHTMLBytes: Buffer.byteLength(html) - Buffer.byteLength(match[1]),
    fields,
    pooledMedia: [...media.values()].sort((a, b) => b.bytes - a.bytes),
    music: (catalog.music?.tracks || []).map((t) => ({
      name: t.name,
      bytes: Buffer.byteLength(
        (typeof t.source === "number" ? catalog.assetSources[t.source] : t.source) || "",
      ),
    })),
    gzipHTMLBytes: zlib.gzipSync(html, { level: 6 }).length,
  };
}
if (require.main === module) console.log(JSON.stringify(audit(process.argv[2]), null, 2));
module.exports = { audit };
