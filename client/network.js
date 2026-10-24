/* 网络层：连接房间 → 提交动作意图 → 接收服务端快照 → 刷新界面。
 * token 恢复席位；revision 拒绝过期操作；request ID 防止重复结算。
 */
"use strict";
const Net = (() => {
  // active 表示已加入遭遇战房间（联机或离线），awaiting 表示等待某个请求的确认。
  const n = {
    active: false,
    local: false,
    socket: null,
    seat: null,
    memberId: null,
    started: false,
    spectatorBattleSeen: null,
    room: null,
    token: null,
    revision: -1,
    snapshot: null,
    awaiting: null,
    seen: new Set(),
    reconnectTimer: null,
    retry: 0,
    manual: false,
    serverURL: null,
    connecting: false,
    applied: false,
  };
  const status = (t) => {
    byId("networkStatus").textContent = t;
    byId("netBadge").textContent = t;
  };
  const storage = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, v);
      } catch {}
    },
    remove(k) {
      try {
        sessionStorage.removeItem(k);
      } catch {}
    },
  };
  const chatRequestIds = new Set();
  function sendChat(message, retryId = null, channel = "all") {
    if (!n.active || !n.memberId || n.socket?.readyState !== WebSocket.OPEN) return null;
    const id =
      retryId ||
      "chat-" + (crypto.randomUUID?.() || Date.now() + "-" + Math.random().toString(16).slice(2));
    chatRequestIds.add(id);
    if (chatRequestIds.size > 100) chatRequestIds.delete(chatRequestIds.values().next().value);
    n.socket.send(JSON.stringify({ type: "action", action: "chat", id, message, channel }));
    return id;
  }
  function endpoint(s) {
    s = s.trim();
    if (!s) throw Error("请输入服务器IP和端口");
    if (!/^[a-z]+:\/\//i.test(s)) s = "http://" + s;
    let u = new URL(s);
    if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol) || u.username || u.password)
      throw Error("服务器地址格式不正确");
    if (!u.port && ["http:", "ws:"].includes(u.protocol)) u.port = "1313";
    u.protocol = ["https:", "wss:"].includes(u.protocol) ? "wss:" : "ws:";
    u.pathname = "/ws";
    u.search = "";
    u.hash = "";
    return u.href;
  }
  const key = (url, room) => "slg-seat:" + url + ":" + room;
  function canAct() {
    return (
      !n.active ||
      (n.socket?.readyState === WebSocket.OPEN &&
        n.snapshot?.connected.every(Boolean) &&
        n.snapshot?.started &&
        n.seat !== null &&
        Rules.seatTeam(n.seat) === game.team &&
        !n.snapshot?.turnDone?.[n.seat] &&
        !n.awaiting)
    );
  }
  // 所有游戏动作从这里发送，自动附带唯一请求 ID 和当前版本号。
  function request(action, fields = {}) {
    if (!n.active || n.socket?.readyState !== WebSocket.OPEN) {
      note("尚未连接服务端");
      return;
    }
    if (n.awaiting) {
      note("正在等待服务端确认");
      return;
    }
    let id = crypto.randomUUID?.() || Date.now() + "-" + Math.random().toString(16).slice(2);
    n.awaiting = { id, revision: n.revision };
    n.socket.send(
      JSON.stringify({
        type: "action",
        action,
        id,
        revision: n.revision,
        ...fields,
      }),
    );
    update();
    setTimeout(() => {
      if (n.awaiting?.id === id) {
        n.awaiting = null;
        note("请求等待超时，正在同步战局");
        n.socket?.send(
          JSON.stringify({
            type: "action",
            action: "sync",
            id: Date.now() + "-sync",
          }),
        );
        update();
      }
    }, 8000);
  }
  function leave({ notify = true, forget = true } = {}) {
    MatchResults.reset();
    GameAudio.reset();
    WeaponAudio.stop();
    Chat.reset();
    chatRequestIds.clear();
    TurnFlow.reset();
    MapCamera.reset();
    MapEffects.reset();
    n.manual = true;
    clearTimeout(n.reconnectTimer);
    Lobby.close();
    if (notify && n.socket?.readyState === WebSocket.OPEN)
      n.socket.send(JSON.stringify({ type: "leave" }));
    if (forget) {
      if (n.serverURL && n.room) storage.remove(key(n.serverURL, n.room));
      storage.remove("slg-last");
    }
    n.socket?.close();
    n.socket = null;
    n.active = false;
    n.local = false;
    n.connecting = false;
    n.awaiting = null;
    n.snapshot = null;
    n.seen.clear();
    n.seat = null;
    n.revision = -1;
    n.token = null;
    n.memberId = null;
    n.started = false;
    n.spectatorBattleSeen = null;
    status("未连接");
  }
  // 两种传输都将裁定后的消息交给同一套快照恢复逻辑。
  function receive(msg, socket, { url = n.serverURL, room = n.room, mode = "create" } = {}) {
    if (n.socket !== socket) return;
    if (msg.type === "joined") {
      n.seat = msg.seat;
      n.memberId = msg.memberId;
      n.token = msg.token;
      n.connecting = false;
      n.retry = 0;
      if (!n.local) {
        storage.set(key(url, room), msg.token);
        storage.set("slg-last", JSON.stringify({ url, room }));
      }
      byId("start").hidden = true;
      status("房间 " + room + " · " + roleName());
    } else if (msg.type === "chat") {
      if (n.snapshot && !(n.snapshot.chat || []).some((old) => old.id === msg.message.id))
        n.snapshot.chat = [...(n.snapshot.chat || []), msg.message].slice(-100);
      Chat.receive(msg.message, msg.ack);
    } else if (msg.type === "state") {
      if (n.memberId === null || msg.revision < n.revision) return;
      if (n.awaiting && (msg.ack === n.awaiting.id || msg.revision > n.awaiting.revision))
        n.awaiting = null;
      n.revision = msg.revision;
      n.snapshot = msg;
      applySnapshot(msg);
    } else if (msg.type === "error") {
      if (chatRequestIds.has(msg.id)) {
        Chat.reject(msg.id, msg.message);
        return;
      }
      n.awaiting = null;
      status(msg.message);
      note(msg.message);
      if (n.connecting) {
        if (mode === "resume") {
          storage.remove(key(url, room));
          storage.remove("slg-last");
        }
        n.manual = true;
        n.connecting = false;
        leave({ notify: false, forget: false });
        phase = "start";
        setPageView("menu");
        status(msg.message);
      }
      update();
    } else if (msg.type === "room_closed") {
      openMenu();
      note(msg.message);
    } else if (msg.type === "replaced") {
      n.manual = true;
      note(msg.message);
      socket.close();
    }
  }
  function beginLocal(socket) {
    n.active = true;
    n.local = true;
    n.manual = false;
    n.socket = socket;
    n.room = "OFFLINE";
    n.serverURL = null;
    n.applied = false;
    session++;
    moving = null;
    status("离线遭遇战");
  }
  function connect(mode = "join", auto = false, roomCode = null) {
    if (window.isLayoutPreview) return;
    if (!assetsReady) {
      note("贴图尚未加载完成");
      return;
    }
    let url, room;
    try {
      url = auto ? n.serverURL : Lobby.endpoint();
      if (!url) throw Error("请先连接服务器。");
      room = (auto ? n.room : roomCode || byId("roomCode").value).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,20}$/.test(room))
        throw Error("房间码需为3–20位英文、数字、下划线或短横线");
    } catch (e) {
      status(e.message);
      return;
    }
    clearTimeout(n.reconnectTimer);
    Lobby.close();
    let token = storage.get(key(url, room));
    if (mode === "resume" && !token) {
      status("本页面没有该房间的重连凭据，请创建或加入房间");
      return;
    }
    n.manual = true;
    n.socket?.close();
    n.manual = false;
    n.active = true;
    n.local = false;
    n.memberId = null;
    n.started = false;
    n.connecting = true;
    n.serverURL = url;
    n.room = room;
    n.token = token;
    n.awaiting = null;
    n.snapshot = null;
    n.revision = -1;
    n.seen.clear();
    n.applied = false;
    session++;
    moving = null;
    phase = "connecting";
    status(auto ? "正在恢复连接…" : "正在连接 " + url);
    update();
    let socket = new WebSocket(url);
    n.socket = socket;
    socket.onopen = () => {
      if (n.socket !== socket) return;
      socket.send(
        JSON.stringify({
          type: "hello",
          mode,
          room,
          token: mode === "resume" ? token : undefined,
          name: PlayerProfile.name(),
        }),
      );
    };
    socket.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      receive(msg, socket, { url, room, mode });
    };
    socket.onerror = () => {
      if (n.socket === socket) status("连接失败：检查IP、端口及服务端是否启动");
    };
    socket.onclose = () => {
      if (n.socket !== socket) return;
      n.awaiting = null;
      n.connecting = false;
      if (n.manual || !n.token) {
        leave({ notify: false, forget: false });
        phase = "start";
        setPageView("menu");
        status("未连接服务器，可创建离线房间或连接服务器。");
        update();
        return;
      }
      phase = "disconnected";
      byId("reaction").hidden = true;
      status("连接中断，正在自动重连…");
      update();
      n.reconnectTimer = setTimeout(
        () => connect("resume", true),
        Math.min(8000, 1000 * 2 ** Math.min(n.retry++, 3)),
      );
    };
  }
  // 服务端快照是联机状态来源，按阶段恢复地图、应战或战斗画面。
  function applySnapshot(s) {
    GameAudio.receive(s, s.you ? s.you.seat : n.seat, n.applied);
    const wasStarted = n.started;
    Chat.setSnapshot(s);
    const previousSeat = n.seat;
    if (s.you) {
      n.seat = s.you.seat;
      n.memberId = s.you.id;
    }
    n.started = s.started;
    Formation.refresh();
    if (previousSeat !== n.seat) {
      selected = weaponId = null;
      mode = "select";
      moving = null;
    }
    let hadBattle = battleView?.networkId,
      previousGame = game;
    game = s.game;
    if (previousGame.mapId !== game.mapId) MapCamera.reset();
    game.ai = false;
    log = s.log.slice();

    pending = s.pending;
    if (s.phase !== "battle" && battleView) MapEffects.capture(battleView);
    if (s.phase === "assembly") {
      phase = "assembly";
      battleView = null;
      if (pageView !== "formation") setPageView("room");
      RoomPanel.render(s);
      n.applied = true;
      update();
      return;
    }
    if (!s.started) {
      MatchResults.reset();
      if (wasStarted) {
        MapEffects.reset();
        WeaponAudio.stop();
        TurnFlow.reset();
        MapCamera.reset();
        selected = weaponId = null;
        moving = pending = null;
        mode = "select";
      }
      phase = "waiting";
      battleView = null;
      if (pageView !== "formation") setPageView("room");
      RoomPanel.render(s);
      n.applied = true;
      update();
      return;
    }
    if (!wasStarted || pageView === "menu" || byId("finalAssemblyPanel").hidden === false) {
      byId("finalAssemblyPanel").hidden = true;
      byId("roomLobbyContent").hidden = false;
      byId("roomActions").hidden = false;
      setPageView("game");
    }
    if (pageView === "room" && s.phase === "finished") setPageView("game");
    if (pageView === "room") {
      if (s.lastEvent) n.seen.add(s.lastEvent.id);
      RoomPanel.render(s);
      n.applied = true;
      update();
      return;
    }
    const online = s.connected.every(Boolean);
    byId("reaction").hidden = true;
    if (!online && s.phase !== "finished") {
      TurnFlow.reset();
      if (battleView) BattleWindow.suspend(battleView);
      phase = "disconnected";
      status("房间 " + n.room + " · 等待队伍补位或离线玩家恢复，战局已暂停");
    } else if (s.phase === "deployment") {
      phase = "deployment";
      byId("battle").hidden = true;
      battleView = null;
    } else if (s.phase === "reaction") {
      let b = getUnit(s.pending.target);
      if (Rules.ownerOf(b) === n.seat) {
        phase = "reaction";
        let a = getUnit(s.pending.attacker),
          legal = Rules.modelOf(b).weapons.filter((w) => Rules.canCounter(game, b, a, w));
        if (!legal.some((w) => w.id === counterId)) {
          response = legal.length ? "counter" : "defend";
          counterId = legal[0]?.id || null;
        }
        renderReaction();
        byId("cancelAttack").disabled = true;
        byId("reaction").hidden = false;
      } else phase = "reaction_wait";
    } else if (s.phase === "battle") {
      mode = "select";
      weaponId = null;
      if (isSpectator() ? n.spectatorBattleSeen === s.battle.id : s.battle.ready[n.seat]) {
        byId("battle").hidden = true;
        phase = "battle_wait";
      } else {
        phase = "battle";
        if (hadBattle !== s.battle.id) {
          battleView = {
            a: s.battle.a,
            b: s.battle.b,
            events: s.battle.events,
            index: 0,
            start: performance.now(),
            displayHp: { ...s.battle.before },
            completed: false,
            networkId: s.battle.id,
          };
          byId("battleTitle").textContent =
            unitName(getUnit(s.battle.a)) + " vs " + unitName(getUnit(s.battle.b));
          byId("continueBattle").disabled = true;
          byId("continueBattle").textContent = "立即返回地图";
          byId("skipBattle").disabled = false;
          byId("battleSummary").textContent = isSpectator()
            ? "观战演出不会阻塞两队继续游戏。"
            : "演出结束后停留2秒自动返回地图，双方看完后继续行动。";
        }
        BattleWindow.resume(battleView);
      }
    } else if (s.phase === "finished") {
      phase = "victory";
      byId("battle").hidden = true;
      battleView = null;
      showVictory();
    } else {
      phase = "idle";
      byId("battle").hidden = true;
      battleView = null;
    }
    if (s.started && online)
      status((n.local ? "离线遭遇战" : "房间 " + n.room) + " · " + roleName());
    const event = s.lastEvent;
    if (event && !n.seen.has(event.id)) {
      n.seen.add(event.id);
      if (n.seen.size > 128) n.seen.delete(n.seen.values().next().value);
      if (event.type === "move" && s.phase === "idle" && online && n.applied) {
        if (Rules.modelOf(getUnit(event.unitId)).presentation.movement === "boost")
          WeaponAudio.play(ART.presentation.moveSound);
        MovementEffects.start(getUnit(event.unitId), event.from, event.path[0], performance.now());
        moving = {
          id: event.unitId,
          from: event.from,
          path: event.path,
          start: performance.now(),
          step: byId("quick").checked ? 50 : 120,
        };
        let marker = moving;
        phase = "moving";
        setTimeout(
          () => {
            if (moving !== marker) return;
            moving = null;
            if (n.snapshot === s) phase = "idle";
            update();
          },
          event.path.length * moving.step + 20,
        );
      }
      if (event.type === "turn") {
        selected = null;
        weaponId = null;
        mode = "select";
        if (n.applied && online)
          TurnFlow.play(event.fromTeam ?? previousGame.team, game.round, game.team);
      }
    }
    if (selected && !game.units.some((u) => u.id === selected && u.hp > 0)) selected = null;
    n.applied = true;
    update();
  }
  byId("createRoom").onclick = () => connect("create");
  function isSpectator() {
    return n.active && n.seat === null;
  }
  function roleName() {
    return n.seat === null
      ? "观战玩家"
      : "队伍" + (Rules.seatTeam(n.seat) + 1) + " · 出生点" + (Math.floor(n.seat / 2) + 1);
  }
  let last;
  try {
    last = JSON.parse(storage.get("slg-last") || "null");
  } catch {}
  // 预设地址只保存在配置和连接状态里，不回填到自定义输入框。
  const presetURLs = CLIENT_CONFIG.presetServers.map((server) => endpoint(server.address));
  const savedAddress = last?.url || CLIENT_CONFIG.defaultServerAddress;
  let savedIsPreset = false;
  try {
    savedIsPreset = !!savedAddress && presetURLs.includes(endpoint(savedAddress));
  } catch {}
  byId("serverAddress").value = savedIsPreset ? "" : savedAddress;
  if (last) byId("roomCode").value = last.room;
  // 刷新当前标签页时自动恢复席位，不再要求玩家点击重连按钮。
  window.addEventListener(
    "game-assets-ready",
    () => {
      if (window.isLayoutPreview || !last || !storage.get(key(last.url, last.room))) return;
      n.serverURL = last.url;
      n.room = last.room;
      connect("resume", true);
    },
    { once: true },
  );
  return Object.assign(n, {
    beginLocal,
    receive,
    canAct,
    team: () => Rules.seatTeam(n.seat),
    owns: (unit) => !!unit && n.seat !== null && Rules.ownerOf(unit) === n.seat,
    request,
    connect,
    leave,
    applySnapshot,
    endpoint,
    sendChat,
    isSpectator,
    roleName,
  });
})();
