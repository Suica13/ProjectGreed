/* 联机服务端：HTTP 提供网页，WebSocket 管理房间并裁定动作。
 * 房间保存在内存中。UI 编辑不经过这里，也不改变规则权限。
 */
"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws"),
  G = require("./shared/rules.js");
function createServer({ port = 1313, host = "0.0.0.0", heartbeatMs = 20000 } = {}) {
  const rooms = new Map(),
    publicDir = path.join(__dirname, "public");
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, protocol: 1, rooms: rooms.size }));
      return;
    }
    const file =
      pathname === "/" || pathname === "/index.html"
        ? path.join(publicDir, "index.html")
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
    maxPayload: 16384,
    perMessageDeflate: false,
  });
  const send = (ws, data) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  const connected = (room) => room.seats.map((s) => !!s?.ws && s.ws.readyState === WebSocket.OPEN);
  // 公开快照不包含随机 seed；席位 token 不放入广播。
  const safeGame = (game) => {
    let { seed, ...view } = game;
    return view;
  };
  function state(room, ack) {
    return {
      type: "state",
      room: room.code,
      revision: room.revision,
      game: safeGame(room.game),
      phase: room.phase,
      pending: room.pending,
      battle: room.battle,
      connected: connected(room),
      started: room.started,
      log: room.log,
      lastEvent: room.lastEvent,
      ack,
    };
  }
  function broadcast(room, ack) {
    room.updated = Date.now();
    for (const s of room.seats) send(s?.ws, state(room, ack));
  }
  function log(room, text) {
    room.log.unshift(text);
    room.log = room.log.slice(0, 80);
  }
  const unit = (room, id) => room.game.units.find((u) => u.id === id);
  function ownUnit(room, seat, id) {
    let u = unit(room, id);
    if (!u || u.team !== seat || u.hp <= 0) throw Error("不能操作该单位");
    return u;
  }
  function validateActive(room, seat) {
    if (!room.started || !connected(room).every(Boolean)) throw Error("等待双方玩家连接后继续");
    if (room.game.winner !== null) throw Error("战斗已经结束");
    if (room.game.team !== seat) throw Error("当前不是你的回合");
    if (room.phase !== "idle") throw Error("请先完成当前交战");
  }
  // 权限、请求去重和 revision 校验通过后，才调用共用规则。
  function action(ws, msg) {
    let room = rooms.get(ws.room),
      seat = ws.seat;
    if (!room || room.seats[seat]?.ws !== ws) throw Error("请先加入房间");
    let id = msg.id;
    if (typeof id !== "string" || id.length < 4 || id.length > 100) throw Error("请求编号无效");
    const cache = room.seats[seat].requests;
    if (cache.has(id)) {
      send(ws, state(room, id));
      return;
    }
    if (msg.action === "sync") {
      send(ws, state(room, id));
      return;
    }
    if (!room.started || !connected(room).every(Boolean)) throw Error("对手已断线，等待重连后继续");
    if (msg.action === "battle_ready") {
      if (room.phase !== "battle" || msg.battleId !== room.battle?.id)
        throw Error("交战已经结束或编号不一致");
      room.battle.ready[seat] = true;
      cache.set(id, true);
      if (room.battle.ready.every(Boolean)) {
        room.phase = room.game.winner === null ? "idle" : "finished";
        room.battle = null;
        room.revision++;
        room.lastEvent = { id: crypto.randomUUID(), type: "battle_end" };
      }
      broadcast(room, id);
      return;
    }
    if (!Number.isSafeInteger(msg.revision) || msg.revision !== room.revision) {
      send(ws, {
        type: "error",
        id,
        code: "STALE",
        message: "战局已更新，已重新同步，请重试。",
      });
      send(ws, state(room));
      return;
    }
    let event;
    switch (msg.action) {
      case "move": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y)) throw Error("目标格无效");
        let from = { x: u.x, y: u.y },
          steps = G.move(room.game, u, msg.x, msg.y);
        event = { type: "move", unitId: u.id, from, path: steps };
        log(
          room,
          `${seat ? "红方" : "蓝方"} ${G.models[u.model].name}移动至${String.fromCharCode(65 + u.x)}${u.y + 1}。`,
        );
        break;
      }
      case "undo": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (u.acted || !u.origin) throw Error("无法撤销移动");
        G.undo(room.game, u);
        event = { type: "undo", unitId: u.id };
        log(room, "已撤销移动。");
        break;
      }
      case "wait": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        G.wait(room.game, u);
        event = { type: "wait", unitId: u.id };
        log(room, `${seat ? "红方" : "蓝方"} ${G.models[u.model].name}待机。`);
        break;
      }
      case "end_turn": {
        validateActive(room, seat);
        G.end(room.game);
        event = { type: "turn" };
        log(
          room,
          `第${room.game.round}回合 · ${room.game.team ? "红方" : "蓝方"}行动开始，恢复15 EN。`,
        );
        break;
      }
      case "attack": {
        validateActive(room, seat);
        let a = ownUnit(room, seat, msg.unitId),
          b = unit(room, msg.targetId),
          w = G.models[a.model].weapons.find((w) => w.id === msg.weaponId);
        if (a.acted || !w || !b || !G.canAttack(room.game, a, b, w))
          throw Error("目标、武器、射程或资源不满足条件");
        room.pending = { attacker: a.id, target: b.id, weapon: w.id };
        room.phase = "reaction";
        event = { type: "attack", ...room.pending };
        log(
          room,
          `${seat ? "红方" : "蓝方"} ${G.models[a.model].name}选择${w.name}，等待对手应战。`,
        );
        break;
      }
      case "cancel_attack": {
        if (room.phase !== "reaction" || unit(room, room.pending.attacker)?.team !== seat)
          throw Error("只有进攻方能取消选目标");
        room.pending = null;
        room.phase = "idle";
        event = { type: "cancel_attack" };
        break;
      }
      case "respond": {
        if (room.phase !== "reaction" || !room.pending) throw Error("当前没有待应战的攻击");
        let a = unit(room, room.pending.attacker),
          b = unit(room, room.pending.target);
        if (b.team !== seat) throw Error("只有被攻击方能选择应战");
        let w = G.models[a.model].weapons.find((w) => w.id === room.pending.weapon),
          before = Object.fromEntries(room.game.units.map((u) => [u.id, u.hp]));
        let events = G.fight(room.game, a, b, w, msg.response, msg.counterId);
        room.battle = {
          id: crypto.randomUUID(),
          a: a.id,
          b: b.id,
          events,
          before,
          ready: [false, false],
        };
        room.phase = "battle";
        room.pending = null;
        event = { type: "battle", battleId: room.battle.id };
        for (const e of events) {
          let from = unit(room, e.from),
            to = unit(room, e.to),
            weapon = G.models[from.model].weapons.find((w) => w.id === e.weapon);
          log(
            room,
            `${from.team ? "红方" : "蓝方"} ${G.models[from.model].name} · ${weapon.name} → ${G.models[to.model].name}：${e.hit ? e.damage + "伤害" : "未命中"}${e.after <= 0 ? "，击破！" : ""}`,
          );
        }
        break;
      }
      default:
        throw Error("不支持的操作");
    }
    room.revision++;
    room.lastEvent = { id: crypto.randomUUID(), ...event };
    cache.set(id, true);
    if (cache.size > 512) cache.delete(cache.keys().next().value);
    broadcast(room, id);
  }
  function join(ws, msg) {
    if (ws.room) throw Error("当前连接已经加入房间");
    let code = String(msg.room || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code))
      throw Error("房间码需为3–20位英文字母、数字、下划线或短横线");
    if (!["create", "join", "resume"].includes(msg.mode)) throw Error("无效的加入方式");
    let room = rooms.get(code),
      seat = -1;
    if (msg.mode === "create") {
      if (room) throw Error("房间已存在，请使用加入房间或换一个房间码");
      if (rooms.size >= 64) throw Error("房间数量已满");
      room = {
        code,
        game: G.create(false, crypto.randomBytes(4).readUInt32LE()),
        phase: "waiting",
        revision: 0,
        seats: [null, null],
        pending: null,
        battle: null,
        started: false,
        log: ["房间已创建，等待红方玩家加入。"],
        lastEvent: null,
        updated: Date.now(),
      };
      rooms.set(code, room);
      seat = 0;
    } else {
      if (!room) throw Error("房间不存在，请确认IP和房间码；服务端重启后需重新创建");
      if (msg.mode === "resume") {
        if (typeof msg.token !== "string") throw Error("缺少重连凭据");
        seat = room.seats.findIndex((s) => s?.token === msg.token);
        if (seat < 0) throw Error("重连凭据无效，请重新创建或加入其他房间");
      } else {
        if (room.seats[1]) throw Error("房间已有两名玩家；刷新页面请使用恢复连接");
        seat = 1;
      }
    }
    if (!room.seats[seat])
      room.seats[seat] = {
        token: crypto.randomBytes(24).toString("hex"),
        ws: null,
        requests: new Map(),
      };
    let old = room.seats[seat].ws;
    room.seats[seat].ws = ws;
    ws.room = code;
    ws.seat = seat;
    if (old && old !== ws) {
      send(old, { type: "replaced", message: "此席位已在另一个连接恢复" });
      old.close(4001, "Session resumed elsewhere");
    }
    if (room.seats.every(Boolean) && !room.started) {
      room.started = true;
      room.phase = "idle";
      room.revision++;
      log(room, "双方已连接，蓝方先手。");
    }
    send(ws, {
      type: "joined",
      protocol: 1,
      room: code,
      seat,
      token: room.seats[seat].token,
    });
    broadcast(room);
  }
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.rateAt = Date.now();
    ws.rateCount = 0;
    ws.on("pong", () => (ws.alive = true));
    ws.on("error", () => {});
    ws.on("message", (data, binary) => {
      let msg;
      try {
        if (binary) throw Error("仅支持JSON文本");
        if (Date.now() - ws.rateAt > 1000) {
          ws.rateAt = Date.now();
          ws.rateCount = 0;
        }
        if (++ws.rateCount > 60) throw Error("操作过于频繁");
        msg = JSON.parse(data.toString());
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw Error("消息格式无效");
        if (msg.type === "hello") join(ws, msg);
        else if (msg.type === "action") action(ws, msg);
        else throw Error("未知消息类型");
      } catch (err) {
        send(ws, {
          type: "error",
          id: typeof msg?.id === "string" ? msg.id : undefined,
          message: err.message,
        });
      }
    });
    ws.on("close", () => {
      let room = rooms.get(ws.room);
      if (room && room.seats[ws.seat]?.ws === ws) {
        room.seats[ws.seat].ws = null;
        broadcast(room);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
    for (const [key, r] of rooms)
      if (!connected(r).some(Boolean) && Date.now() - r.updated > 3600000) rooms.delete(key);
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
      console.log("\n0079 SLG 联机服务端已启动\n");
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
