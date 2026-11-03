const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocket, WebSocketServer } = require("ws");
const G = require("../shared/rules.js");
const { createRoomEngine } = require("../shared/room-engine.js");

for (const initialHp of [100000])
  test(`real WebSocket mortar skill locks ordinary attacks and waits for all playback (HP ${initialHp})`, async (t) => {
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
      Object.assign(unit, {
        x: 5 + i,
        y: 5,
        hp: initialHp,
        en: 10000,
        shield: 0,
        actionPoints: 10,
      }),
    );
    engine.join(second, {
      mode: "join",
      room: "REVIEW",
      name: "observer",
      characterFaction: "PMC",
    });
    const [a, b] = room.game.units;
    const mortarModel=Object.keys(G.models).find(id=>G.models[id].prefabId==="RX_77_2"&&G.models[id].weapons.some(w=>w.category==="mortar"));
    a.model=mortarModel;b.x=8;
    const mortar=G.modelOf(a).weapons.find(w=>w.category==="mortar");
    await act(host,"attack",{unitId:a.id,targetId:b.id,weaponId:mortar.id,weaponIds:[mortar.id],single:true});
    assert.equal(a.attackSkillRound,room.game.round);
    await assert.rejects(act(host,"cancel_attack",{unitId:a.id,single:true}),/不能取消/);
    await assert.rejects(act(host,"attack",{unitId:a.id,targetId:b.id,weaponId:G.modelOf(a).weapons.find(w=>w.slot!=="skill").id}),/攻击类技能/);
    assert.equal(a.actionPoints, 10);
    const canonical = [mortar.id];
    assert.deepEqual(room.plans[0].weapons, canonical);
    const before = JSON.stringify([room.plans, a.actionPoints, a.en]);
    await assert.rejects(
      act(host, "attack", {
        unitId: a.id,
        targetId: b.id,
        weaponId:mortar.id,
        manualPlans: [{ unitId: a.id, weapons: [canonical[0]] }],
      }),
      /不支持/,
    );
    assert.equal(JSON.stringify([room.plans, a.actionPoints, a.en]), before);
    await act(host, "end_turn");
    assert.equal(room.phase, "reaction");
    const reactionId = room.pending.id,
      revision = room.revision;
    const fields = {
      id: "counter-once",
      reactionId,
      response: "defend",
      counterOrders: [{ targetId: a.id, weaponIds: [] }],
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
    assert(!room.combatBatch.some(battle=>battle.events[0].from===b.id));
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
