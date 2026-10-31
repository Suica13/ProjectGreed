const test = require("node:test"),
  assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws");
const G = require("../shared/rules.js"),
  Records = require("../shared/match-records.js");
const { createRoomEngine } = require("../shared/room-engine.js");

test("campaign WebSocket orders pause tactical combat, export private saves and resume with income", async (t) => {
  let sequence = 0;
  const wire = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wire.once("listening", resolve));
  const sockets = [],
    clients = new Map(),
    frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id-" + ++sequence,
    randomToken: () => "token-" + ++sequence,
    randomSeed: () => 1,
    send: (socket, message) => {
      frames.set(socket, message);
      socket.send(JSON.stringify(message));
    },
  });
  wire.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw);
      try {
        engine.action(socket, msg);
        socket.send(JSON.stringify({ testAck: msg.id }));
      } catch (error) {
        socket.send(JSON.stringify({ testAck: msg.id, error: error.message }));
      }
    });
  });
  t.after(async () => {
    engine.close();
    for (const client of clients.values()) client.terminate();
    for (const socket of sockets) socket.terminate();
    await new Promise((resolve) => wire.close(resolve));
  });
  async function connect(name, mode) {
    const client = new WebSocket("ws://127.0.0.1:" + wire.address().port);
    await new Promise((resolve) => client.once("open", resolve));
    const socket = sockets.at(-1);
    clients.set(socket, client);
    engine.join(socket, {
      mode,
      room: "EARTH",
      name,
      characterFaction: "PMC",
      roomMode: "campaign",
    });
    return socket;
  }
  const host = await connect("commander", "create"),
    other = await connect("opponent", "join");
  const room = engine.rooms.get("EARTH");
  async function act(socket, action, fields = {}) {
    const msg = {
      action,
      id: "request-" + ++sequence,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      ...fields,
    };
    const client = clients.get(socket);
    return new Promise((resolve, reject) => {
      const read = (raw) => {
        const answer = JSON.parse(raw);
        if (answer.testAck !== msg.id) return;
        client.off("message", read);
        answer.error ? reject(Error(answer.error)) : resolve();
      };
      client.on("message", read);
      client.send(JSON.stringify(msg));
    });
  }
  async function enter(delegate = false) {
    const preparation = frames.get(host).campaign.preparation;
    const fields = {
      region: preparation.region,
      mapId: "frontier_1v1",
      delegate,
      preparationId: preparation.id,
    };
    const revision = room.revision;
    await act(host, "campaign_enter", fields);
    assert.equal(room.started, false, "one commander cannot start before the opponent chooses");
    assert.equal(
      frames.get(host).campaign.preparation.participants.find((item) => item.seat === 0).ready,
      true,
    );
    await assert.rejects(
      act(other, "campaign_enter", { ...fields, preparationId: "old-battle" }),
      /准备已变化/,
    );
    await act(other, "campaign_enter", { ...fields, delegate: false, revision });
    assert.equal(
      room.started,
      true,
      "the last participant starts exactly this engagement, even with a concurrent revision",
    );
  }
  assert.equal(room.settings.mode, "campaign");
  await act(host, "configure_room", {
    mapId: room.settings.mapId,
    battleMode: "campaign",
    costLimit: -10,
    unitLimit: -10,
    unitCostLimit: -10,
    bannedFactions: ["EFSF", "ZEON"],
    bannedEras: ["0079E"],
  });
  assert.equal(room.settings.scenarioId, "earth_0079_mid");
  assert.equal(room.settings.costLimit, 99999);
  assert.deepEqual(room.settings.bannedFactions, []);
  assert.deepEqual(room.settings.bannedEras, []);
  await assert.rejects(act(host, "start_game"), /准备/);
  await act(other, "set_ready", { ready: true });
  await assert.rejects(act(other, "start_game"), /房主/);
  await act(host, "start_game", { campaignRounds: 1 });
  await act(host, "campaign_research", { turn: 1, techId: "Tech_EFSF_0079_AntiMSPlan" });
  assert(room.campaign.teams[0].researched.includes("Tech_EFSF_0079_AntiMSPlan"));
  assert.match(frames.get(host).ack, /^request-/);
  const moneyBeforeOrder = room.campaign.teams[0].money;
  await act(host, "campaign_produce", {
    turn: 1,
    region: "jaburo",
    unitId: "RFF_06",
    kitId: "kit_1",
    money: 0,
    supplies: 0,
  });
  assert.equal(room.campaign.orders[0].kitId, "kit_1");
  assert.equal(room.campaign.teams[0].money, moneyBeforeOrder - 2100);
  await act(host, "campaign_cancel_order", { turn: 1, orderId: room.campaign.orders[0].id });
  assert.equal(room.campaign.orders.length, 0);
  assert.equal(room.campaign.teams[0].money, moneyBeforeOrder);
  const mover = room.campaign.units.find((unit) => unit.region === "new_york");
  await act(other, "campaign_move", { turn: 1, ids: [mover.id], region: "canada_east" });
  await act(host, "campaign_ready", { turn: 1 });
  await act(other, "campaign_ready", { turn: 1 });
  assert.equal(room.campaign.phase, "encounters");
  await enter();
  assert.equal(room.phase, "idle");
  assert.equal(room.settings.mode, "campaign");
  assert.equal(room.game.units.length, 3);
  const survivor = room.game.units.find((unit) => unit.team === 0);
  survivor.hp -= 500;
  const hp = survivor.hp,
    id = survivor.id;
  const victim = room.game.units.find((unit) => unit.team === 1);
  victim.hp = 0; // Authoritative combat result fixture; no client can submit this field.
  victim.campaignDefeatedBy = 0;
  // Keep another defender in the region so this encounter persists.
  const reserve = room.campaign.units.find((unit) => unit.region === "new_york" && !unit.destroyed);
  reserve.region = "canada_east";
  const wavePosition = { x: survivor.x, y: survivor.y, angle: survivor.angle };
  const treasury = room.campaign.teams[0].money;
  room.turnNotBefore = 0;
  await act(host, "end_turn");
  // A destroyed side ends the local wave; regional reserves keep the territory contested.
  assert.equal(room.started, false);
  assert.equal(room.campaign.units.find((unit) => unit.id === survivor.campaignId).state.hp, hp);
  assert(room.campaign.teams[0].money > treasury);
  assert.equal(room.economyAwards.length, 0);
  assert.equal(room.pilotAwards.length, 0);
  const visible = frames.get(host).campaign;
  assert(!JSON.stringify(visible).includes('"seed"'));
  await act(host, "campaign_export", { auto: true });
  const save = frames.get(host).save;
  assert.equal(save.format, "ProjectGreed-campaign");
  const ctx = {
    G,
    world: require("../shared/campaign-world.json"),
    production: require("../shared/production-data.cjs"),
    development: require("../shared/development.js"),
    validateBattle: (input) => Records.validateSave(G, input),
  };
  require("../shared/campaign.js").validate(ctx, save, [...room.members.values()]);
  assert.equal(save.units.find((unit) => unit.id === survivor.campaignId).state.hp, hp);
  // Advance a new strategic turn and re-enter: no personal license or formation is required.
  await act(host, "campaign_ready", { turn: room.campaign.turn });
  await act(other, "campaign_ready", { turn: room.campaign.turn });
  await enter();
  const restored = room.game.units.find((unit) => unit.campaignId === survivor.campaignId);
  assert.equal(restored.hp, hp);
  assert.equal(restored.id, id);
  // Regional reserves join the continuing battlefield; survivors never redeploy.
  assert.deepEqual({ x: restored.x, y: restored.y, angle: restored.angle }, wavePosition);
  const position = { x: restored.x, y: restored.y, angle: restored.angle };
  const startRound = room.game.round;
  room.turnNotBefore = 0;
  await act(room.game.team === 0 ? host : other, "end_turn");
  assert.equal(room.started, true);
  room.turnNotBefore = 0;
  await act(room.game.team === 0 ? host : other, "end_turn");
  assert.equal(room.started, false);
  const battle = room.campaign.encounters.find((item) => item.region === "canada_east").battleSave;
  assert.equal(battle.game.round, startRound + 2);
  assert.equal(battle.game.units.find((actor) => actor.id === id).hp, hp);
  assert.deepEqual(
    Object.fromEntries(
      ["x", "y", "angle"].map((key) => [
        key,
        battle.game.units.find((actor) => actor.id === id)[key],
      ]),
    ),
    position,
  );
  await act(host, "campaign_export", { auto: true });
  const saved = frames.get(host).save;
  require("../shared/campaign.js").validate(ctx, saved, [...room.members.values()]);
  const text = JSON.stringify(saved);
  await act(host, "campaign_import_begin", { length: text.length });
  for (let offset = 0, sequence = 0; offset < text.length; offset += 8000, sequence++)
    await act(host, "campaign_import_chunk", { sequence, text: text.slice(offset, offset + 8000) });
  await act(host, "campaign_import_finish");
  await act(host, "campaign_ready", { turn: room.campaign.turn });
  await act(other, "campaign_ready", { turn: room.campaign.turn });
  await enter(true);
  assert.equal(room.game.round, battle.game.round);
  assert.equal(room.game.units.find((actor) => actor.id === id).hp, hp);
  assert.deepEqual(
    Object.fromEntries(
      ["x", "y", "angle"].map((key) => [
        key,
        room.game.units.find((actor) => actor.id === id)[key],
      ]),
    ),
    position,
  );
  assert.equal(room.campaignBattle.stopRound, battle.game.round + 2);
  assert.deepEqual(room.campaignBattle.delegatedSeats, [0]);
  assert.equal(room.seats[0].bot, undefined);
  await assert.rejects(act(host, "end_turn"), /委任AI/);
  if (room.game.team === 1) {
    room.turnNotBefore = 0;
    await act(other, "end_turn");
  }
  const until = Date.now() + 8000;
  while (
    !room.game.units.some(
      (actor) => G.ownerOf(actor) === 0 && (actor.moved || actor.plan || actor.acted),
    ) &&
    Date.now() < until
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert(
    room.game.units.some(
      (actor) => G.ownerOf(actor) === 0 && (actor.moved || actor.plan || actor.acted),
    ),
    "AI must issue real tactical actions for the delegated human owner",
  );
  assert.equal(room.seats[0].bot, undefined);
  // End the segment through the authoritative AI end-turn path, then return manual control.
  room.plans = [];
  room.turnNotBefore = 0;
  for (const actor of room.game.units) {
    delete actor.plan;
    if (actor.team === 0) {
      actor.acted = true;
      actor.actionPoints = 0;
    } else actor.hp = 0;
  }
  const completedBy = Date.now() + 8000;
  while (room.started && Date.now() < completedBy)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(room.started, false);
  assert.equal(room.campaignBattle, null);
  assert.equal(room.seats[0].bot, undefined);
  await act(host, "campaign_ready", { turn: room.campaign.turn });
});
