const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws");
const G = require("../shared/rules.js");
const { createRoomEngine } = require("../shared/room-engine.js");

for (const initialHp of [100000])
  test(`real WebSocket squad commands are atomic, deduplicated and wait for all playback (HP ${initialHp})`, async (t) => {
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
        try {
          engine.action(socket, msg);
          socket.send(JSON.stringify({ testAck: msg.id }));
        } catch (error) {
          socket.send(JSON.stringify({ testAck: msg.id, error: error.message }));
        }
      });
    });
    const engine = createRoomEngine({
      rules: G,
      randomId: () => "id-" + ++sequence,
      randomToken: () => "token-" + ++sequence,
      randomSeed: () => 1,
      send: (ws, message) => frames.push({ ws, message }),
    });
    t.after(() => engine.close());
    async function connect() {
      const client = new WebSocket("ws://127.0.0.1:" + wire.address().port);
      await new Promise((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      const socket = serverSockets.at(-1);
      clients.set(socket, client);
      return socket;
    }
    t.after(async () => {
      for (const client of clients.values()) client.terminate();
      for (const socket of serverSockets) socket.terminate();
      await new Promise((resolve) => wire.close(resolve));
    });
    const host = await connect(),
      first = await connect(),
      second = await connect();
    engine.join(host, {
      mode: "create",
      room: "REVIEW",
      name: "attacker",
      characterFaction: "PMC",
    });
    const room = engine.rooms.get("REVIEW");
    const act = (ws, action, fields = {}, revision = room.revision) =>
      new Promise((resolve, reject) => {
        const msg = {
          id: "request-" + ++sequence,
          revision,
          round: room.game.round,
          matchId: room.matchId,
          action,
          ...fields,
        };
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

    engine.join(first, { mode: "join", room: "REVIEW", name: "defender", characterFaction: "PMC" });
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    room.game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    room.game.tiles.forEach((row) => row.fill("plain"));
    room.started = true;
    room.matchId = "crossfire-network";
    room.phase = "idle";
    room.activeSeats = [true, true];
    room.turnDone = [false, false];
    room.turnNotBefore = 0;
    room.plans = [];
    room.responses = [];
    room.reactions = [];
    room.pending = null;
    room.game.units.forEach((unit, i) =>
      Object.assign(unit, { x: 5 + i, y: 5, hp: initialHp, en: 10000, shield: 0, actionPoints: 0 }),
    );
    engine.join(second, {
      mode: "join",
      room: "REVIEW",
      name: "observer",
      characterFaction: "PMC",
    });
    const [a, b] = room.game.units;
    const left = [a, ...[1, 2].map((i) => ({ ...structuredClone(a), id: "left-" + i }))];
    const right = [b, ...[1, 2].map((i) => ({ ...structuredClone(b), id: "right-" + i }))];
    for (const [units, squadId] of [
      [left, "left"],
      [right, "right"],
    ])
      units.forEach((unit, index) => Object.assign(unit, { squadId, squadSlot: index }));
    room.game.units.push(...left.slice(1), ...right.slice(1));
    // Adjacent squad embark is one authoritative, replay-safe action.
    const previousUnits = room.game.units;
    const boarding = left.map((u) => ({ ...structuredClone(u), x: 5, y: 10 }));
    const carrier = { ...structuredClone(a), id: "network-carrier", x: 6, y: 10,
      model: Object.keys(G.models).find((id) => id.startsWith("PegasusClass__")) };
    delete carrier.squadId; delete carrier.squadSlot;
    room.game.units = [...boarding, carrier, b];
    const slot = G.hangars.of(carrier)[0].id;
    await assert.rejects(act(first, "embark", { unitId: a.id, carrierId: carrier.id, hangarId: slot }));
    const boardRevision = room.revision;
    const boardFields = { id: "board-once", unitId: a.id, carrierId: carrier.id, hangarId: slot };
    await act(host, "embark", boardFields, boardRevision);
    await act(host, "embark", boardFields, boardRevision);
    assert.equal(G.hangars.cargo(room.game, carrier).length, 3);
    assert.ok(boarding.every((u) => u.acted && !u.squadId));
    boarding.forEach(u => {u.acted=false;u.moved=false;u.embarked.boardRound=null;u.actionPoints=10;});
    const lead = boarding[1], launchIds = [lead.id,boarding[0].id,boarding[2].id];
    const point = G.hangars.launchCells(room.game,lead)[0];
    await assert.rejects(act(first,"launch",{unitId:lead.id,unitIds:launchIds,x:point.x,y:point.y}));
    await act(host,"launch",{unitId:lead.id,unitIds:launchIds,x:point.x,y:point.y});
    assert.ok(boarding.every(u => u.embarked && u.pendingMove));
    await assert.rejects(act(host,"confirm_move",{unitId:boarding[0].id}));
    await act(host,"cancel_move",{unitId:lead.id});
    assert.ok(boarding.every(u => u.embarked && !u.pendingMove));
    await act(host,"launch",{unitId:lead.id,unitIds:launchIds,x:point.x,y:point.y});
    const launchRevision = room.revision;
    const launchConfirm = {id:"launch-confirm-once",unitId:lead.id};
    await act(host,"confirm_move",launchConfirm,launchRevision);
    await act(host,"confirm_move",launchConfirm,launchRevision);
    // AP is reference data only; a confirmed launch must not spend it.
    assert.ok(boarding.every(u => !u.embarked && !u.pendingMove && u.actionPoints===10));
    assert.equal(G.squadMembers(room.game,lead).length,3);
    room.game.units = previousUnits;
    await assert.rejects(act(first, "move", { unitId: a.id, x: 5, y: 6 }));
    await act(host, "move", { unitId: a.id, x: 5, y: 6 });
    assert.ok(left.every((unit) => unit.x === 5 && unit.y === 5));
    await act(host, "cancel_move", { unitId: a.id });
    assert.ok(left.every((unit) => !unit.pendingMove && !unit.moved));
    await act(host, "move", { unitId: a.id, x: 5, y: 6 });
    const moveRevision = room.revision;
    await act(host, "confirm_move", { id: "squad-confirm", unitId: a.id }, moveRevision);
    await act(host, "confirm_move", { id: "squad-confirm", unitId: a.id }, moveRevision);
    assert.ok(left.every((unit) => unit.x === 5 && unit.y === 6 && unit.moved));
    await act(host, "attack", { unitId: left[1].id, targetId: b.id, single: true });
    assert.equal(room.plans.length, 1);
    assert.equal(room.plans[0].attacker, left[1].id);
    assert.equal(left[0].acted, false);
    assert.equal(left[2].acted, false);
    await act(host, "cancel_attack", { unitId: left[1].id, single: true });
    assert.equal(room.plans.length, 0);
    assert.ok(left.every((unit) => !unit.acted));
    await act(host, "attack", { unitId: a.id, targetId: b.id });
    assert.equal(a.actionPoints, 0);
    assert.equal(room.plans.length, 3);
    const canonical = G.automaticQueue(room.game, a, b).map((w) => w.id);
    assert.deepEqual(room.plans[0].weapons, canonical);
    const secondAttack = left.map((u, i) => ({ ...structuredClone(u), id: "second-group-" + i,
      squadId: "second-group", x: 6, y: 4, moved: false, acted: false, plan: undefined }));
    room.game.units.push(...secondAttack);
    await act(host, "attack", { unitId: secondAttack[0].id, targetId: right[1].id });
    await act(host, "end_turn");
    assert.equal(room.phase, "reaction");
    assert.ok(G.counterTargetEntries(room.game, room.pending).some((entry) => entry.attacker === secondAttack[0].id));
    const reactionId = room.pending.id,
      revision = room.revision;
    const fields = {
      id: "counter-once",
      reactionId,
      response: "counter",
      counterTargetId: secondAttack[0].id,
      squadResponses: [{ unitId: right[2].id, response: "defend" }],
    };
    await act(first, "respond", fields, revision);
    assert.equal(room.phase, "playback");
    const after = JSON.stringify(room.game.units.map((u) => [u.hp, u.en]));
    await act(first, "respond", fields, revision);
    assert.equal(JSON.stringify(room.game.units.map((u) => [u.hp, u.en])), after);
    assert(
      room.combatBatch.every((b) => b.crossfire && b.events.every((e) => e.shotTimings?.length)),
    );
    assert(room.combatBatch.some((b) => b.events[0].from === a.id));
    if (initialHp > 1) assert(room.combatBatch.some((battle) => battle.events[0].from === b.id));
    else assert(!room.combatBatch.some((battle) => battle.events[0].from === b.id));
    assert(!room.combatBatch.some((battle) => battle.a === right[2].id));
    const exposed = frames.filter((f) => f.message.type === "state").at(-1).message;
    assert.equal(exposed.game.seed, undefined);
    assert.equal(exposed.game.units[0].token, undefined);
    const batchId = room.playback.id;
    await act(host, "playback_ready", { batchId });
    assert.equal(room.phase, "playback");
    await act(first, "playback_ready", { batchId });
    assert.equal(room.phase, "playback");
    await act(second, "playback_ready", { batchId });
    assert.notEqual(room.phase, "playback");
    if (initialHp > 1) assert.equal(room.game.team, 1);
    else assert.equal(room.game.winner, 0);
  });
