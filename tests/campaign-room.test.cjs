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
    campaignReturnMs: 40,
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
  async function waitCheckpoint() {
    assert.equal(room.returnCountdown?.destination, "campaign");
    assert.equal(room.phase, "campaign_paused");
    const until = Date.now() + 2000;
    while (room.started && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(room.started, false);
  }
  async function enter(delegate = false) {
    const preparation = frames.get(host).campaign.preparation;
    const fields = {
      region: preparation.region,
      mapId: preparation.mapId,
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
    for (const socket of [host, other]) {
      const seat = frames.get(socket).you.seat;
      if (room.phase === "deployment" && room.game.deployment[seat] === false)
        await act(socket, "confirm_deployment");
    }
    for (const actor of room.game.units) {
      const rate = room.campaign.options.teams[actor.team].durability;
      assert.equal(actor.campaignDurability, rate);
      assert.equal(G.modelOf(actor).hp, Math.ceil(G.models[actor.model].hp * rate));
    }
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
    bannedEras: ["0079T1"],
    campaignOptions: { difficulty: "hard", aggression: "high", teams: [
      { research: 1.25, durability: 1.25, resources: 1.5 },
      { research: 0.75, durability: 0.75, resources: 0.5 },
    ] },
  });
  assert.equal(room.settings.scenarioId, "earth_0079_mid");
  assert.equal(room.settings.campaignOptions.difficulty, "hard");
  await assert.rejects(act(other, "configure_room", { battleMode: "campaign", campaignOptions: { difficulty: "easy" } }), /房主/);
  await assert.rejects(act(host, "configure_room", { battleMode: "campaign", campaignOptions: { difficulty: "invalid" } }), /设置无效/);
  assert.equal(room.settings.costLimit, 99999);
  assert.deepEqual(room.settings.bannedFactions, []);
  assert.deepEqual(room.settings.bannedEras, []);
  await assert.rejects(act(host, "start_game"), /准备/);
  await act(other, "set_ready", { ready: true });
  await assert.rejects(act(other, "start_game"), /房主/);
  await act(host, "start_game", { campaignRounds: 1 });
  assert(frames.get(host).campaign.units.every((unit) => unit.team === 0));
  assert(frames.get(other).campaign.units.every((unit) => unit.team === 1));
  assert.equal(room.campaign.teams[0].money, 37500);
  assert.equal(room.campaign.options.teams[1].durability, 0.75);
  const beforeIntelligence = room.campaign.teams[0].money;
  await act(host, "campaign_intelligence", { id: "intel-once", turn: 1 });
  await act(host, "campaign_intelligence", { id: "intel-once", turn: 1 });
  assert.equal(room.campaign.teams[0].money, beforeIntelligence - 2000);
  assert.equal(frames.get(host).campaign.intel.progress, 80);
  assert(frames.get(host).campaign.units.some((unit) => unit.team === 1));
  for (const unit of frames.get(host).campaign.units.filter((unit) => unit.team === 1)) {
    for (const field of ["hp", "en", "pilotName", "pilotId"]) assert(!Object.hasOwn(unit, field));
  }
  assert(frames.get(other).campaign.units.every((unit) => unit.team === 1));
  const beforeRecruitment = room.campaign.teams[0].money;
  await act(host, "campaign_pilot_recruit", {
    id: "recruit-once",
    turn: 1,
    name: "网络驾驶员",
    stats: { shooting: 999 },
  });
  await act(host, "campaign_pilot_recruit", {
    id: "recruit-once",
    turn: 1,
    name: "网络驾驶员",
    stats: { shooting: 999 },
  });
  assert.equal(room.campaign.pilots.length, 1);
  assert.equal(room.campaign.teams[0].money, beforeRecruitment - 1000);
  const crew = room.campaign.pilots[0];
  const crewArmy = room.campaign.units.find(
    (unit) => unit.team === 0 && unit.region === "canada_east",
  );
  await act(host, "campaign_pilot_assign", {
    turn: 1,
    armyId: crewArmy.id,
    pilotId: crew.profile.id,
  });
  await assert.rejects(
    act(other, "campaign_pilot_train", {
      turn: 1,
      pilotId: crew.profile.id,
      stat: "speed",
      amount: 5,
    }),
    /无权/,
  );
  await act(host, "campaign_pilot_train", {
    turn: 1,
    pilotId: crew.profile.id,
    stat: "speed",
    amount: 5,
  });
  await act(host, "campaign_research", { turn: 1, techId: "Tech_EFSF_0079_AntiMSPlan" });
  assert(!room.campaign.teams[0].researched.includes("Tech_EFSF_0079_AntiMSPlan"));
  assert.equal(room.campaign.teams[0].researchQueue.find((order) => order.techId === "Tech_EFSF_0079_AntiMSPlan").remaining, 1);
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
  assert.equal(room.campaign.teams[0].money, moneyBeforeOrder - require("../shared/campaign.js").quote({G,production:require("../shared/production-data.cjs")}, "RFF_06", "kit_1").money);
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
  assert.equal(room.game.units.length, room.campaign.units.filter((unit) => !unit.destroyed && unit.region === room.campaignBattle.region).length);
  const survivor = room.game.units.find((unit) => unit.team === 0);
  assert.equal(survivor.pilot.id, crew.profile.id);
  assert.equal(survivor.pilot.stats.speed, 105);
  survivor.pilot = G.pilots.battleResult(survivor.pilot, "assist", 200, 50);
  survivor.hp -= 500;
  const hp = survivor.hp,
    id = survivor.id;
  const victim = room.game.units.find((unit) => unit.team === 1);
  victim.hp = 0; // Authoritative combat result fixture; no client can submit this field.
  victim.campaignDefeatedBy = 0;
  // Keep another defender in the region so this encounter persists.
  const reserve = room.campaign.units.find((unit) => unit.region === "new_york" && !unit.destroyed);
  reserve.region = "canada_east";
  // This case checks saved damage, not the separate connected-base healing rule.
  const away = room.game.tiles
    .flatMap((row, y) => row.map((_, x) => ({ x, y })))
    .find(
      (cell) =>
        G.fits(room.game, survivor, cell.x, cell.y, survivor.angle) &&
        !G.campaignBattlefield.nodeAt(G, room.game, { ...survivor, ...cell }),
    );
  survivor.x = away.x;
  survivor.y = away.y;
  const wavePosition = { x: survivor.x, y: survivor.y, angle: survivor.angle };
  const treasury = structuredClone(room.campaign.teams);
  room.turnNotBefore = 0;
  await act(host, "end_turn");
  // A destroyed side ends the local wave; regional reserves keep the territory contested.
  await waitCheckpoint();
  assert.equal(room.campaign.units.find((unit) => unit.id === survivor.campaignId).state.hp, hp);
  assert.deepEqual(room.campaign.teams, treasury);
  assert.equal(room.economyAwards.length, 0);
  assert.equal(room.pilotAwards.length, 0);
  const visible = frames.get(host).campaign;
  assert(!JSON.stringify(visible).includes('"seed"'));
  await act(host, "campaign_export", { auto: true });
  const save = frames.get(host).save;
  assert.equal(save.format, "ProjectGreed-campaign");
  const ctx = {
    G,
    world: require("../assets/maps/strategy/earth_0079_mid/world.json"),
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
  assert.equal(restored.pilot.experience, 50);
  assert.equal(room.campaign.pilots[0].profile.experience, 50);
  assert.equal(restored.id, id);
  // Regional reserves join the continuing battlefield; survivors never redeploy.
  assert.deepEqual({ x: restored.x, y: restored.y, angle: restored.angle }, wavePosition);
  const position = { x: restored.x, y: restored.y, angle: restored.angle };
  const startRound = room.game.round;
  room.turnNotBefore = 0;
  await act(room.game.team === 0 ? host : other, "end_turn");
  await waitCheckpoint();
  const battle = room.campaign.encounters.find((item) => item.region === "canada_east").battleSave;
  assert.equal(battle.game.round, startRound + 1);
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
  assert.equal(room.campaignBattle.stopRound, battle.game.round + 1);
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
