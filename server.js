/* 联机服务端：HTTP 提供网页，WebSocket 管理房间并裁定动作。
 * 房间保存在内存中。开发者源文件编辑仅允许本机访问。
 */
"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws"),
  project = require("./project.json"),
  { createRoomEngine } = require("./shared/room-engine.js"),
  G = require("./shared/rules.js");
function createServer({
  port = 1313,
  host = "0.0.0.0",
  heartbeatMs = 20000,
  heartbeatTimeoutMs = Math.max(90000, heartbeatMs * 3),
  resultReturnMs = 30000,
  roomReturnMs = 5000,
  aiDelayMs = 500,
  aiBattleMs = 10000,
  hostReconnectMs = 60000,
  reconnectGraceMs = 60000,
} = {}) {
  const rooms = new Map(),
    publicDir = path.join(__dirname, "public");
  // The proxy keeps this server's engine on the current catalog after a developer rebuild.
  let currentRules = G;
  const rules = new Proxy({}, { get: (_, key) => currentRules[key] });
  const developerAPI = require("./tools/developer-api.cjs").createDeveloperAPI({
    rooms,
    onReload: () => {
      for (const name of [
        "./shared/rules.js",
        "./shared/development.js",
        "./shared/development-tree.json",
        "./shared/economy.js",
        "./shared/battle-economy.js",
        "./shared/production-catalog.json",
      ])
        delete require.cache[require.resolve(name)];
      currentRules = require("./shared/rules.js");
    },
  });
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.startsWith("/api/developer/")) {
      void developerAPI(req, res, new URL(req.url, "http://localhost"));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          project: project.name,
          version: project.version,
          protocol: 1,
          rooms: rooms.size,
        }),
      );
      return;
    }
    const file =
      pathname === "/" || pathname === "/index.html"
        ? path.join(publicDir, "client.html")
        : pathname === "/client.html"
          ? path.join(publicDir, "client.html")
          : pathname === "/developer.html"
            ? path.join(publicDir, "developer.html")
            : null;
    if (!file) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Client not built. Run npm run build.");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4 * 1024 * 1024, // Bounded normalized portraits may accompany a full formation.
    // 快照含大量重复的地块、单位和演出数据；仅压缩较大的消息。
    // 每连接不保留压缩历史，避免多人房间长期占用大量压缩上下文。
    perMessageDeflate: {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 4,
      zlibDeflateOptions: { level: 3 },
    },
  });
  const send = (ws, data) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  let lastRoomList = "";
  const engine = createRoomEngine({
    rules,
    createPasswordVerifier: (password) => {
      const salt = crypto.randomBytes(16),
        digest = crypto.scryptSync(password, salt, 32);
      return (candidate) => crypto.timingSafeEqual(digest, crypto.scryptSync(candidate, salt, 32));
    },
    rooms,
    send,
    resultReturnMs,
    roomReturnMs,
    aiDelayMs,
    aiBattleMs,
    hostReconnectMs,
    reconnectGraceMs,
    randomId: () => crypto.randomUUID(),
    randomSeed: () => crypto.randomBytes(4).readUInt32LE(),
    randomToken: () => crypto.randomBytes(24).toString("hex"),
    onRooms: (list) => {
      const serialized = JSON.stringify(list);
      if (serialized === lastRoomList) return;
      lastRoomList = serialized;
      for (const client of wss.clients)
        if (client.lobby) send(client, { type: "rooms", rooms: list });
    },
  });
  const {
    join,
    action,
    leaveRoom,
    broadcast,
    broadcastRooms,
    roomList,
    destroyRoom,
    members,
    onlineMember,
  } = engine;
  wss.on("connection", (ws, request) => {
    // 浏览器后台节流或短暂系统卡顿不应因一次延迟就失去席位。
    request.socket.setKeepAlive(true, heartbeatMs);
    ws.lastSeen = Date.now();
    ws.rateAt = Date.now();
    ws.rateCount = 0;
    ws.on("pong", () => (ws.lastSeen = Date.now()));
    ws.on("error", () => {});
    ws.on("message", (data, binary) => {
      ws.lastSeen = Date.now();
      let msg;
      try {
        if (binary) throw Error("仅支持JSON文本");
        if (Date.now() - ws.rateAt > 1000) {
          ws.rateAt = Date.now();
          ws.rateCount = 0;
        }
        if (++ws.rateCount > 60) throw Error("操作过于频繁");
        msg = JSON.parse(data.toString());
        const formationAction =
          msg?.type === "action" &&
          ["set_ready", "start_game", "update_formation", "confirm_formation"].includes(msg.action);
        const payloadLimit = formationAction
          ? 4 * 1024 * 1024
          : msg?.action === "record_upload_chunk"
            ? 128 * 1024
            : 16384;
        if (data.length > payloadLimit) throw Error("消息过大。");
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw Error("消息格式无效");
        if (msg.type === "ping") send(ws, { type: "pong" });
        else if (msg.type === "list_rooms") {
          ws.lobby = true;
          send(ws, { type: "rooms", rooms: roomList() });
        } else if (msg.type === "leave") leaveRoom(ws);
        else if (msg.type === "hello") {
          if (developerAPI.busy()) throw Error("正在重载，请稍后连接");
          // Check before creating a room or consuming a reconnect token. Older
          // clients without this field must not enter a newer server either.
          if (msg.version !== project.version) {
            send(ws, {
              type: "error",
              code: "VERSION_MISMATCH",
              serverVersion: project.version,
              message: `版本不匹配：服务器为 ${project.version}，客户端为 ${typeof msg.version === "string" ? msg.version.slice(0, 32) : "旧版本（未提供版本号）"}。请使用与服务器相同版本的客户端。`,
            });
            return;
          }
          if (!["PMC", "EFSF", "ZEON"].includes(msg.characterFaction))
            throw Error("请使用最新客户端并选择角色阵营后加入房间。");
          join(ws, msg);
        } else if (msg.type === "action") action(ws, msg);
        else throw Error("未知消息类型");
      } catch (err) {
        send(ws, {
          type: "error",
          id: typeof msg?.id === "string" ? msg.id : undefined,
          message: err.message,
        });
      }
    });
    ws.on("close", () => engine.disconnect(ws));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (Date.now() - ws.lastSeen > heartbeatTimeoutMs) {
        ws.terminate();
        continue;
      }
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
    let removed = false;
    for (const r of rooms.values())
      if (!members(r).some(onlineMember)) {
        destroyRoom(r);
        removed = true;
      }
    if (removed) broadcastRooms();
  }, heartbeatMs);
  heartbeat.unref();
  function listen() {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.removeListener("error", reject);
        resolve(server.address());
      });
    });
  }
  async function close() {
    clearInterval(heartbeat);
    engine.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
  return { listen, close, server, rooms };
}
function loadConfig({
  configPath = path.join(__dirname, "cfg.json"),
  args = process.argv.slice(2),
  env = process.env,
} = {}) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw Error("无法读取 cfg.json：" + err.message);
  }
  if (
    !cfg ||
    typeof cfg !== "object" ||
    Array.isArray(cfg) ||
    !Number.isInteger(cfg.port) ||
    cfg.port < 1 ||
    cfg.port > 65535
  )
    throw Error("cfg.json 的 port 必须是 1–65535 的整数");
  const arg = args.indexOf("--port");
  const port =
    arg >= 0 ? Number(args[arg + 1]) : env.PORT !== undefined ? Number(env.PORT) : cfg.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("端口必须是 1–65535 的整数");
  return { port };
}
if (require.main === module) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { port } = config,
    app = createServer(config);
  app
    .listen()
    .then(() => {
      console.log(`\n${project.name} ${project.version} 联机服务端已启动\n`);
      console.log("发布版网页: http://127.0.0.1:" + port);
      console.log("开发者版: http://127.0.0.1:" + port + "/developer.html");
      let networkInterfaces = {};
      try {
        networkInterfaces = os.networkInterfaces();
      } catch {
        console.log("无法枚举局域网IP，请手动查看本机IP。");
      }
      for (const interfaces of Object.values(networkInterfaces))
        for (const addr of interfaces || [])
          if (addr.family === "IPv4" && !addr.internal)
            console.log("局域网网页: http://" + addr.address + ":" + port);
      console.log(
        "\n修改服务端目录中的 cfg.json 后重启，可更换端口。\n网页中输入同一服务器IP和房间码，分别创建/加入房间。\n关闭窗口或 Ctrl+C 停止服务。\n",
      );
    })
    .catch((err) => {
      console.error(
        err.code === "EADDRINUSE" ? "端口已占用，请修改 cfg.json 的 port 后重新启动" : err.message,
      );
      process.exit(1);
    });
}
module.exports = { createServer, loadConfig };
