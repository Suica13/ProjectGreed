/* Node build/HTTP adapter for the losslessly packed standalone catalog. */
"use strict";
const zlib = require("node:zlib");
function decode(catalog) {
  if (catalog.catalogEncoding !== "gzip-base64") return catalog;
  if (
    typeof catalog.payload !== "string" ||
    !Number.isSafeInteger(catalog.uncompressedBytes) ||
    catalog.uncompressedBytes < 1 ||
    catalog.uncompressedBytes > 256 * 1024 * 1024
  )
    throw Error("Invalid compressed catalog");
  const bytes = zlib.gunzipSync(Buffer.from(catalog.payload, "base64"), {
    maxOutputLength: catalog.uncompressedBytes,
  });
  if (bytes.length !== catalog.uncompressedBytes) throw Error("Catalog size mismatch");
  return JSON.parse(bytes.toString("utf8"));
}
function expandHTML(html) {
  return html.replace(
    /(<script\s+id="art"\s+type="application\/json">)([\s\S]*?)(<\/script>)/,
    (_all, open, data, close) =>
      open + JSON.stringify(decode(JSON.parse(data))).replace(/</g, "\\u003c") + close,
  );
}
module.exports = { decode, expandHTML };
