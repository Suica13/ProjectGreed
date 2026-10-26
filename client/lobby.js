/* 联机入口：选择预设或输入自定义 IP，收到服务器房间列表后进入大厅。
 * 大厅连接不占用席位；单人模式不会打开它。
 */
const Lobby = (() => {
  let socket = null;
  let currentURL = null;
  let ready = false;
  let timeout = null;
  let listedRooms = [];
  const presets = CLIENT_CONFIG.presetServers;
  const probes = new Set();
  let probeGeneration = 0,
    statusTimer = null;
  function setConnecting(busy) {
    byId("connectServer").disabled = busy;
    for (const preset of presets) byId("preset-" + preset.id).disabled = busy;
  }
  function stopChecks() {
    probeGeneration++;
    clearTimeout(statusTimer);
    for (const cancel of [...probes]) cancel();
  }
  function mark(preset, state) {
    const label = byId("preset-status-" + preset.id);
    label.dataset.state = state;
    label.textContent = {
      checking: "检测中…",
      online: "在线",
      offline: "离线",
      unavailable: "无法检测",
    }[state];
  }
  // 只请求房间列表，不创建/加入房间；旧版服务端也支持该探测。
  function probe(preset, generation) {
    mark(preset, "checking");
    return new Promise((resolve) => {
      let peer = null,
        timer = null,
        done = false;
      function finish(state) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        probes.delete(cancel);
        if (generation === probeGeneration && state) mark(preset, state);
        if (peer) {
          peer.onopen = peer.onmessage = peer.onclose = peer.onerror = null;
          peer.close();
        }
        resolve();
      }
      const cancel = () => finish(null);
      probes.add(cancel);
      try {
        const url = Net.endpoint(preset.address);
        if (location.protocol === "https:" && url.startsWith("ws:")) return finish("unavailable");
        peer = new WebSocket(url);
        timer = setTimeout(() => finish("offline"), 4000);
        peer.onopen = () => peer.send(JSON.stringify({ type: "list_rooms" }));
        peer.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            finish(message.type === "rooms" && Array.isArray(message.rooms) ? "online" : "offline");
          } catch {
            finish("offline");
          }
        };
        peer.onerror = peer.onclose = () => finish("offline");
      } catch {
        finish("unavailable");
      }
    });
  }
  async function checkStatuses() {
    stopChecks();
    const generation = probeGeneration;
    await Promise.all(presets.map((preset) => probe(preset, generation)));
    if (generation === probeGeneration && !byId("serverConnect").hidden)
      statusTimer = setTimeout(checkStatuses, 20000);
  }
  function presetFor(url) {
    return presets.find((preset) => Net.endpoint(preset.address) === url);
  }

  function stopConnection() {
    clearTimeout(timeout);
    const previous = socket;
    socket = null;
    currentURL = null;
    ready = false;
    previous?.close();
  }

  function updateRoomEligibility() {
    byId("createRoom").disabled = false;
    byId("createRoom").title = "";
  }
  function refreshSelections() {
    const presets = Formation.presets();
    const select = byId("lobbyFormation");
    select.replaceChildren();
    for (let index = 0; index < presets.length; index++) {
      const option = new Option(presets[index].name, String(index));
      option.setAttribute("data-i18n-ignore", "");
      select.add(option);
    }
    select.value = String(Formation.presetIndex());
    updateRoomEligibility();
  }
  window.addEventListener("character-selected", () => {
    if (!byId("lobby").hidden) queueMicrotask(refreshSelections);
  });
  byId("lobbyFormation").onchange = (event) => {
    Formation.selectPreset(Number(event.target.value));
  };

  function close() {
    stopChecks();
    stopConnection();
    byId("lobby").hidden = true;
    byId("serverConnect").hidden = true;
    byId("start").classList.remove("server-connected");
    setConnecting(false);
  }

  function open(message = "选择预设服务器，或输入自定义 IP 和端口。") {
    if (window.isLayoutPreview) return;
    close();
    refreshSelections();
    byId("skirmishSetup").hidden = true;
    byId("start").hidden = false;
    byId("serverConnect").hidden = false;
    byId("roomList").replaceChildren();
    byId("serverStatus").textContent = message;
    checkStatuses();
    byId("preset-" + presets[0].id).focus();
  }

  // 行内各列始终使用同一顺序，便于比较多个房间。
  function render(rooms) {
    listedRooms = rooms;
    const list = byId("roomList");
    list.replaceChildren();
    byId("roomListStatus").textContent = rooms.length
      ? `${rooms.length} 个房间`
      : "暂无房间，可以创建一个。";
    for (const room of rooms) {
      const row = element("tr", "room-card");
      const roomName = element("th", "", room.code + " · " + (room.mode === "quick" ? "快速战" : "常规战"));
      roomName.scope = "row";
      const label =
        {
          waiting: "等待玩家",
          assembly: "最终编组",
          playing: "对战中",
          disconnected: "等待玩家恢复",
          finished: "已结束",
        }[room.phase] || "不可加入";
      const state = element("td", "room-state", label);
      const count = element(
        "td",
        "room-players",
        `${room.players}/${room.capacity}${room.spectators ? " · " + room.spectators + "观战" : ""}`,
      );
      const action = element("td", "room-action");
      const button = element(
        "button",
        "",
        room.joinable ? "加入" : "不可加入",
      );
      button.disabled = !room.joinable || !assetsReady;
      button.onclick = () => Net.connect("join", false, room.code);
      action.append(button);
      row.append(roomName, state, count, action);
      list.append(row);
    }
  }

  function fail(message) {
    stopConnection();
    byId("lobby").hidden = true;
    byId("start").classList.remove("server-connected");
    byId("serverConnect").hidden = false;
    byId("serverStatus").textContent = message;
    setConnecting(false);
    checkStatuses();
  }

  function requestRooms() {
    clearTimeout(timeout);
    timeout = setTimeout(() => fail("服务器响应超时，请检查 IP 和端口后重新连接。"), 8000);
    socket.send(JSON.stringify({ type: "list_rooms" }));
  }

  function connect(address = byId("serverAddress").value) {
    if (window.isLayoutPreview) return;
    stopConnection();
    let url;
    try {
      url = Net.endpoint(address);
    } catch (error) {
      byId("serverStatus").textContent = error.message;
      return;
    }
    setConnecting(true);
    if (presetFor(url)) byId("serverAddress").value = "";
    byId("serverStatus").textContent = "正在连接服务器…";
    let current;
    try {
      current = new WebSocket(url);
    } catch {
      fail("无法连接服务器，请检查 IP 和端口。");
      return;
    }
    socket = current;
    currentURL = url;
    timeout = setTimeout(() => fail("连接超时，请检查 IP 和端口。"), 8000);
    current.onopen = () => {
      if (socket === current) requestRooms();
    };
    current.onmessage = (event) => {
      if (socket !== current) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        fail("服务器返回的数据无效。");
        return;
      }
      if (message.type === "error") {
        fail(message.message || "服务器拒绝了连接。");
        return;
      }
      if (message.type !== "rooms" || !Array.isArray(message.rooms)) return;
      clearTimeout(timeout);
      ready = true;
      byId("serverConnect").hidden = true;
      byId("lobby").hidden = false;
      byId("start").classList.add("server-connected");
      refreshSelections();
      setConnecting(false);
      stopChecks();
      byId("connectedServer").textContent = presetFor(currentURL)?.name || new URL(currentURL).host;
      render(message.rooms);
    };
    current.onerror = () => {};
    current.onclose = () => {
      if (socket === current)
        fail(
          ready
            ? "服务器连接已中断，请重新连接。"
            : "连接失败，请检查服务器 IP、端口及服务端是否启动。",
        );
    };
  }

  function refresh() {
    if (!ready || socket?.readyState !== WebSocket.OPEN) {
      open("请先连接服务器。");
      return;
    }
    byId("roomListStatus").textContent = "正在刷新服务器列表…";
    requestRooms();
  }

  for (const preset of presets) {
    const button = element("button", "preset-server"),
      label = element("span", "", preset.name),
      status = element("span", "server-availability", "检测中…");
    button.id = "preset-" + preset.id;
    button.type = "button";
    status.id = "preset-status-" + preset.id;
    status.setAttribute("role", "status");
    button.append(label, status);
    button.onclick = () => connect(preset.address);
    byId("presetServers").append(button);
  }
  byId("refreshServerStatus").onclick = checkStatuses;
  byId("openRooms").onclick = () => open();
  byId("serverForm").onsubmit = (event) => {
    event.preventDefault();
    connect();
  };
  byId("cancelServer").onclick = close;
  byId("refreshRooms").onclick = refresh;
  return { open, close, render, refresh, endpoint: () => (ready ? currentURL : null) };
})();
