/* 离线传输适配器：不创建 WebSocket，不请求网络。
 * 浏览器内运行与服务器相同的 RoomEngine，通过消息副本同步 UI。
 */
const LocalRoom = (() => {
  function id() {
    return (
      crypto.randomUUID?.() || Date.now().toString(16) + "-" + Math.random().toString(16).slice(2)
    );
  }
  function open() {
    if (!assetsReady || window.isLayoutPreview || !PlayerProfile.selected()) return;
    Net.leave();
    let engine;
    const socket = {
      readyState: 1,
      send(raw) {
        queueMicrotask(() => {
          if (socket.readyState !== 1) return;
          const msg = JSON.parse(raw);
          try {
            if (msg.type === "leave") engine.leaveRoom(socket);
            else engine.action(socket, msg);
          } catch (error) {
            deliver(socket, { type: "error", id: msg.id, message: error.message });
          }
        });
      },
      close() {
        socket.readyState = 3;
        engine?.close();
      },
    };
    function deliver(target, message) {
      if (target !== socket || socket.readyState !== 1) return;
      const snapshot = JSON.parse(JSON.stringify(message));
      queueMicrotask(() => {
        if (socket.readyState === 1) Net.receive(snapshot, socket);
      });
    }
    engine = createRoomEngine({
      rules: Rules,
      send: deliver,
      randomId: id,
      randomToken: id,
      randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
    });
    Net.beginLocal(socket);
    byId("skirmishSetup").hidden = true;
    engine.join(socket, {
      mode: "create",
      room: "OFFLINE",
      name: PlayerProfile.name(),
      characterFaction: PlayerProfile.faction(),
      roomMode: byId("offlineRoomMode").value,
    });
    engine.action(socket, {
      action: "add_ai",
      seat: 1,
      id: id(),
      revision: engine.rooms.get("OFFLINE").revision,
    });
  }
  function closeSetup() {
    byId("skirmishSetup").hidden = true;
    byId("openSkirmish").focus();
  }
  byId("openSkirmish").onclick = () => {
    byId("skirmishSetup").hidden = false;
    byId("createOfflineRoom").focus();
  };
  byId("closeSkirmish").onclick = closeSetup;
  byId("skirmishSetup").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSetup();
    }
  });
  byId("createOfflineRoom").onclick = open;
  return { open };
})();
