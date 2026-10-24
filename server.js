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
  project = require("./project.json"),
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
  const onlineMember = (member) => member?.ws?.readyState === WebSocket.OPEN;
  const members = (room) => [...room.members.values()];
  function resetReady(room) {
    for (const member of members(room)) member.ready = false;
  }
  // 大厅只公开房间摘要，绝不发送战局 seed、席位 token 或完整对局数据。
  function roomList() {
    return [...rooms.values()]
      .map((room) => {
        const online = connected(room);
        return {
          code: room.code,
          players: online.filter(Boolean).length,
          capacity: 2,
          spectators: members(room).filter((member) => member.seat === null && onlineMember(member))
            .length,
          started: room.started,
          phase:
            room.game.winner !== null
              ? "finished"
              : room.started
                ? online.every(Boolean)
                  ? "playing"
                  : "disconnected"
                : "waiting",
          joinable: room.members.size < 32,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }
  function broadcastRooms() {
    const message = { type: "rooms", rooms: roomList() };
    for (const client of wss.clients) if (client.lobby) send(client, message);
  }
  function leaveRoom(ws) {
    const room = rooms.get(ws.room);
    const member = room?.members.get(ws.memberId);
    if (!member || member.ws !== ws) return;
    if (member.seat !== null) {
      room.seats[member.seat] = null;
      if (room.battle) room.battle.ready[member.seat] = false;
      if (!room.started) resetReady(room);
    }
    room.members.delete(member.id);
    delete ws.room;
    delete ws.memberId;
    delete ws.seat;
    send(ws, { type: "room_closed", message: "已离开房间。" });
    ws.close(1000, "Left room");
    if (!room.members.size) {
      rooms.delete(room.code);
      broadcastRooms();
    } else {
      room.revision++;
      broadcast(room);
    }
  }
  // 公开快照不包含随机 seed；席位 token 不放入广播。
  const safeGame = (game) => {
    let { seed, ...view } = game;
    return view;
  };
  function state(room, ack, recipient) {
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
      members: members(room).map((member) => ({
        id: member.id,
        name: member.name,
        seat: member.seat,
        ready: member.ready,
        connected: onlineMember(member),
      })),
      you: recipient ? { id: recipient.id, seat: recipient.seat } : undefined,
      log: room.log,
      lastEvent: room.lastEvent,
      ack,
    };
  }
  function broadcast(room, ack) {
    room.updated = Date.now();
    for (const member of members(room)) send(member.ws, state(room, ack, member));
    broadcastRooms();
    scheduleAutoEnd(room);
  }
  const autoEndTimers = new Map();
  function canAutoEnd(room) {
    return (
      rooms.get(room.code) === room &&
      room.started &&
      room.phase === "idle" &&
      room.game.winner === null &&
      connected(room).every(Boolean) &&
      !G.hasActions(room.game)
    );
  }
  function advanceTurn(room, automatic = false) {
    const fromTeam = room.game.team;
    G.end(room.game);
    room.turnNotBefore = Date.now() + G.turnTransitionMs;
    log(room, `第${room.game.round}回合 · 队伍${room.game.team + 1}开始行动，恢复15 EN。`);
    return { type: "turn", fromTeam, toTeam: room.game.team, round: room.game.round, automatic };
  }
  // 联机自动回合由服务端计时；断线、战斗或出现合法行动立即取消。
  function scheduleAutoEnd(room) {
    const old = autoEndTimers.get(room);
    if (!canAutoEnd(room)) {
      clearTimeout(old?.timer);
      autoEndTimers.delete(room);
      return;
    }
    if (old?.game === room.game && old.round === room.game.round) return;
    clearTimeout(old?.timer);
    const entry = { game: room.game, round: room.game.round };
    entry.timer = setTimeout(
      () => {
        autoEndTimers.delete(room);
        if (!canAutoEnd(room) || room.game !== entry.game || room.game.round !== entry.round)
          return;
        room.lastEvent = { id: crypto.randomUUID(), ...advanceTurn(room, true) };
        room.revision++;
        broadcast(room);
      },
      Math.max(0, (room.turnNotBefore || 0) - Date.now()) + 1000,
    );
    entry.timer.unref();
    autoEndTimers.set(room, entry);
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
    const member = room?.members.get(ws.memberId);
    if (!member || member.ws !== ws) throw Error("请先加入房间");
    let id = msg.id;
    if (typeof id !== "string" || id.length < 4 || id.length > 100) throw Error("请求编号无效");
    const cache = member.requests;
    if (cache.has(id)) {
      send(ws, state(room, id, member));
      return;
    }
    if (msg.action === "sync") {
      send(ws, state(room, id, member));
      return;
    }
    // 准备和席位操作同样有请求 ID、版本校验和去重，观战者只能使用这些房间操作。
    if (msg.action === "switch_seat" || msg.action === "set_ready") {
      if (!Number.isSafeInteger(msg.revision) || msg.revision !== room.revision) {
        send(ws, { type: "error", id, code: "STALE", message: "房间状态已更新，请重试。" });
        send(ws, state(room, undefined, member));
        return;
      }
      if (msg.action === "switch_seat") {
        const destination = msg.seat;
        if (destination !== null && destination !== 0 && destination !== 1)
          throw Error("无效的席位");
        if (destination !== null && room.seats[destination] && room.seats[destination] !== member)
          throw Error("这个队伍已有玩家");
        if (member.seat !== destination) {
          if (member.seat !== null) {
            room.seats[member.seat] = null;
            if (room.battle) room.battle.ready[member.seat] = false;
          }
          member.seat = destination;
          ws.seat = destination;
          member.ready = false;
          if (destination !== null) {
            room.seats[destination] = member;
            if (room.battle) room.battle.ready[destination] = false;
          }
          if (!room.started) resetReady(room);
        }
      } else {
        if (room.started) throw Error("游戏已经开始");
        if (member.seat === null) throw Error("观战玩家无需准备");
        if (typeof msg.ready !== "boolean") throw Error("准备状态无效");
        if (msg.ready) member.formation = G.validateFormation(msg.formation);
        member.ready = msg.ready;
        if (connected(room).every(Boolean) && room.seats.every((player) => player.ready)) {
          room.started = true;
          room.game = G.create(
            false,
            room.game.seed,
            room.seats.map((p) => p.formation),
            true,
          );
          room.phase = "deployment";
          log(room, "两队已准备，请在各自出生区部署并确认，随后队伍1先手。");
        }
      }
      room.revision++;
      cache.set(id, true);
      if (cache.size > 512) cache.delete(cache.keys().next().value);
      broadcast(room, id);
      return;
    }
    if (seat === null) throw Error("观战玩家不能操作战局");
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
      send(ws, state(room, undefined, member));
      return;
    }
    let event;
    switch (msg.action) {
      case "deploy": {
        if (room.phase !== "deployment") throw Error("Not deploying");
        G.deploy(room.game, seat, msg.unitId, msg.x, msg.y);
        break;
      }
      case "confirm_deployment": {
        if (room.phase !== "deployment") throw Error("Not deploying");
        if (G.confirmDeployment(room.game, seat)) room.phase = "idle";
        break;
      }
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
        event = advanceTurn(room);
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
            `${from.team ? "红方" : "蓝方"} ${G.models[from.model].name} · ${weapon.name} → ${G.models[to.model].name}：${e.hit ? e.damage + "伤害" : "未命中"}（命中 ${e.hitCount}/${e.strikeCount}）${e.after <= 0 ? "，击破！" : ""}`,
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
        members: new Map(),
        nextPlayerNumber: 1,
        pending: null,
        battle: null,
        started: false,
        log: ["房间已创建，两队准备后开始。"],
        lastEvent: null,
        updated: Date.now(),
      };
      rooms.set(code, room);
      seat = 0;
    } else {
      if (!room) throw Error("房间不存在，请确认IP和房间码；服务端重启后需重新创建");
      seat = room.started ? null : room.seats.findIndex((player) => !player);
      if (seat === -1) seat = null;
    }
    let member;
    if (msg.mode === "resume") {
      if (typeof msg.token !== "string") throw Error("缺少重连凭据");
      member = members(room).find((player) => player.token === msg.token);
      if (!member) throw Error("重连凭据无效，请重新加入房间");
      seat = member.seat;
    } else {
      if (room.members.size >= 32) throw Error("房间人数已满");
      member = {
        id: crypto.randomUUID(),
        name: "玩家" + room.nextPlayerNumber++,
        seat,
        ready: false,
        token: crypto.randomBytes(24).toString("hex"),
        ws: null,
        requests: new Map(),
      };
      room.members.set(member.id, member);
      if (seat !== null) {
        room.seats[seat] = member;
        if (!room.started) resetReady(room);
      }
    }
    let old = member.ws;
    member.ws = ws;
    ws.room = code;
    ws.seat = seat;
    ws.memberId = member.id;
    if (old && old !== ws) {
      send(old, { type: "replaced", message: "此席位已在另一个连接恢复" });
      old.close(4001, "Session resumed elsewhere");
    }
    room.revision++;
    send(ws, {
      type: "joined",
      protocol: 1,
      room: code,
      seat,
      memberId: member.id,
      token: member.token,
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
        if (msg.type === "list_rooms") {
          ws.lobby = true;
          send(ws, { type: "rooms", rooms: roomList() });
        } else if (msg.type === "leave") leaveRoom(ws);
        else if (msg.type === "hello") join(ws, msg);
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
      const member = room?.members.get(ws.memberId);
      if (member?.ws === ws) {
        member.ws = null;
        if (!room.started && member.seat !== null) resetReady(room);
        room.revision++;
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
    let removed = false;
    for (const [key, r] of rooms)
      if (!members(r).some(onlineMember) && Date.now() - r.updated > 3600000) {
        rooms.delete(key);
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
    for (const entry of autoEndTimers.values()) clearTimeout(entry.timer);
    autoEndTimers.clear();
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
