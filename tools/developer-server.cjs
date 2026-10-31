/* Authenticated standalone editor. JSON saves do not rebuild or reload game servers. */
"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  net = require("node:net");
const { createEditorStore } = require("./catalog-editor-store.cjs");
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
function clientAllowed(address, entries) {
  if (entries === null) return true;
  address = address.replace(/^::ffff:/, "");
  if (["127.0.0.1", "::1"].includes(address)) return true;
  return entries.some((entry) => {
    if (!entry.includes("/")) return address === entry;
    const [network, bits] = entry.split("/"),
      count = Number(bits);
    if (
      net.isIP(address) !== 4 ||
      net.isIP(network) !== 4 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 32
    )
      return false;
    const number = (ip) =>
        ip.split(".").reduce((result, octet) => (result * 256 + Number(octet)) >>> 0, 0),
      mask = (0xffffffff << (32 - count)) >>> 0;
    return (number(address) & mask) === (number(network) & mask);
  });
}
function createDeveloperServer({
  root = path.resolve(__dirname, ".."),
  port = 1314,
  host = "127.0.0.1",
  allowedClients = null,
  key = process.env.PROJECTGREED_EDITOR_KEY || "13450",
  store = createEditorStore(root),
  catalog = () => require("./load-catalog.cjs").loadCatalog(),
} = {}) {
  if (["0.0.0.0", "::", ""].includes(host)) throw Error("请指定编辑服务绑定的具体IP");
  const sessions = new Map(),
    failures = new Map(),
    metadata = {
      service: "ProjectGreedCatalogEditor",
      workspaceId: digest(path.resolve(root).toLowerCase()).toString("hex"),
      protocol: 2,
    };
  let busy = false;
  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw Error("编辑请求过大");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      if (!clientAllowed(req.socket.remoteAddress, allowedClients))
        return send(403, { error: "当前IP未获编辑访问授权。" });
      const origin = req.headers.origin;
      if (origin && origin !== "null") {
        let match = false;
        try {
          match = new URL(origin).host === req.headers.host;
        } catch {}
        if (!match) return send(403, { error: "请独立打开开发者HTML，或使用编辑服务提供的页面。" });
      }
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Editor-Token");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "GET" && ["/", "/developer.html"].includes(url.pathname)) {
        const file = path.join(root, "public/developer.html");
        if (!fs.existsSync(file)) return send(404, { error: "请先执行 npm run build:developer" });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (url.pathname === "/api/editor/session") {
        if (req.method === "GET") return send(200, metadata);
        if (req.method === "POST") {
          const now = Date.now(),
            address = req.socket.remoteAddress,
            failure = failures.get(address);
          for (const [id, value] of failures) if (value.until <= now) failures.delete(id);
          if (failure?.until > now && failure.count >= 10)
            return send(429, { error: "密钥尝试过于频繁，请稍后再试。" });
          const value = await body(req);
          if (
            typeof value.key !== "string" ||
            !crypto.timingSafeEqual(digest(value.key), digest(key))
          ) {
            failures.set(address, {
              count: (failure?.until > now ? failure.count : 0) + 1,
              until: now + 60000,
            });
            return send(401, { error: "密钥不正确。" });
          }
          failures.delete(address);
          for (const [id, expires] of sessions) if (expires <= now) sessions.delete(id);
          const token = crypto.randomBytes(32).toString("hex");
          sessions.set(token, now + 8 * 3600000);
          return send(200, { ...metadata, token });
        }
      }
      if ((sessions.get(req.headers["x-editor-token"]) || 0) <= Date.now())
        return send(401, { error: "编辑会话失效，请重新输入密钥连接。" });
      if (req.method === "GET") {
        if (url.pathname === "/api/editor/conversion") return send(200, store.getConversion());
        if (url.pathname === "/api/editor/wip") return send(200, store.getWip());
        if (url.pathname === "/api/editor/unit")
          return send(200, store.getUnit(url.searchParams.get("id")));
        if (url.pathname === "/api/editor/weapon")
          return send(200, store.getWeapon(url.searchParams.get("ref")));
        if (url.pathname === "/api/editor/templates") return send(200, store.templates());
        if (url.pathname === "/api/editor/bootstrap") {
          const data = catalog();
          data.sounds = {};
          data.music = [];
          data.maps = {};
          return send(200, {
            catalog: require("../shared/asset-pool.js").pack(data),
            production: require("../shared/catalog-adjustments.cjs").production(
              JSON.parse(
                fs.readFileSync(path.join(root, "shared/production-catalog.json"), "utf8"),
              ),
              require("../shared/catalog-adjustments.cjs").read(root),
            ),
            locales: {
              en: JSON.parse(fs.readFileSync(path.join(root, "client/locales/en.json"), "utf8")),
              ja: JSON.parse(fs.readFileSync(path.join(root, "client/locales/ja.json"), "utf8")),
            },
          });
        }
        if (url.pathname === "/api/editor/catalog") {
          const data = catalog();
          return send(200, {
            prefabs: data.prefabs,
            models: data.models,
            units: data.units,
            ...(url.searchParams.has("assets") ? { assets: data.assets } : {}),
            production: require("../shared/catalog-adjustments.cjs").production(
              JSON.parse(
                fs.readFileSync(path.join(root, "shared/production-catalog.json"), "utf8"),
              ),
              require("../shared/catalog-adjustments.cjs").read(root),
            ),
          });
        }
      }
      if (
        req.method === "POST" &&
        [
          "/api/editor/unit",
          "/api/editor/weapon",
          "/api/editor/conversion",
          "/api/editor/wip",
        ].includes(url.pathname)
      ) {
        if (busy) return send(409, { error: "另一项保存正在进行" });
        busy = true;
        try {
          const value = await body(req);
          const actor = {
            ip: req.socket.remoteAddress,
            sessionId: digest(req.headers["x-editor-token"]).toString("hex").slice(0, 16),
          };
          return send(
            200,
            url.pathname.endsWith("/unit")
              ? store.saveUnit(value, actor)
              : url.pathname.endsWith("/conversion")
                ? store.saveConversion(value, actor)
                : url.pathname.endsWith("/wip")
                  ? store.saveWip(value, actor)
                  : store.saveWeapon(value, actor),
          );
        } finally {
          busy = false;
        }
      }
      send(404, { error: "接口不存在" });
    } catch (error) {
      send(error.status || 400, { error: error.message });
    }
  });
  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
if (require.main === module) {
  const file = path.resolve(__dirname, "../developer-config.json"),
    config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const app = createDeveloperServer({
    ...config,
    key: process.env.PROJECTGREED_EDITOR_KEY || config.key || "13450",
    port: Number(process.argv[2]) || config.port || 1314,
  });
  app
    .listen()
    .then((address) =>
      console.log(
        "编辑服务已启动：http://" + address.address + ":" + address.port + "/developer.html",
      ),
    )
    .catch((error) => {
      console.error("编辑服务启动失败：" + error.message);
      process.exitCode = 1;
    });
}
module.exports = { createDeveloperServer, clientAllowed };
