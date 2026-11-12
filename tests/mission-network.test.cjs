const test = require("node:test"),
  assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws"),
  G = require("../shared/rules"),
  { createRoomEngine } = require("../shared/room-engine");
test("real cooperative sockets synchronize story, reject guest advance, deduplicate host and resume dialogue", async (t) => {
  let sequence = 0;
  const serverSockets = [],
    clients = [],
    frames = new Map();
  const wire = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wire.once("listening", resolve));
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "net-" + ++sequence,
    randomToken: () => "tok-" + ++sequence,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: (ws, m) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
  });
  wire.on("connection", (socket) => {
    serverSockets.push(socket);
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw);
      try {
        if (msg.action === "join") engine.join(socket, msg);
        else engine.action(socket, msg);
        socket.send(JSON.stringify({ testAck: msg.id }));
      } catch (error) {
        socket.send(JSON.stringify({ testAck: msg.id, error: error.message }));
      }
    });
    socket.on("close", () => engine.disconnect(socket));
  });
  t.after(async () => {
    engine.close();
    clients.forEach((ws) => ws.terminate());
    serverSockets.forEach((ws) => ws.terminate());
    await new Promise((resolve) => wire.close(resolve));
  });
  async function send(ws, data, id = "req-" + ++sequence) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off("message", read);
        reject(Error("mission network timeout"));
      }, 10000);
      function read(raw) {
        const m = JSON.parse(raw);
        if (m.testAck !== id) return;
        clearTimeout(timer);
        ws.off("message", read);
        m.error ? reject(Error(m.error)) : resolve(m);
      }
      ws.on("message", read);
      ws.send(JSON.stringify({ ...data, id }));
    });
  }
  async function connect(mode = "join", token) {
    const ws = new WebSocket("ws://127.0.0.1:" + wire.address().port);
    clients.push(ws);
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "state") frames.set(ws, m);
    });
    await new Promise((resolve) => ws.once("open", resolve));
    await send(ws, {
      action: "join",
      room: "COOP",
      mode,
      token,
      roomMode: "mission",
      characterFaction: "PMC",
      inventory: { ColumbusClass: 5 },
      licenses: { ColumbusClass: true },
    });
    return ws;
  }
  const host = await connect("create"),
    guest = await connect(),
    observer = await connect();
  const room = engine.rooms.get("COOP"),
    formation = [{ unitId: "ColumbusClass", kitId: "standard" }];
  const act = (ws, action, data = {}, id) =>
    send(
      ws,
      {
        action,
        revision: room.revision,
        round: room.game.round,
        phase: room.phase,
        matchId: room.matchId,
        requestId: null,
        ...data,
      },
      id,
    );
  const waitState = (ws, predicate) =>
    new Promise((resolve, reject) => {
      if (predicate(frames.get(ws))) return resolve(frames.get(ws));
      const timer = setTimeout(() => {
        ws.off("message", read);
        reject(Error("state synchronization timeout"));
      }, 5000);
      function read(raw) {
        const state = JSON.parse(raw);
        if (state.type !== "state" || !predicate(state)) return;
        clearTimeout(timer);
        ws.off("message", read);
        resolve(state);
      }
      ws.on("message", read);
    });
  await act(observer, "switch_seat", { seat: null });
  await act(guest, "set_ready", { ready: true, formation });
  await act(host, "start_game", { formation });
  await act(guest, "confirm_formation");
  await act(host, "confirm_formation");
  await act(guest, "auto_place_deployment");
  await act(host, "auto_place_deployment");
  await act(guest, "confirm_deployment");
  await act(host, "confirm_deployment");
  await waitState(guest, (s) => !!s?.game.mission?.dialogue);
  assert.deepEqual(frames.get(guest).game.mission.dialogue, frames.get(host).game.mission.dialogue);
  const d = room.game.mission.dialogue,
    fields = { dialogueId: d.id, lineIndex: 0 };
  await assert.rejects(() => act(guest, "mission_dialogue_next", fields), /房主/);
  await act(host, "mission_dialogue_next", fields, "same-dialogue-request");
  await act(host, "mission_dialogue_next", fields, "same-dialogue-request");
  assert.equal(room.game.mission.dialogue.index, 1);
  const guestId = frames.get(guest).you.id,
    token = room.members.get(guestId).token;
  observer.terminate();
  guest.terminate();
  const reconnected = await connect("resume", token);
  assert.equal(frames.get(reconnected).game.mission.dialogue.index, 1);
  await act(host, "mission_dialogue_next", { dialogueId: d.id, lineIndex: 1 });
  await waitState(reconnected, (s) => s?.phase === "idle" && s.game.mission.dialogue === null);
  assert.equal(room.game.mission.dialogue, null);
  assert.equal(room.phase, "idle");
  assert.equal(frames.get(reconnected).game.mission.dialogue, null);
  const ship = room.game.units.find((u) => G.ownerOf(u) === 0 && !u.missionActor);
  Object.assign(ship, { x: 8, y: 8, angle: 0 });
  room.revision++;
  engine.broadcast(room);
  assert(G.canRotate(room.game, ship, 1));
  await act(host, "rotate", { unitId: ship.id, direction: 1 }, "one-rotation");
  await act(host, "rotate", { unitId: ship.id, direction: 1 }, "one-rotation");
  assert.equal(ship.angle, 0);
  await act(host, "confirm_move", { unitId: ship.id });
  assert.equal(ship.angle, 90);
  assert(ship.rotated);
  assert(!ship.moved);
  const routes = [...G.reachable(room.game, ship).values()].filter((p) => p.path.length);
  assert(routes.length);
  assert(routes.every((p) => p.cost <= G.modelOf(ship).move / 2));
  const target = routes.find((p) => p.path.length === Math.floor(G.modelOf(ship).move / 2));
  assert(target);
  await act(host, "move", { unitId: ship.id, x: target.x, y: target.y });
  await act(host, "confirm_move", { unitId: ship.id });
  assert(ship.moved);
  assert.equal(ship.x, target.x);
  assert.equal(ship.y, target.y);
  await assert.rejects(
    () => act(host, "move", { unitId: ship.id, x: target.x + 1, y: target.y }),
    /移动|行动/,
  );
});
