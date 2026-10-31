/* Authenticated standalone editor. JSON saves do not rebuild or reload game servers. */
"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  net = require("node:net");
const { gzipSync } = require("node:zlib");
const { resolveEditorHost } = require("./developer-host.cjs");
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
  logger = null,
  key = process.env.PROJECTGREED_EDITOR_KEY || "13450",
  store = createEditorStore(root),
  catalog = () => require("./load-catalog.cjs").loadCatalog({ embedAssets: false }),
} = {}) {
  host = resolveEditorHost(host);
  if (["0.0.0.0", "::", ""].includes(host)) throw Error("请指定编辑服务绑定的具体IP");
  const sessions = new Map(),
    failures = new Map(),
    metadata = {
      service: "ProjectGreedCatalogEditor",
      workspaceId: digest(path.resolve(root).toLowerCase()).toString("hex"),
      protocol: 2,
      dataOnlyVersion: 1,
      incrementalCatalog: true,
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
  function editorCatalog() {
    const data = catalog();
    // The editor fetches complete source JSON only when editing an individual item.
    // These drawing-only fields are unused by its text-based catalog and inspector.
    const prefabs = data.prefabs.map((prefab) => {
      const { materials, skeleton, layers, animations, source, sourceStats, ...editable } = prefab;
      return editable;
    });
    return { ...data, prefabs, units: [], assets: {}, sounds: {}, music: [], maps: {}, effects: {} };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      const json = Buffer.from(JSON.stringify(value));
      const compressed = json.length > 2048 && /(?:^|,)\s*gzip(?:\s*;\s*q=(?!0(?:\.0*)?(?:\s|,|$))[0-9.]+)?(?:\s|,|$)/i.test(req.headers["accept-encoding"] || "");
      const payload = compressed ? gzipSync(json, { level: 3 }) : json;
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Origin, Accept-Encoding",
        "Content-Length": payload.length,
        "X-Editor-JSON-Bytes": json.length,
        "Access-Control-Expose-Headers": "X-Editor-JSON-Bytes",
        ...(compressed ? { "Content-Encoding": "gzip" } : {}),
      });
      res.end(payload);
    };
    try {
      const url = new URL(req.url, "http://localhost");
      if (logger) {
        const routes = ["/api/editor/session", "/api/editor/bootstrap", "/api/editor/unit", "/api/editor/weapon", "/api/editor/conversion", "/api/editor/wip"];
        const route = routes.includes(url.pathname) ? url.pathname : "其他接口";
        res.once("finish", () => {
          if (res.statusCode >= 400 || (req.method === "POST" && routes.includes(url.pathname)) || url.pathname === "/api/editor/bootstrap") {
            const result = url.pathname === "/api/editor/session" && req.method === "POST"
              ? (res.statusCode === 200 ? "认证通过" : "认证失败")
              : "请求完成";
            logger(`[${new Date().toISOString()}] ${req.socket.remoteAddress} ${result} ${req.method} ${route} HTTP ${res.statusCode} · 发送 ${res.getHeader("Content-Length") || 0} 字节`);
          }
        });
      }
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
      if (!clientAllowed(req.socket.remoteAddress, allowedClients))
        return send(403, { error: "当前IP未获编辑访问授权。" });
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
          const data = editorCatalog();
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
          const data = editorCatalog();
          const selected = url.searchParams.get("ids");
          let ids = null;
          if (selected !== null) {
            ids = [...new Set(selected.split(",").filter(Boolean))];
            if (ids.length > 512 || ids.some((id) => !/^[A-Za-z0-9_-]+$/.test(id)))
              return send(400, { error: "单位刷新列表无效" });
          }
          const wanted = ids && new Set(ids);
          const production = require("../shared/catalog-adjustments.cjs").production(
            JSON.parse(fs.readFileSync(path.join(root, "shared/production-catalog.json"), "utf8")),
            require("../shared/catalog-adjustments.cjs").read(root),
          );
          return send(200, {
            partial: !!ids,
            ids,
            prefabs: wanted ? data.prefabs.filter((prefab) => wanted.has(prefab.id)) : data.prefabs,
            models: wanted ? Object.fromEntries(Object.entries(data.models).filter(([, model]) => wanted.has(model.prefabId))) : data.models,
            units: [],
            assets: {},
            production: wanted ? Object.fromEntries(
              ["defaultKits", "licenseOffers"].map((field) => [field,
                Object.fromEntries(Object.entries(production[field]).filter(([id]) => wanted.has(id))),
              ]),
            ) : production,
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
    logger: (message) => console.log(message),
    key: process.env.PROJECTGREED_EDITOR_KEY || config.key || "13450",
    port: Number(process.argv[2]) || config.port || 1314,
  });
  app
    .listen()
    .then((address) => {
      console.log("编辑服务已启动：http://" + address.address + ":" + address.port);
      console.log("等待管理员连接；此窗口显示连接与编辑请求。关闭窗口或按 Ctrl+C 停止服务。");
      console.log("管理员独立打开 developer.html，输入服务器地址与密钥即可。此服务不会自动打开网页。");
    })
    .catch((error) => {
      console.error("编辑服务启动失败：" + error.message);
      if (error.code === "EADDRINUSE") console.error("此端口已被占用，可能已有旧编辑服务在后台运行。请先停止旧服务，或修改 developer-config.json 的 port。");
      process.exitCode = 1;
    });
}
module.exports = { createDeveloperServer, clientAllowed };
