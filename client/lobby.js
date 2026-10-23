/* 联机入口分为两步：输入 IP → 收到服务器房间列表后进入大厅。
 * 大厅连接不占用席位；单人模式不会打开它。
 */
const Lobby = (() => {
  let socket = null;
  let currentURL = null;
  let ready = false;
  let timeout = null;

  function stopConnection() {
    clearTimeout(timeout);
    const previous = socket;
    socket = null;
    currentURL = null;
    ready = false;
    previous?.close();
  }

  function close() {
    stopConnection();
    byId("lobby").hidden = true;
    byId("serverConnect").hidden = true;
    byId("connectServer").disabled = false;
  }

  function open(message = "输入服务器 IP 和端口后连接。") {
    if (window.isLayoutPreview) return;
    close();
    byId("start").hidden = false;
    byId("serverConnect").hidden = false;
    byId("roomList").replaceChildren();
    byId("serverStatus").textContent = message;
    byId("serverAddress").focus();
  }

  // 行内各列始终使用同一顺序，便于比较多个房间。
  function render(rooms) {
    const list = byId("roomList");
    list.replaceChildren();
    byId("roomListStatus").textContent = rooms.length
      ? `${rooms.length} 个房间`
      : "暂无房间，可以创建一个。";
    for (const room of rooms) {
      const row = element("tr", "room-card");
      const roomName = element("th", "", room.code);
      roomName.scope = "row";
      const label =
        {
          waiting: "等待玩家",
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
        room.joinable ? (room.started ? "观战" : "加入") : "不可加入",
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
    byId("serverConnect").hidden = false;
    byId("serverStatus").textContent = message;
    byId("connectServer").disabled = false;
  }

  function requestRooms() {
    clearTimeout(timeout);
    timeout = setTimeout(() => fail("服务器响应超时，请检查 IP 和端口后重新连接。"), 8000);
    socket.send(JSON.stringify({ type: "list_rooms" }));
  }

  function connect() {
    if (window.isLayoutPreview) return;
    stopConnection();
    let url;
    try {
      url = Net.endpoint(byId("serverAddress").value);
    } catch (error) {
      byId("serverStatus").textContent = error.message;
      return;
    }
    byId("connectServer").disabled = true;
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
      byId("connectServer").disabled = false;
      byId("connectedServer").textContent = new URL(currentURL).host;
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

  byId("openRooms").onclick = () => open();
  byId("serverForm").onsubmit = (event) => {
    event.preventDefault();
    connect();
  };
  byId("cancelServer").onclick = close;
  byId("refreshRooms").onclick = refresh;
  return { open, close, render, refresh, endpoint: () => (ready ? currentURL : null) };
})();
