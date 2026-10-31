/* 网络层：连接房间 → 提交动作意图 → 接收服务端快照 → 刷新界面。
 * token 恢复席位；revision 拒绝过期操作；request ID 防止重复结算。
 */
"use strict";
const Net = (() => {
  // active 表示已加入遭遇战房间（联机或离线），awaiting 表示等待某个请求的确认。
  const n = {
    active: false,
    pingMs: null,
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
    manual: false,
    serverURL: null,
    connecting: false,
    applied: false,
  };
  const status = (t) => {
    byId("networkStatus").textContent = t;
    byId("netBadge").textContent = t;
  };
  let connectionTimer = null,
    pingStarted = null,
    foregroundSyncAt = -Infinity;
  const disconnectDialog = byId("disconnectDialog");
  function showDisconnect(connecting = false) {
    byId("disconnectStatus").textContent = connecting
      ? "正在重连，请稍候…"
      : "点击重连，恢复当前房间和对局。";
    byId("reconnectRoom").disabled = connecting;
    byId("reconnectRoom").textContent = connecting ? "正在重连…" : "重连";
    if (!disconnectDialog.open) disconnectDialog.showModal();
  }
  function closeDisconnect() {
    clearTimeout(connectionTimer);
    connectionTimer = null;
    if (disconnectDialog.open) disconnectDialog.close();
  }
  disconnectDialog.addEventListener("cancel", (event) => event.preventDefault());
  byId("reconnectRoom").onclick = () => {
    if (n.local || n.connecting || !n.active) return;
    connect("resume", true);
  };
  byId("abandonReconnect").onclick = () => openMenu();
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
  const lastKey = () => "slg-last";
  const legacyToken = (url, room) =>
    ["PMC", "EFSF", "ZEON"]
      .map((faction) => storage.get("slg-seat:" + faction + ":" + url + ":" + room))
      .find(Boolean);
  const canControl = (unit) =>
    !window.ReplayPlayer?.active &&
    !n.snapshot?.campaign?.delegatedSeats?.includes(n.seat) &&
    !n.snapshot?.campaign?.delegatedSeats?.includes(Rules.ownerOf(unit || {})) &&
    Rules.canControlUnit(n.snapshot?.settings, n.snapshot?.members, n.seat, unit);
  function canAct() {
    if (BattleAssets.loading || n.snapshot?.campaign?.delegatedSeats?.includes(n.seat)) return false;
    if (window.ReplayPlayer?.active) return false;
    return (
      !n.active ||
      (n.socket?.readyState === WebSocket.OPEN &&
        n.snapshot?.connected.every(Boolean) &&
        n.snapshot?.started &&
        n.seat !== null &&
        Rules.seatTeam(n.seat) === game.team &&
        !n.snapshot?.turnDone?.[n.seat] &&
        !n.awaiting &&
        !n.snapshot?.returnCountdown)
    );
  }
  // One ordered intent stream. Retransmissions keep the exact ID/payload so
  // authority deduplication resolves lost replies without executing an action twice.
  const actionQueue = [];
  let actionTimer = null;
  const profileActions = new Set(["set_ready", "start_game", "update_formation", "confirm_formation"]);
  const rebaseActions = new Set([
    "set_ready", "update_formation", "confirm_formation", "start_game",
    "move", "confirm_move", "cancel_move", "rotate", "skill", "undo", "wait",
    "attack", "cancel_attack", "end_turn", "embark", "launch", "deploy",
    "confirm_deployment", "respond", "playback_ready",
  ]);
  function actionContext(snapshot = n.snapshot) {
    return { matchId: snapshot?.matchId ?? null, round: snapshot?.game?.round ?? null,
      phase: snapshot?.phase ?? null, reactionId: snapshot?.pending?.id ?? null };
  }
  function sameContext(context, snapshot = n.snapshot) {
    return JSON.stringify(context) === JSON.stringify(actionContext(snapshot));
  }
  function clearActions() {
    clearTimeout(actionTimer);
    actionTimer = null;
    actionQueue.length = 0;
    n.awaiting = null;
  }
  function finishAction(id) {
    if (!n.awaiting || n.awaiting.id !== id) return false;
    clearTimeout(actionTimer);
    actionTimer = null;
    n.awaiting = null;
    queueMicrotask(drainActions);
    return true;
  }
  function sendPending() {
    clearTimeout(actionTimer);
    const request = n.awaiting, socket = n.socket;
    if (!request || !request.payload || socket?.readyState !== WebSocket.OPEN || n.connecting) return;
    if (socket.bufferedAmount > 256 * 1024) {
      actionTimer = setTimeout(() => {
        if (n.socket === socket && n.awaiting === request) sendPending();
      }, 1000);
      return;
    }
    try {
      // A receipt means execution succeeded; only refresh state, never replay intent.
      socket.send(request.receiptRevision === undefined ? request.payload : JSON.stringify({
        type: "action", action: "sync", id: request.id + "-sync",
      }));
    } catch {
      return; // Resume retains the unresolved intent.
    }
    request.attempts++;
    const delay = Math.min(15000, Math.max(1500, (n.pingMs || 0) * 3) *
      Math.pow(2, Math.min(4, request.attempts - 1)));
    actionTimer = setTimeout(() => {
      if (n.socket === socket && n.awaiting === request) sendPending();
    }, delay);
  }
  function drainActions() {
    if (n.awaiting || !actionQueue.length || n.connecting ||
        n.socket?.readyState !== WebSocket.OPEN || !n.snapshot) return;
    const intent = actionQueue.shift();
    if (!sameContext(intent.context)) {
      note("战局阶段已改变，未发送的操作已取消。");
      queueMicrotask(drainActions);
      return;
    }
    const message = {
      type: "action", action: intent.action, id: intent.id,
      revision: n.revision, phase: n.snapshot?.phase, round: n.snapshot?.game?.round,
      matchId: n.snapshot?.matchId, reactionId: n.snapshot?.pending?.id,
      ...intent.fields,
    };
    if (profileActions.has(intent.action) && n.snapshot?.settings.mode !== "campaign") {
      message.licenses = Economy.snapshot().licenses;
      if (!n.snapshot?.started) message.researched = Development.researchSnapshot();
    }
    n.awaiting = { ...intent, message, revision: n.revision, attempts: 0, rebases: 0,
      payload: JSON.stringify(message) };
    sendPending();
    update();
  }
  function request(action, fields = {}) {
    if (window.ReplayPlayer?.active && action !== "sync") return;
    if (n.snapshot?.returnCountdown &&
        !["sync", "return_room", "download_log", "spectate"].includes(action)) return;
    if (!n.active || n.socket?.readyState !== WebSocket.OPEN) {
      note("尚未连接服务端");
      return;
    }
    const signature = JSON.stringify([action, fields]);
    const existing = [n.awaiting, ...actionQueue].find(item => item?.signature === signature);
    if (existing) return existing.id;
    if (actionQueue.length >= 32) {
      note("待发送操作过多，请等待服务端确认。");
      return;
    }
    const id = crypto.randomUUID?.() || Date.now() + "-" + Math.random().toString(16).slice(2);
    actionQueue.push({ id, action, fields: structuredClone(fields), signature,
      context: actionContext() });
    drainActions();
    return id;
  }
  function observeActionState(snapshot) {
    const waiting = n.awaiting;
    if (!waiting) return;
    // Even an older snapshot can confirm an action; do not roll back visible state.
    if (snapshot.ack === waiting.id ||
        (waiting.receiptRevision !== undefined && snapshot.revision >= waiting.receiptRevision)) {
      finishAction(waiting.id);
      return;
    }
    if (waiting.rebase) {
      if (!sameContext(waiting.context, snapshot)) {
        finishAction(waiting.id);
        note("战局阶段已改变，未发送的操作已取消。");
        return;
      }
      waiting.rebase = false;
      waiting.message.revision = snapshot.revision;
      waiting.revision = snapshot.revision;
      waiting.payload = JSON.stringify(waiting.message);
      sendPending();
    } else if (waiting.resume) {
      waiting.resume = false;
      sendPending();
    }
  }
  function leave({ notify = true, forget = true } = {}) {
    BattleAssets.cancel();
    if (window.ReplayPlayer?.active) window.ReplayPlayer.stop(false);
    window.BattlePrompts?.reset();
    closeDisconnect();
    MatchResults.reset();
    CombatPlayback.reset();
    PlanningUI.reset();
    GameAudio.reset();
    WeaponAudio.stop();
    Chat.reset();
    chatRequestIds.clear();
    TurnFlow.reset();
    MapCamera.reset();
    MapEffects.reset();
    n.manual = true;
    Lobby.close();
    if (notify && n.socket?.readyState === WebSocket.OPEN)
      n.socket.send(JSON.stringify({ type: "leave" }));
    if (forget) {
      if (n.serverURL && n.room) storage.remove(key(n.serverURL, n.room));
      storage.remove(lastKey());
    }
    if (n.socket) ServerActivities.detach(n.socket);
    n.socket?.close();
    n.socket = null;
    n.active = false;
    n.pingMs = pingStarted = null;
    n.local = false;
    n.connecting = false;
    clearActions();
    n.snapshot = null;
    window.BattleAssets?.cancel();
    window.BattlePrompts?.reset();
    n.seen.clear();
    n.seat = null;
    n.revision = -1;
    n.token = null;
    n.memberId = null;
    n.started = false;
    n.spectatorBattleSeen = null;
    n.appliedViewTeam = undefined;
    status("未连接");
  }
  // 两种传输都将裁定后的消息交给同一套快照恢复逻辑。
  function receive(msg, socket, { url = n.serverURL, room = n.room, mode = "create" } = {}) {
    if (ServerActivities.receive(msg, socket)) return;
    if (n.socket !== socket) return;
    if (msg.type === "pong") {
      if (pingStarted !== null) {
        n.pingMs = Math.max(0, Math.round(performance.now() - pingStarted));
        pingStarted = null;
        window.BattleHUD?.refreshRoomStatus();
      }
    } else if (msg.type === "joined") {
      n.seat = msg.seat;
      n.memberId = msg.memberId;
      n.token = msg.token;
      n.connecting = false;
      if (!n.local) {
        storage.set(key(url, room), msg.token);
        storage.set(lastKey(), JSON.stringify({ url, room }));
      }
      keepAlive();
      byId("start").hidden = true;
      status("房间 " + room + " · " + roleName());
    } else if (msg.type === "chat") {
      if (n.snapshot && !(n.snapshot.chat || []).some((old) => old.id === msg.message.id))
        n.snapshot.chat = [...(n.snapshot.chat || []), msg.message].slice(-100);
      Chat.receive(msg.message, msg.ack);
    } else if (msg.type === "campaign_save" || msg.type === "campaign_upload_ack") {
      finishAction(msg.ack);
      window.CampaignUI?.reply(msg);
      if (pageView === "campaign") window.CampaignUI?.render();
      update();
    } else if (msg.type === "record_reply") {
      window.ReplayPlayer?.response(msg);
    } else if (msg.type === "battle_log") {
      if (msg.ack !== n.awaiting?.id) return;
      finishAction(msg.ack);
      if (msg.matchId === n.snapshot?.matchId) Chat.saveLog(msg.log, msg.perspective);
      update();
    } else if (msg.type === "action_receipt") {
      if (msg.id !== n.awaiting?.id || !Number.isSafeInteger(msg.revision)) return;
      n.awaiting.receiptRevision = msg.revision;
      if (n.snapshot && n.revision >= msg.revision) {
        finishAction(msg.id);
        update();
      }
    } else if (msg.type === "state") {
      if (n.memberId === null) return;
      observeActionState(msg);
      if (msg.revision < n.revision) { update(); return; }
      n.revision = msg.revision;
      msg.receivedAt = performance.now();
      n.snapshot = msg;
      closeDisconnect();
      if (!window.ReplayPlayer?.receive(msg)) applySnapshot(msg);
      queueMicrotask(drainActions);
    } else if (msg.type === "error") {
      window.CampaignUI?.failure(msg.id, msg.message);
      if (window.ReplayPlayer?.response(msg)) return;
      if (chatRequestIds.has(msg.id)) {
        Chat.reject(msg.id, msg.message);
        return;
      }
      if (msg.id === n.awaiting?.id && msg.code === "STALE" &&
          rebaseActions.has(n.awaiting.action) && n.awaiting.rebases < 5) {
        n.awaiting.rebases++;
        n.awaiting.rebase = true;
        return; // Authority follows STALE with a fresh snapshot.
      }
      if (!msg.id || msg.id === n.awaiting?.id) finishAction(n.awaiting?.id);
      status(msg.message);
      note(msg.message);
      if (n.connecting) {
        if (mode === "resume") {
          storage.remove(key(url, room));
          storage.remove(lastKey());
        }
        n.manual = true;
        n.connecting = false;
        leave({ notify: false, forget: false });
        phase = "start";
        setPageView("menu");
        status(msg.message);
        if (mode !== "resume") Lobby.reconnect(url);
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
    foregroundSyncAt = -Infinity;
    session++;
    moving = null;
    status("离线常规战");
  }
  function connect(mode = "join", auto = false, roomCode = null, credentials = {}) {
    if (!PlayerProfile.selected()) return note("请先选择角色阵营。");
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
      if (!/^[\p{Script=Han}A-Z0-9_-]{1,20}$/u.test(room))
        throw Error("房间名称需为1–20位中文、英文字母、数字、下划线或短横线");
    } catch (e) {
      status(e.message);
      return;
    }
    Lobby.close();
    const token =
      (n.serverURL === url && n.room === room ? n.token : null) ||
      storage.get(key(url, room)) ||
      legacyToken(url, room);
    if (mode === "resume" && !token) {
      status("本页面没有该房间的重连凭据，请创建或加入房间");
      return;
    }
    n.manual = true;
    n.socket?.close();
    n.manual = false;
    n.active = true;
    n.pingMs = pingStarted = null;
    n.local = false;
    n.memberId = null;
    n.started = false;
    n.connecting = true;
    if (disconnectDialog.open) showDisconnect(true);
    n.serverURL = url;
    n.room = room;
    n.token = token;
    if (!auto) clearActions();
    else if (n.awaiting) n.awaiting.resume = true;
    n.snapshot = null;
    n.revision = -1;
    n.seen.clear();
    n.applied = false;
    foregroundSyncAt = -Infinity;
    session++;
    moving = null;
    phase = "connecting";
    status(auto ? "正在恢复连接…" : "正在连接 " + url);
    update();
    let socket = new WebSocket(url);
    const stateDecoder = StateWire.createDecoder();
    let wireResyncPending = false;
    n.socket = socket;
    clearTimeout(connectionTimer);
    // TCP/WebSocket 已连通但未收到房间快照，也必须允许玩家再次尝试。
    if (mode === "resume")
      connectionTimer = setTimeout(function checkConnection() {
        if (n.socket !== socket || n.snapshot) return;
        // 后台计时器可能比快照消息先恢复执行，不因此误关连接。
        if (document.hidden) {
          connectionTimer = setTimeout(checkConnection, 20000);
          return;
        }
        socket.close();
      }, 20000);
    socket.onopen = () => {
      if (n.socket !== socket) return;
      ServerActivities.attach(socket);
      socket.send(
        JSON.stringify({
          type: "hello",
          version: PROJECT.version,
          stateDelta: 1,
          reliableActions: 1,
          characterFaction: PlayerProfile.faction(),
          researched: Development.researchSnapshot(),
          licenses: Economy.snapshot().licenses,
          roomMode: mode === "create" ? byId("newRoomMode").value : undefined,
          mode,
          room,
          locked: mode === "create" ? !!credentials.locked : undefined,
          password: mode === "resume" ? undefined : credentials.password,
          token: mode === "resume" ? token : undefined,
          name: PlayerProfile.name(),
        }),
      );
    };
    socket.onmessage = (e) => {
      let msg;
      try {
        msg = stateDecoder.decode(JSON.parse(e.data));
        if (msg.type === "state") wireResyncPending = false;
      } catch {
        if (!wireResyncPending && socket.readyState === WebSocket.OPEN) {
          wireResyncPending = true;
          socket.send(
            JSON.stringify({ type: "action", action: "sync", id: "wire-sync-" + Date.now() }),
          );
        }
        return;
      }
      receive(msg, socket, { url, room, mode });
    };
    socket.onerror = () => {
      if (n.socket === socket) status("连接失败：检查IP、端口及服务端是否启动");
    };
    socket.onclose = () => {
      if (n.socket !== socket) return;
      clearTimeout(connectionTimer);
      clearTimeout(actionTimer);
      if (n.awaiting) n.awaiting.resume = true;
      n.connecting = false;
      n.pingMs = pingStarted = null;
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
      status("连接中断，请点击重连。");
      update();
      showDisconnect();
    };
  }
  // 服务端快照是联机状态来源，按阶段恢复地图、应战或战斗画面。
  function applySnapshot(s) {
    // Resource/loading/playback callbacks may finish after returning or reconnecting.
    // They must never restore a superseded room phase or reopen its modal.
    if (!n.active || !s || s !== n.snapshot) return;
    if (!s.started || s.returnCountdown) BattleAssets.cancel();
    else if (BattleAssets.guard(s, () => applySnapshot(s))) {
      phase = "loading";
      return;
    }
    const changedView = n.appliedViewTeam !== undefined && n.appliedViewTeam !== s.viewTeam;
    n.appliedViewTeam = s.viewTeam;
    if (changedView) {
      CombatPlayback.reset();
      PlanningUI.reset();
      MapEffects.reset();
      WeaponAudio.stop();
      battleView = moving = selected = weaponId = null;
      mode = "select";
      if (s.lastEvent) n.seen.add(s.lastEvent.id);
    }
    GameAudio.receive(s, s.you ? s.you.seat : n.seat, n.applied);
    CombatPlayback.receive(s, n.applied);
    RewardNotifications.sync(s);
    const wasStarted = n.started;
    Chat.setSnapshot(s);
    DevelopmentUI.receiveAwards(s);
    ProductionUI.receiveAwards(s);
    PilotRewards.receive(s);
    Formation.receivePilotAwards(s);
    const previousSeat = n.seat;
    if (s.you) {
      n.seat = s.you.seat;
      n.memberId = s.you.id;
    }
    n.started = s.started;
    document.body.classList.toggle("campaign-active", !!s.campaign);
    document.body.classList.toggle("campaign-room", s.settings.mode === "campaign");
    document.body.classList.toggle("campaign-delegated", !!s.campaign?.delegatedSeats?.includes(n.seat));
    window.MenuShell?.refresh();
    if (!s.campaign && s.settings.mode !== "campaign") Formation.alignWithRoom(s);
    MusicPlayer.sync();
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
    window.BattlePrompts?.receive(s);
    if (s.returnCountdown) {
      TurnFlow.reset();
      if (battleView?.mapBattle) MapCombat.suspend(battleView);
      WeaponAudio.stopBattle();
      phase = "returning";
      if (pageView === "menu") setPageView(s.phase === "assembly" ? "room" : "game");
      update();
      n.applied = true;
      return;
    }
    if (s.started && s.phase === "assembly") {
      phase = "assembly";
      battleView = null;
      if (
        !n.applied ||
        !["menu", "formation", "production", "development", "records", "encyclopedia"].includes(pageView)
      )
        setPageView("room");
      RoomPanel.render(s);
      n.applied = true;
      update();
      return;
    }
    if (!s.started && s.campaign) {
      MatchResults.reset(); CombatPlayback.reset(); PlanningUI.reset();
      if (wasStarted) {
        MapEffects.reset(); WeaponAudio.stop(); TurnFlow.reset(); MapCamera.reset();
      }
      byId("reaction").hidden = true;
      battleView = moving = pending = selected = weaponId = null;
      mode = "select";
      phase = "waiting";
      window.CampaignUI?.receive(s);
      n.applied = true;
      update();
      return;
    }
    if (!s.started) {
      MatchResults.reset();
      CombatPlayback.reset();
      PlanningUI.reset();
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
      if (
        wasStarted ||
        !n.applied ||
        !["menu", "formation", "production", "development", "records", "encyclopedia"].includes(pageView)
      )
        setPageView("room");
      RoomPanel.render(s);
      n.applied = true;
      update();
      return;
    }
    if (!wasStarted || pageView === "menu" || byId("finalAssemblyPanel").hidden === false) {
      byId("finalAssemblyPanel").hidden = true;
      byId("roomLobbyContent").hidden = false;
      byId("roomActions").hidden = false;
      setPageView(!wasStarted && n.seat === null ? "room" : "game");
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
    const ownResponse =
      s.phase === "reaction" && s.pending && canControl(getUnit(s.pending.target));
    if (CombatPlayback.active() && !ownResponse) {
      phase = "battle";
      MapCombat.resume(battleView);
    } else if (!online && s.phase !== "finished") {
      TurnFlow.reset();
      if (battleView?.mapBattle) MapCombat.suspend(battleView);
      phase = "disconnected";
      status("房间 " + n.room + " · 等待队伍补位或离线玩家恢复，战局已暂停");
    } else if (s.phase === "deployment") {
      if (phase !== "deployment") MapCamera.fit();
      phase = "deployment";
      byId("battle").hidden = true;
      battleView = null;
    } else if (s.phase === "reaction" && s.pending) {
      let b = getUnit(s.pending.target);
      if (canControl(b)) {
        phase = "reaction";
        let a = getUnit(s.pending.attacker),
          legal = Rules.modelOf(b).weapons.filter((w) =>
            s.pending.counterTargets
              ? s.pending.counterTargets.some((entry) => entry.options.includes(w.id))
              : Rules.canCounter(game, b, a, w) &&
                (!s.pending.counterOptions || s.pending.counterOptions.includes(w.id)),
          );
        if (!legal.some((w) => w.id === counterId)) {
          response = legal.length ? "counter" : "defend";
          counterId = legal[0]?.id || null;
        }
        if (s.pending.savedChoice && counterDraftState?.reviewEditId !== s.pending.reviewEditId) {
          const saved = s.pending.savedChoice;
          const entries = saved.orders.flatMap((order) => order.weaponIds.map((weaponId) => ({ targetId: order.targetId, weaponId })));
          response = saved.response;
          counterTargetId = entries[0]?.targetId || s.pending.attacker;
          counterId = entries.at(-1)?.weaponId || null;
          counterDraftState = { key: s.pending.id, session, entries, ids: entries.map((entry) => entry.weaponId), reviewEditId: s.pending.reviewEditId };
        }
        renderReaction();
        byId("reaction").hidden = false;
      } else phase = "reaction_wait";
    } else if (s.phase === "reaction") {
      phase = "reaction_wait";
    } else if (s.phase === "playback") {
      phase = "playback_wait";
      battleView = null;
      byId("hint").textContent = "等待所有玩家完成演出。";
    } else if (s.phase === "finished") {
      phase = "victory";
      byId("battle").hidden = true;
      battleView = null;
      if (!CombatPlayback.queued) showVictory();
    } else {
      phase = "idle";
      byId("battle").hidden = true;
      battleView = null;
    }
    if (s.started && online)
      status(
        (n.local
          ? "离线" + (s.settings?.mode === "quick" ? "快速战" : "常规战")
          : "房间 " + n.room) +
          " · " +
          roleName(),
      );
    const effectEvent = s.effectEvent;
    if (effectEvent && !n.seen.has("effect:" + effectEvent.id)) {
      n.seen.add("effect:" + effectEvent.id);
      if (n.applied && online) {
        if (["move", "launch"].includes(effectEvent.type))
          PlanningUI.move(
            effectEvent,
            s.effectActors?.find((actor) => actor.id === effectEvent.unitId),
          );
        if (effectEvent.effect && !effectEvent.irradiation) SkillEffects.start(effectEvent);
      }
    }
    const event = s.lastEvent;
    if (event && !n.seen.has(event.id)) {
      n.seen.add(event.id);
      if (n.seen.size > 128) n.seen.delete(n.seen.values().next().value);
      // Global spectators see the same preview as the moving team. Confirmation
      // commits that path; it must not restart the already shown animation.
      const sawMovePreview =
        event.previewTeam !== undefined &&
        (s.viewTeam === null || event.previewTeam === s.viewTeam);

      if (
        ["move", "move_preview", "launch"].includes(event.type) &&
        ["idle", "deployment"].includes(s.phase) &&
        online &&
        n.applied
      ) {
        if (!sawMovePreview) PlanningUI.move(event);
        // 只结束当前所选单位的移动选点，不打断队友或其他单位的操作。
        if (selected === event.unitId && mode === "move") mode = "select";
      }
      if (event.type === "move_cancel" || (event.type === "move" && sawMovePreview))
        PlanningUI.stop(event.unitId);
      if (event.type === "skill" && s.phase === "idle" && online && n.applied)
        SkillControls.applied(event);
      if (
        event.type === "turn" &&
        (event.fromTeam ?? previousGame.team) !== (event.toTeam ?? game.team)
      ) {
        selected = null;
        weaponId = null;
        mode = "select";
        if (n.applied && online)
          CombatPlayback.turn({
            fromTeam: event.fromTeam ?? previousGame.team,
            round: game.round,
            toTeam: game.team,
          });
      }
    }
    if (ownResponse && n.focusedReactionId !== s.pending.id) {
      n.focusedReactionId = s.pending.id;
      const b = getUnit(s.pending.target);
      if (b) MapCamera.focus(Rules.center(b).x, Rules.center(b).y, { preserveZoom: true });
    }
    if (s.started && online) CombatPlayback.show();
    if (selected && !game.units.some((u) => u.id === selected && u.hp > 0)) selected = null;
    n.applied = true;
    update();
  }
  // 保活独立于 requestAnimationFrame；后台不绘制时仍保持网络连接。
  function keepAlive(sync = false) {
    if (!n.active || n.local || n.manual || !n.memberId || n.socket?.readyState !== WebSocket.OPEN)
      return;
    // 复用现有保活测量往返延迟；不新增轮询或游戏动作请求。
    if (pingStarted === null || performance.now() - pingStarted >= 20000) {
      pingStarted = performance.now();
      n.socket.send(JSON.stringify({ type: "ping" }));
    }
    if (sync && !n.awaiting && performance.now() - foregroundSyncAt >= 5000) {
      foregroundSyncAt = performance.now();
      n.socket.send(
        JSON.stringify({
          type: "action",
          action: "sync",
          id: "foreground-" + Date.now(),
        }),
      );
    }
  }
  setInterval(keepAlive, 20000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) keepAlive(true);
  });
  window.addEventListener("focus", () => keepAlive(true));
  document.addEventListener("resume", () => keepAlive(true));

  function isSpectator() {
    return window.ReplayPlayer?.active || (n.active && n.seat === null);
  }
  function roleName() {
    return n.seat === null
      ? "观战玩家"
      : "队伍" + (Rules.seatTeam(n.seat) + 1) + " · 出生点" + (Math.floor(n.seat / 2) + 1);
  }
  let last;
  try {
    last = JSON.parse(
      storage.get(lastKey()) ||
        storage.get("slg-last:PMC") ||
        storage.get("slg-last:EFSF") ||
        storage.get("slg-last:ZEON") ||
        "null",
    );
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
  // Wait for both assets and the character choice before restoring that character's seat.
  let restoredCharacter = false;
  function restoreCharacter() {
    if (window.CATALOG_DEVELOPER_MODE) return;
    if (restoredCharacter || !assetsReady || !PlayerProfile.selected() || window.isLayoutPreview)
      return;
    restoredCharacter = true;
    try {
      last = JSON.parse(
        storage.get(lastKey()) ||
          storage.get("slg-last:PMC") ||
          storage.get("slg-last:EFSF") ||
          storage.get("slg-last:ZEON") ||
          "null",
      );
    } catch {
      last = null;
    }
    if (!last || !(storage.get(key(last.url, last.room)) || legacyToken(last.url, last.room)))
      return;
    n.serverURL = last.url;
    n.room = last.room;
    connect("resume", true);
  }
  window.addEventListener("game-assets-ready", restoreCharacter, { once: true });
  window.addEventListener("character-selected", restoreCharacter);
  return Object.assign(n, {
    beginLocal,
    receive,
    canAct,
    canControl,
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
