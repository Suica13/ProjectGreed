const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws");
const G = require("../shared/rules.js");
const C = require("../shared/campaign.js");
const { createRoomEngine } = require("../shared/room-engine.js");

test("campaign team changes synchronize faction and allow spectating/AI takeover without moving armies or refreshing AP", async (t) => {
  let serial = 0;
  const wire = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wire.once("listening", resolve));
  const sockets = [],
    clients = new Map(),
    frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    campaignReturnMs: 30,
    randomId: () => "seat-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 1,
    send: (socket, message) => {
      frames.set(socket, message);
      socket.send?.(JSON.stringify(message));
    },
  });
  wire.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw);
      try {
        engine.action(socket, msg);
        socket.send(JSON.stringify({ done: msg.id }));
      } catch (error) {
        socket.send(JSON.stringify({ done: msg.id, error: error.message }));
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
      room: "SEATS",
      name,
      roomMode: "campaign",
      characterFaction: "PMC",
    });
    return socket;
  }
  const host = await connect("Host", "create"),
    other = await connect("Other", "join");
  const room = engine.rooms.get("SEATS");
  async function act(socket, action, fields = {}) {
    const msg = {
      action,
      id: "request-" + ++serial,
      revision: room.revision,
      matchId: room.matchId,
      round: room.game.round,
      ...fields,
    };
    const client = clients.get(socket);
    return new Promise((resolve, reject) => {
      const read = (raw) => {
        const reply = JSON.parse(raw);
        if (reply.done !== msg.id) return;
        client.off("message", read);
        reply.error ? reject(Error(reply.error)) : resolve();
      };
      client.on("message", read);
      client.send(JSON.stringify(msg));
    });
  }
  await act(host, "configure_room", { mapId: "military_base_5v5", battleMode: "campaign" });
  assert.equal(room.seats.length, 10);
  assert.equal(room.settings.mapId, "military_base_5v5");
  await act(host, "add_ai", { seat: 2 });
  await act(host, "add_ai", { seat: 3 });
  await assert.rejects(act(host, "set_faction", { faction: "ZEON" }), /固定使用一个阵营/);
  await act(other, "set_ready", { ready: true });
  await act(host, "start_game", { campaignRounds: 10 });
  assert.deepEqual(
    room.seats.slice(0, 4).map((member) => member.characterFaction),
    ["EFSF", "ZEON", "EFSF", "ZEON"],
  );
  const armies = structuredClone(room.campaign.units);
  await act(host, "switch_seat", { seat: 3 });
  assert.equal(frames.get(host).you.campaignTeam, 1);
  assert.equal(room.seats[3].characterFaction, "ZEON");
  await act(host, "switch_seat", { seat: 0 });
  assert.equal(room.seats[0].characterFaction, "EFSF");
  await assert.rejects(
    act(host, "configure_ai", { seat: 2, config: {}, characterFaction: "ZEON" }),
    /强制阵营/,
  );
  await act(host, "switch_seat", { seat: null });
  assert.equal(frames.get(host).you.seat, null);
  assert.equal(frames.get(host).you.campaignTeam, 0);
  assert.equal(frames.get(host).viewTeam, 0);
  await act(host, "spectate", { team: 1 });
  assert.equal(frames.get(host).viewTeam, 1);
  await act(host, "spectate", { team: null });
  assert.equal(frames.get(host).viewTeam, null);
  await act(host, "join_team", { team: 1 });
  assert.equal(room.seats[3].characterFaction, "ZEON");
  await act(host, "switch_seat", { seat: 2 });
  assert.equal(frames.get(host).you.seat, 2);
  assert.equal(room.seats[0], null);
  await assert.rejects(act(other, "add_ai", { seat: 0 }), /只有房主/);
  await act(host, "add_ai", { seat: 0, id: "restore-ai" });
  await act(host, "add_ai", { seat: 0, id: "restore-ai" });
  assert.equal(room.seats[0].bot, true);
  assert.equal(room.seats[0].characterFaction, "EFSF");
  assert(![...room.members.values()].some((member) => member.bot && member.seat === 2));
  assert.deepEqual(
    room.campaign.units,
    armies,
    "seat changes must not transfer, replace or heal armies",
  );
  await act(host, "switch_seat", { seat: 0 });
  assert.equal(room.seats[2], null);

  const ally = room.campaign.units.find((unit) => unit.ownerSeat === 0 && !unit.state?.embarked);
  const enemy = C.addUnit({ G, production: require("../shared/production-data.cjs") },
    room.campaign, 1, "canada_east", "MS_06F");
  ally.region = enemy.region = "canada_east";
  const reinforcement = C.addUnit(
    { G, production: require("../shared/production-data.cjs") },
    room.campaign,
    0,
    "canada_east",
    "Type61",
  );
  room.campaign.units = [ally, enemy, reinforcement];
  room.campaign.phase = "encounters";
  room.campaign.encounters = [
    { region: "canada_east", turn: 0, battleSave: null, roster: {}, settled: [] },
  ];
  room.revision++;
  engine.broadcast(room);
  const preparation = frames.get(host).campaign.preparation;
  const enter = {
    region: preparation.region,
    preparationId: preparation.id,
    mapId: preparation.mapId,
    delegate: false,
  };
  await act(host, "campaign_enter", enter);
  await act(other, "campaign_enter", enter);
  for (const socket of [host, other]) {
    const seat = frames.get(socket).you.seat;
    if (room.phase === "deployment" && room.game.deployment[seat] === false)
      await act(socket, "confirm_deployment");
  }
  assert.equal(room.started, true);
  const deploymentLog = room.log.filter((line) => line.includes(" 从") && line.endsWith("部署。"));
  assert.equal(deploymentLog.length, room.game.units.length);
  for (const actor of room.game.units) {
    const line = deploymentLog.find((line) => line.startsWith(G.unitLogName(actor) + " 从"));
    assert(line);
    assert(room.teamLogs[actor.team].includes(line));
    assert(!room.teamLogs[1 - actor.team].includes(line), "enemy deployment origin must remain private");
  }
  const delegationState = room.game.units.map((unit) => [unit.id, unit.hp, unit.en, unit.actionPoints, unit.x, unit.y]);
  const done = [...room.turnDone];
  const previousTurnNotBefore = room.turnNotBefore;
  room.turnNotBefore = Date.now() + 10000;
  await act(host, "campaign_delegate", { delegate: true, id: "delegate-once" });
  await act(host, "campaign_delegate", { delegate: true, id: "delegate-once" });
  assert.deepEqual(room.campaignBattle.delegatedSeats, [0]);
  await act(host, "campaign_delegate", { delegate: false });
  assert.deepEqual(room.campaignBattle.delegatedSeats, []);
  assert.deepEqual(room.turnDone, done);
  assert.deepEqual(room.game.units.map((unit) => [unit.id, unit.hp, unit.en, unit.actionPoints, unit.x, unit.y]), delegationState);
  await assert.rejects(act(host, "campaign_delegate", { delegate: "yes" }), /状态无效/);
  room.turnNotBefore = previousTurnNotBefore;
  const ap = room.game.units.map((unit) => [unit.id, unit.actionPoints]);
  await act(host, "switch_seat", { seat: null });
  assert.equal(room.settings.campaignCommanders[0], null);
  await assert.rejects(act(host, "campaign_delegate", { delegate: true }), /参战玩家/);
  assert.equal(room.activeSeats[0], false);
  await act(host, "switch_seat", { seat: 2 });
  assert.equal(room.settings.campaignCommanders[0], 2);
  assert.equal(room.game.campaignControllers[0], 2);
  assert.equal(G.controllerOf(room.game, room.game.units.find((u) => G.ownerOf(u) === 0)), 2);
  assert(room.game.units.some((u) => G.ownerOf(u) === 0), "fallback must preserve historical ownership");
  assert.equal(C.commander([...room.members.values()], 0), 2);
  assert.equal(room.activeSeats[2], true);
  await act(host, "add_ai", { seat: 4 });
  assert.equal(room.seats[4].bot, true);
  assert.equal(room.seats[4].characterFaction, "EFSF");
  const beforeRemoval = structuredClone(room.game.units);
  await assert.rejects(act(other, "remove_ai", { seat: 4 }), /房主/);
  await act(host, "remove_ai", { seat: 4 });
  assert.equal(room.seats[4], null);
  assert.deepEqual(room.game.units, beforeRemoval);
  await act(host, "add_ai", { seat: 4 });
  assert.equal(room.seats[4].bot, true);
  assert.equal(room.turnDone[2], false);
  assert(room.seats.every((player, seat) => player || !room.activeSeats[seat]));
  assert.deepEqual(
    room.game.units.map((unit) => [unit.id, unit.actionPoints]),
    ap,
  );
  room.turnDone[2] = true;
  await act(host, "switch_seat", { seat: null });
  await act(host, "switch_seat", { seat: 2 });
  assert.equal(
    room.turnDone[2],
    true,
    "spectating and returning must retain an already-ended seat turn",
  );
  await assert.rejects(act(host, "switch_seat", { seat: 1 }), /已有玩家/);
  await act(host, "switch_seat", { seat: 3 });
  assert.equal(room.seats[3].characterFaction, "ZEON");
  assert.equal(frames.get(host).you.campaignTeam, 1);
  assert.equal(frames.get(host).viewTeam, 1);
  assert.deepEqual(
    room.game.units.map((unit) => [unit.id, unit.actionPoints]),
    ap,
  );
  // Objectives run through the same authenticated WebSocket action path.
  await act(host, "switch_seat", { seat: 0 });
  const actor = room.game.units.find((unit) => unit.campaignId === ally.id);
  const point = room.game.campaignBattlefield.layout.nodes.find((node) => node.kind === "outpost");
  actor.x = point.x;
  actor.y = point.y;
  actor.actionPoints = 10;
  actor.acted = false;
  // Authenticated capture is tested on an undefended post, independent of map generation.
  for (const [index, enemy] of room.game.units.filter(unit => unit.team !== actor.team).entries()) {
    enemy.x = 2 + index * 3;
    enemy.y = G.mapHeight(room.game) - 4;
  }
  room.game.campaignBattlefield.owners[point.id] = 1;
  room.game.campaignBattlefield.version++;
  await assert.rejects(
    act(other, "capture_point", { unitId: actor.id }),
    /当前不是你的回合|不能操作/,
  );
  actor.flying = true;
  await assert.rejects(act(host, "capture_point", { unitId: actor.id }), /空中单位不可|无法占领/);
  actor.flying = false;
  await act(host, "capture_point", { unitId: actor.id, id: "capture-once" });
  await act(host, "capture_point", { unitId: actor.id, id: "capture-once" });
  assert.equal(actor.actionPoints, 5);
  assert.equal(room.game.campaignBattlefield.owners[point.id], 0);
  const gate = room.game.campaignBattlefield.layout.gates.find(
    (gate) => room.campaign.regions.find((r) => r.id === gate.region).owner === 0,
  );
  actor.x = gate.x;
  actor.y = gate.y;
  await act(host, "region_transfer", {
    unitId: actor.id,
    region: gate.region,
    id: "transfer-once",
  });
  await act(host, "region_transfer", {
    unitId: actor.id,
    region: gate.region,
    id: "transfer-once",
  });
  assert(!room.game.units.includes(actor));
  assert.equal(ally.destroyed, false);
  assert.equal(ally.pendingTransfer.to, gate.region);
  assert.equal(ally.region, "canada_east");
  await act(host, "campaign_export");
  const exported = frames.get(host).save;
  assert.equal(exported.units.find((unit) => unit.id === ally.id).destroyed, false);
  assert.equal(exported.units.find((unit) => unit.id === ally.id).pendingTransfer.to, gate.region);
  const attacker = room.game.units.find((unit) => unit.campaignId === enemy.id);
  const base = room.game.campaignBattlefield.layout.nodes.find((node) => node.kind === "base");
  room.game.team = 1;
  room.turnDone[1] = false;
  attacker.x = base.x;
  attacker.y = base.y;
  attacker.actionPoints = 10;
  attacker.acted = false;
  const defender=room.game.units.find(unit=>unit.team===0);
  defender.x=base.x+1;defender.y=base.y;
  await assert.rejects(act(other,"capture_point",{unitId:attacker.id}),/据点内没有敌军/);
  defender.x=base.x+5;defender.y=base.y+5;
  const positions = room.game.units.map((unit) => [unit.id, unit.x, unit.y, unit.hp, unit.en]);
  const treasury = structuredClone(room.campaign.teams);
  await act(other, "capture_point", { unitId: attacker.id });
  assert.equal(room.returnCountdown.destination, "campaign");
  const until = Date.now() + 2000;
  while (room.started && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(room.started, false);
  assert.deepEqual(room.campaign.teams, treasury, "base victory grants no tactical resources or technology");
  assert.equal(room.campaign.regions.find((region) => region.id === "canada_east").owner, 1);
  const continuing = room.campaign.encounters.find((item) => item.region === "canada_east");
  assert(continuing && continuing.battleSave);
  assert.deepEqual(
    continuing.battleSave.game.units.map((unit) => [unit.id, unit.x, unit.y, unit.hp, unit.en]),
    positions,
  );
  assert.equal(ally.region, gate.region);
  assert.equal(ally.pendingTransfer, undefined);
  assert.equal(ally.destroyed, false);
});
