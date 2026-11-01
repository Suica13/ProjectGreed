const test = require("node:test"),
  assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws");
const G = require("../shared/rules.js");
const { createRoomEngine } = require("../shared/room-engine.js");

test("ten visible campaign turns wait for spectator playback, freeze and return everyone after five seconds", async (t) => {
  let sequence = 0;
  const wire = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wire.once("listening", resolve));
  const sockets = [],
    clients = [],
    frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "event-" + ++sequence,
    randomToken: () => "token-" + ++sequence,
    randomSeed: () => 1,
    send: (socket, message) => socket.send(JSON.stringify(message)),
  });
  wire.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      try {
        if (message.action === "join") engine.join(socket, message);
        else engine.action(socket, message);
        socket.send(JSON.stringify({ testAck: message.id }));
      } catch (error) {
        socket.send(JSON.stringify({ testAck: message.id, error: error.message }));
      }
    });
  });
  t.after(async () => {
    engine.close();
    clients.forEach((client) => client.terminate());
    sockets.forEach((socket) => socket.terminate());
    await new Promise((resolve) => wire.close(resolve));
  });
  function send(client, message) {
    message.id = "request-" + ++sequence;
    return new Promise((resolve, reject) => {
      const read = (raw) => {
        const reply = JSON.parse(raw);
        if (reply.testAck !== message.id) return;
        client.off("message", read);
        reply.error ? reject(Error(reply.error)) : resolve();
      };
      client.on("message", read);
      client.send(JSON.stringify(message));
    });
  }
  function waitForFrame(client, predicate) {
    if (predicate(frames.get(client))) return Promise.resolve(frames.get(client));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.off("message", read);
        reject(Error("state delivery timed out"));
      }, 9000);
      const read = (raw) => {
        const frame = JSON.parse(raw);
        if (frame.type !== "state" || !predicate(frame)) return;
        clearTimeout(timeout);
        client.off("message", read);
        resolve(frame);
      };
      client.on("message", read);
    });
  }
  async function connect(name, mode) {
    const client = new WebSocket("ws://127.0.0.1:" + wire.address().port);
    clients.push(client);
    client.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.type === "state") frames.set(client, message);
    });
    await new Promise((resolve) => client.once("open", resolve));
    await send(client, {
      action: "join",
      mode,
      room: "LIMIT",
      name,
      characterFaction: "PMC",
      roomMode: "campaign",
    });
    return client;
  }
  const host = await connect("host", "create"),
    guest = await connect("guest", "join"),
    observer = await connect("observer", "join");
  const room = engine.rooms.get("LIMIT");
  const act = (client, action, fields = {}) =>
    send(client, {
      action,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      ...fields,
    });
  await act(observer, "switch_seat", { seat: null });
  assert.equal(frames.get(observer).you.seat, null);
  await act(guest, "set_ready", { ready: true });
  await act(host, "start_game", { campaignRounds: 10 });
  const army = room.campaign.units.find((unit) => unit.region === "new_york");
  await act(guest, "campaign_move", { turn: 1, ids: [army.id], region: "canada_east" });
  await act(host, "campaign_ready", { turn: 1 });
  await act(guest, "campaign_ready", { turn: 1 });
  await Promise.all(
    clients.map((client) => waitForFrame(client, (frame) => !!frame?.campaign?.preparation)),
  );
  const preparation = frames.get(host).campaign.preparation;
  const enter = {
    preparationId: preparation.id,
    region: preparation.region,
    mapId: preparation.mapId,
    delegate: false,
  };
  await act(host, "campaign_enter", enter);
  await act(guest, "campaign_enter", enter);
  if (room.phase === "deployment" && room.game.deployment[0] === false)
    await act(host, "confirm_deployment");
  if (room.phase === "deployment" && room.game.deployment[1] === false)
    await act(guest, "confirm_deployment");
  assert.equal(room.game.round, 1);
  assert.equal(room.campaignBattle.stopRound, 11);
  for (let round = 1; round < 10; round++) {
    room.turnNotBefore = 0;
    await act(room.game.team === 0 ? host : guest, "end_turn");
    assert.equal(room.game.round, round + 1);
    assert.equal(room.returnCountdown, null);
    assert.equal(room.started, true);
  }
  // The final combat has already been adjudicated. The playback barrier still
  // includes observers, so neither advancing the turn nor the countdown can race it.
  room.phase = "playback";
  room.playback = {
    id: "last-batch",
    matchId: room.matchId,
    members: [...room.members.values()].map((member) => member.id),
    ready: [],
    automatic: false,
    resumeTurn: false,
  };
  engine.broadcast(room);
  await act(host, "playback_ready", { batchId: "last-batch" });
  await act(guest, "playback_ready", { batchId: "last-batch" });
  assert.equal(room.game.round, 10);
  assert.equal(room.returnCountdown, null);
  await act(observer, "playback_ready", { batchId: "last-batch" });
  assert.equal(room.game.round, 11);
  assert.equal(room.started, true);
  assert.equal(room.phase, "campaign_paused");
  await Promise.all(
    clients.map((client) =>
      waitForFrame(client, (frame) => frame?.returnCountdown?.destination === "campaign"),
    ),
  );
  const countdown = room.returnCountdown;
  assert.equal(countdown.destination, "campaign");
  assert(countdown.at - Date.now() > 4500 && countdown.at - Date.now() <= 5000);
  for (const client of clients) {
    assert.equal(frames.get(client).returnCountdown.id, countdown.id);
    assert.equal(frames.get(client).returnCountdown.at, countdown.at);
  }
  const frozen = JSON.parse(JSON.stringify(room.game));
  const saved = room.campaign.encounters.find(
    (encounter) => encounter.region === preparation.region,
  ).battleSave;
  assert.deepEqual(saved.game, frozen, "save precedes the return countdown");
  await assert.rejects(act(host, "end_turn"), /战局已中断/);
  assert.deepEqual(room.game, frozen, "the eleventh visible turn cannot accept an action");
  await act(observer, "sync");
  assert.equal(
    frames.get(observer).returnCountdown.at,
    countdown.at,
    "sync must not restart five seconds",
  );
  const returned = clients.map(
    (client) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("campaign return timed out")), 9000);
        const read = (raw) => {
          const frame = JSON.parse(raw);
          if (frame.type !== "state" || frame.started) return;
          clearTimeout(timeout);
          client.off("message", read);
          resolve(frame);
        };
        client.on("message", read);
      }),
  );
  const finalFrames = await Promise.all(returned);
  assert(Date.now() >= countdown.at - 50);
  assert.equal(room.started, false);
  assert.equal(room.phase, "waiting");
  for (const frame of finalFrames) {
    assert.equal(frame.returnCountdown, null);
    assert.equal(frame.campaign.activeRegion, null);
    assert.equal(frame.campaign.turn, 2);
    assert(frame.campaign.history.some(line=>line.includes("局地战阶段简报")));
    assert.equal(frame.campaign.history.filter(line=>line.includes("局地战回合简报")).length,10);
  }
  const persisted = room.campaign.encounters.find(
    (encounter) => encounter.region === preparation.region,
  ).battleSave.game;
  assert.deepEqual(persisted, frozen, "no extra phase or regeneration occurs while returning");
});
