"use strict";
// HTTP uses cacheable media URLs; the same built HTML remains self-contained on disk.
const crypto = require("node:crypto");
function createClientResources({ loadDocument = null } = {}) {
  let hydration = null;
  const assets = new Map();
  async function transform(buffer) {
    const html = buffer.toString("utf8");
    const match = /(<script id="art" type="application\/json">)([\s\S]*?)(<\/script>)/.exec(html);
    if (!match) return buffer;
    const catalog = JSON.parse(match[2]);
    if (!Array.isArray(catalog.assetSources)) return buffer;
    function media(source) {
      const encoded = /^data:(image\/png|audio\/ogg|audio\/mpeg);base64,([\s\S]+)$/.exec(source);
      if (!encoded) return source;
      const bytes = Buffer.from(encoded[2], "base64");
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      const extension = { "image/png": "png", "audio/ogg": "ogg", "audio/mpeg": "mp3" }[encoded[1]];
      const url = `/client-assets/${hash}.${extension}`;
      if (!assets.has(url)) assets.set(url, { bytes, type: encoded[1], etag: `"${hash}"` });
      return url;
    }
    for (let index = 0; index < catalog.assetSources.length; index++) {
      catalog.assetSources[index] = media(catalog.assetSources[index]);
      if (index % 32 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    for (const track of catalog.music?.tracks || [])
      if (track.source) track.source = media(track.source);
    const json = JSON.stringify(catalog).replace(/</g, "\\u003c");
    return Buffer.from(
      html.slice(0, match.index) +
        match[1] +
        json +
        match[3] +
        html.slice(match.index + match[0].length),
    );
  }
  function serve(req, res, pathname, hydrated = false) {
    if (!pathname.startsWith("/client-assets/")) return false;
    const entry =
      /^\/client-assets\/[a-f0-9]{64}\.(png|ogg|mp3)$/.test(pathname) && assets.get(pathname);
    if (
      !entry &&
      !hydrated &&
      loadDocument &&
      /^\/client-assets\/[a-f0-9]{64}\.(png|ogg|mp3)$/.test(pathname)
    ) {
      // A restored tab can request media before re-requesting its cached page.
      hydration ||= Promise.resolve().then(loadDocument).then(transform);
      hydration
        .then(() => {
          if (!res.destroyed) serve(req, res, pathname, true);
        })
        .catch(() => {
          hydration = null;
          if (!res.destroyed) {
            res.writeHead(503);
            res.end("Client resources unavailable");
          }
        });
      return true;
    }
    if (!entry) {
      res.writeHead(404);
      res.end("Not found");
      return true;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return true;
    }
    res.setHeader("Content-Type", entry.type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", entry.etag);
    res.setHeader("Accept-Ranges", "bytes");
    if (req.headers["if-none-match"] === entry.etag) {
      res.writeHead(304);
      res.end();
      return true;
    }
    let start = 0,
      end = entry.bytes.length - 1,
      status = 200;
    const range = req.headers.range;
    if (range && (!req.headers["if-range"] || req.headers["if-range"] === entry.etag)) {
      const part = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (part && (part[1] || part[2])) {
        if (part[1]) {
          start = Number(part[1]);
          if (part[2]) end = Number(part[2]);
        } else start = Math.max(0, entry.bytes.length - Number(part[2]));
        end = Math.min(end, entry.bytes.length - 1);
      } else start = -1;
      if (start < 0 || start > end || start >= entry.bytes.length) {
        res.writeHead(416, { "Content-Range": `bytes */${entry.bytes.length}` });
        res.end();
        return true;
      }
      status = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${entry.bytes.length}`);
    }
    res.setHeader("Content-Length", end - start + 1);
    res.writeHead(status);
    res.end(req.method === "HEAD" ? undefined : entry.bytes.subarray(start, end + 1));
    return true;
  }
  return { transform, serve };
}
module.exports = { createClientResources };
