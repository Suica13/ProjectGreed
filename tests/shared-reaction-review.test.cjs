const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws");
const G = require("../shared/rules.js");
const { createRoomEngine } = require("../shared/room-engine.js");

for (const shared of [true, false]) test(`response review barrier applies only to shared units (${shared})`, async (t) => {
  let sequence = 0;
  const frames = [];
  const wire = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wire.once("listening", resolve));
  const serverSockets = [];
  const clients = new Map();
  wire.on("connection", (socket) => {
    serverSockets.push(socket);
    socket.on("message", (data) => {
      const msg = JSON.parse(data);
      try { engine.action(socket, msg); socket.send(JSON.stringify({ testAck: msg.id })); }
      catch (error) { socket.send(JSON.stringify({ testAck: msg.id, error: error.message })); }
    });
  });
  const engine = createRoomEngine({ rules: G, randomId: () => "id-" + ++sequence, randomToken: () => "token-" + ++sequence, randomSeed: () => 1, send: (ws, message) => frames.push({ ws, message }) });
  t.after(() => engine.close());
  async function connect() {
    const client = new WebSocket("ws://127.0.0.1:" + wire.address().port);
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    const socket = serverSockets.at(-1);
    clients.set(socket, client);
    return socket;
  }
  t.after(async () => {
    for (const client of clients.values()) client.terminate();
    for (const socket of serverSockets) socket.terminate();
    await new Promise((resolve) => wire.close(resolve));
  });
  const host = await connect(), first = await connect(), second = await connect();
  engine.join(host, { mode: "create", room: "REVIEW", name: "attacker", characterFaction: "PMC" });
  const room = engine.rooms.get("REVIEW");
  const act = (ws, action, fields = {}, revision = room.revision) => new Promise((resolve, reject) => {
    const msg = { id: "request-" + ++sequence, revision, round: room.game.round, matchId: room.matchId, action, ...fields };
    const client = clients.get(ws);
    const receive = (raw) => {
      const reply = JSON.parse(raw);
      if (reply.testAck !== msg.id) return;
      client.off("message", receive);
      reply.error ? reject(Error(reply.error)) : resolve();
    };
    client.on("message", receive);
    client.send(JSON.stringify(msg));
  });
  await act(host, "configure_room", { ...room.settings, mapId: "crossroads_2v2", fogMode: "disabled", shareAlliedUnits: shared });
  engine.join(first, { mode: "join", room: "REVIEW", name: "first", characterFaction: "PMC" });
  engine.join(second, { mode: "join", room: "REVIEW", name: "second", characterFaction: "PMC" });
  await act(second, "switch_seat", { seat: 3 });
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  room.game = G.create(false, 1, [[entry], [entry], [entry], [entry]], false, { mapId: "crossroads_2v2", fogMode: "disabled" });
  room.game.units = room.game.units.filter((unit) => G.ownerOf(unit) !== 2);
  room.started = true;
  room.matchId = "review-match";
  room.activeSeats = room.seats.map(Boolean);
  room.phase = "idle";
  room.plans = []; room.responses = []; room.reactions = []; room.pending = null;
  room.turnDone = [false, false, false, false]; room.turnNotBefore = 0;
  room.game.units.forEach((unit) => Object.assign(unit, { x: G.ownerOf(unit) === 0 ? 5 : 7, y: G.ownerOf(unit) === 3 ? 6 : 5, hp: 300000, en: 10000, actionPoints: 100 }));
  const attacker = room.game.units.find((unit) => G.ownerOf(unit) === 0);
  const defenders = room.game.units.filter((unit) => unit !== attacker);
  const weapon = G.modelOf(attacker).weapons.find((weapon) => defenders.every((target) => G.canAttack(room.game, attacker, target, weapon)));
  assert(weapon);
  for (const target of defenders) await act(host, "attack", { unitId: attacker.id, targetId: target.id, weaponId: weapon.id, weaponIds: [weapon.id] });
  await act(host, "end_turn");
  assert.equal(room.phase, "reaction");
  const before = room.game.units.map((unit) => unit.hp);
  const requests = room.reactions.map((request) => request.id);
  for (const reactionId of requests) {
    const targetId = room.reactions.find((request) => request.id === reactionId).target;
    const owner = G.ownerOf(room.game.units.find((unit) => unit.id === targetId));
    await act(shared || owner === 1 ? first : second, "respond", { reactionId, response: "defend" });
  }
  if (!shared) {
    assert.notEqual(room.phase, "reaction");
    return;
  }
  assert.equal(room.phase, "reaction");
  assert.deepEqual(room.game.units.map((unit) => unit.hp), before);
  let reviewId = room.reactionReviewId;
  await act(first, "confirm_responses", { reviewId });
  assert.equal(room.phase, "reaction");
  await act(second, "edit_response", { reactionId: requests[0] });
  assert.deepEqual(room.reactionReady, []);
  await act(second, "respond", { reactionId: requests[0], response: "evade" });
  assert.notEqual(room.reactionReviewId, reviewId);
  await assert.rejects(() => act(first, "confirm_responses", { reviewId }), /已被修改/);
  reviewId = room.reactionReviewId;
  await assert.rejects(() => act(host, "confirm_responses", { reviewId }), /没有需要确认/);
  const revision = room.revision;
  await act(first, "confirm_responses", { reviewId });
  await act(second, "confirm_responses", { reviewId, id: "final-confirm" }, revision);
  const afterResolution = room.game.units.map((unit) => ({ hp: unit.hp, en: unit.en }));
  await act(second, "confirm_responses", { reviewId, id: "final-confirm" }, revision);
  assert.deepEqual(room.game.units.map((unit) => ({ hp: unit.hp, en: unit.en })), afterResolution);
  assert.notEqual(room.phase, "reaction");
  assert.equal(room.responses.length, 0);
});
