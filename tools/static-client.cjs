"use strict";
const fs = require("node:fs/promises"),
  zlib = require("node:zlib"),
  { promisify } = require("node:util");
const gzip = promisify(zlib.gzip),
  brotli = promisify(zlib.brotliCompress);
function encoding(header = "") {
  const values = new Map(
    header
      .toLowerCase()
      .split(",")
      .map((part) => {
        const [name, ...parameters] = part.trim().split(";");
        const q = parameters.find((p) => p.trim().startsWith("q="));
        const value = q ? Number(q.trim().slice(2)) : 1;
        return [name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0];
      }),
  );
  const quality = (name) => values.get(name) ?? values.get("*") ?? 0;
  const choices = ["br", "gzip"]
    .filter((name) => quality(name) > 0)
    .sort((a, b) => quality(b) - quality(a));
  return (
    choices[0] ||
    ((values.get("identity") ?? (values.get("*") === 0 ? 0 : 1)) > 0 ? "identity" : null)
  );
}
function createStaticClient({ transform = async (value) => value } = {}) {
  const cache = new Map();
  return async function serve(req, res, file) {
    try {
      const stat = await fs.stat(file),
        stamp = stat.size + ":" + stat.mtimeMs;
      let entry = cache.get(file);
      if (!entry || entry.stamp !== stamp) {
        entry = {
          stamp,
          etag: `W/"${stamp}"`,
          modified: stat.mtime.toUTCString(),
          raw: null,
          encoded: new Map(),
        };
        cache.set(file, entry);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("ETag", entry.etag);
      res.setHeader("Last-Modified", entry.modified);
      if (
        String(req.headers["if-none-match"] || "")
          .split(",")
          .map((v) => v.trim())
          .some((value) => value === entry.etag || value === "*")
      ) {
        // Rebuild the media URL registry even when a browser reuses cached HTML
        // after a server restart.
        entry.raw ||= fs.readFile(file).then((raw) => transform(raw, file));
        await entry.raw;
        res.writeHead(304);
        res.end();
        return;
      }
      const selected = encoding(req.headers["accept-encoding"]);
      if (!selected) {
        res.writeHead(406);
        res.end();
        return;
      }
      if (selected !== "identity") res.setHeader("Content-Encoding", selected);
      if (req.method === "HEAD") {
        if (selected === "identity") {
          entry.raw ||= fs.readFile(file).then((raw) => transform(raw, file));
          res.setHeader("Content-Length", (await entry.raw).length);
        }
        res.writeHead(200);
        res.end();
        return;
      }
      let data;
      if (selected !== "identity") {
        if (!entry.encoded.has(selected))
          entry.encoded.set(
            selected,
            (async () => {
              const sidecar = file + (selected === "gzip" ? ".gz" : ".br");
              try {
                const sideStat = await fs.stat(sidecar);
                if (sideStat.mtimeMs >= stat.mtimeMs) return await fs.readFile(sidecar);
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
              entry.raw ||= fs.readFile(file).then((raw) => transform(raw, file));
              const raw = await entry.raw;
              return selected === "gzip"
                ? gzip(raw, { level: 6 })
                : brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
            })(),
          );
        data = await entry.encoded.get(selected);
      } else {
        entry.raw ||= fs.readFile(file).then((raw) => transform(raw, file));
        data = await entry.raw;
      }
      res.setHeader("Content-Length", data.length);
      res.writeHead(200);
      res.end(data);
    } catch (error) {
      cache.delete(file);
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.removeHeader("Content-Encoding");
      res.removeHeader("Content-Length");
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Client not built. Run npm run build.");
    }
  };
}
module.exports = { createStaticClient, encoding };
