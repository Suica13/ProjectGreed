const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws"),
  { createServer } = require("../server.js"),
  G = require("../shared/rules.js");
class Client {
  constructor(url, socketOptions) {
    this.ws = new WebSocket(url, socketOptions);
    this.frames = [];
    this.listeners = new Set();
    this.state = null;
    this.joined = null;
    this.playbackAcks = new Set();
    this.autoPlayback = true;
    this.autoReturn = true;
    this.ws.on("message", (data) => {
      const m = JSON.parse(data);
      this.frames.push(m);
      if (m.type === "state") this.state = m;
      if (m.type === "joined") this.joined = m;
      // 此协议夹具模拟已完成渲染的客户端；屏障等待本身由专门的多人测试覆盖。
      if (
        m.type === "state" &&
        m.phase === "playback" &&
        this.autoPlayback &&
        m.playback.members.includes(this.joined?.memberId) &&
        !this.playbackAcks.has(m.playback.id)
      ) {
        this.playbackAcks.add(m.playback.id);
        this.send({
          type: "action",
          action: "playback_ready",
          id: randomUUID(),
          revision: m.revision,
          matchId: m.matchId,
          batchId: m.playback.id,
        });
      }
      for (const notify of this.listeners) notify();
    });
  }
  async open() {
    if (this.ws.readyState !== 1)
      await new Promise((r, j) => {
        this.ws.once("open", r);
        this.ws.once("error", j);
      });
    return this;
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  wait(pred, from = 0, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const run = () => {
        const m = this.frames.slice(from).find(pred);
        if (m) {
          clearTimeout(timer);
          this.listeners.delete(run);
          resolve(m);
        }
      };
      let timer = setTimeout(() => {
        this.listeners.delete(run);
        reject(Error("message timeout; last=" + JSON.stringify(this.frames.at(-1))));
      }, timeoutMs);
      this.listeners.add(run);
      run();
    });
  }
  async hello(mode, room, token, name) {
    let from = this.frames.length;
    this.send({
      type: "hello",
      version: require("../project.json").version,
      characterFaction: "PMC",
      mode,
      room,
      token,
      name,
    });
    let joined = await this.wait((m) => m.type === "joined" || m.type === "error", from);
    if (joined.type === "joined") await this.wait((m) => m.type === "state", from);
    return joined;
  }
  async act(action, fields = {}, override = {}) {
    if (action === "set_ready" && fields.ready && !fields.formation)
      fields = {
        ...fields,
        formation: Array.from({ length: 3 }, () => ({
          unitId: "RGM_79",
          kitId: this.joined.seat === 0 ? "beam_spray" : "bazooka",
        })),
      };
    await new Promise((r) => setTimeout(r, 22));
    let id = randomUUID(),
      from = this.frames.length;
    this.send({
      type: "action",
      action,
      id,
      revision: this.state.revision,
      round: this.state.game.round,
      matchId: this.state.matchId,
      reactionId: this.state.pending?.id,
      ...fields,
      ...override,
    });
    const result = await this.wait(
      (m) =>
        ((m.type === "state" ||
          m.type === "chat" ||
          m.type === "battle_log" ||
          m.type === "record_reply") &&
          m.ack === (override.id || id)) ||
        (m.type === "error" && m.id === (override.id || id)),
      from,
    );
    if (
      this.autoReturn &&
      action === "return_room" &&
      result.type === "state" &&
      result.returnCountdown
    )
      return this.latest((state) => !state.started);
    if (this.autoPlayback && result.type === "state" && result.phase === "playback")
      return this.latest((state) => state.phase !== "playback");
    return result;
  }
  async latest(pred) {
    if (this.state && pred(this.state)) return this.state;
    return this.wait((m) => m.type === "state" && pred(m), this.frames.length);
  }
  close() {
    this.ws.terminate();
  }
}

test("room handshake rejects missing or different versions before create, join and resume", async () => {
  const app = createServer({ port: 0, host: "127.0.0.1" });
  const address = await app.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const host = await new Client(url).open(),
    guest = await new Client(url).open();
  const version = require("../project.json").version;
  try {
    assert.equal((await host.hello("create", "VERSION")).type, "joined");
    const room = app.rooms.get("VERSION");
    for (const clientVersion of [undefined, "V12", "V999", null]) {
      for (const mode of ["create", "join", "resume"]) {
        const from = guest.frames.length;
        guest.send({
          type: "hello",
          version: clientVersion,
          mode,
          room: mode === "create" ? "OLDCLIENT" : "VERSION",
          token: host.joined.token,
        });
        const reply = await guest.wait((m) => m.type === "error" || m.type === "joined", from);
        assert.equal(reply.type, "error");
        assert.equal(reply.code, "VERSION_MISMATCH");
        assert.equal(reply.serverVersion, version);
        assert.match(reply.message, /版本不匹配/);
        assert.equal(app.rooms.size, 1);
        assert.equal(room.members.size, 1);
        assert.equal(room.seats[0].token, host.joined.token);
      }
    }
    assert.equal((await guest.hello("join", "VERSION")).type, "joined");
    assert.equal(room.members.size, 2);
  } finally {
    host.close();
    guest.close();
    await app.close();
  }
});

test("public lobby lists safe room summaries and tracks joins, disconnects and explicit exits", async () => {
  const app = createServer({ port: 0, host: "127.0.0.1", reconnectGraceMs: 40 });
  const address = await app.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const lobby = await new Client(url).open(),
    host = await new Client(url).open(),
    guest = await new Client(url).open();
  try {
    lobby.send({ type: "list_rooms" });
    assert.deepEqual((await lobby.wait((m) => m.type === "rooms")).rooms, []);
    let from = lobby.frames.length;
    await host.hello("create", "LOBBY");
    let list = (await lobby.wait((m) => m.type === "rooms" && m.rooms.length === 1, from)).rooms;
    assert.deepEqual(list[0], {
      code: "LOBBY",
      players: 1,
      capacity: 2,
      mapId: "frontier_1v1",
      costLimit: 4500,
      unitLimit: 6,
      spectators: 0,
      started: false,
      phase: "waiting",
      joinable: true,
    });
    assert.doesNotMatch(JSON.stringify(list), /token|seed|game|units|requests/);
    lobby.send({ type: "leave" });
    assert.equal(app.rooms.has("LOBBY"), true);
    from = lobby.frames.length;
    await guest.hello("join", "LOBBY");
    list = (await lobby.wait((m) => m.type === "rooms" && m.rooms[0]?.players === 2, from)).rooms;
    assert.equal(list[0].joinable, true);
    await readyMatch(host, guest, app);
    await lobby.wait((m) => m.type === "rooms" && m.rooms[0]?.phase === "playing", from);
    from = lobby.frames.length;
    guest.ws.close();
    list = (await lobby.wait((m) => m.type === "rooms" && m.rooms[0]?.players === 1, from)).rooms;
    assert.equal(list[0].phase, "disconnected");
    assert.equal(list[0].joinable, true);
    from = lobby.frames.length;
    host.send({ type: "leave" });
    await host.wait((m) => m.type === "room_closed");
    await lobby.wait((m) => m.type === "rooms" && m.rooms.length === 0, from);
    const resumed = await new Client(url).open();
    try {
      assert.equal((await resumed.hello("resume", "LOBBY", guest.joined.token)).type, "error");
    } finally {
      resumed.ws.close();
    }
    assert.equal(app.rooms.size, 0);
  } finally {
    lobby.ws.close();
    host.ws.close();
    guest.ws.close();
    await app.close();
  }
});
async function setup(t, options = {}) {
  let app = createServer({ port: 0, host: "127.0.0.1", roomReturnMs: 40, ...options }),
    address = await app.listen(),
    url = "ws://127.0.0.1:" + address.port + "/ws",
    clients = [];
  app.testClients = clients;
  t.after(async () => {
    clients.forEach((c) => c.close());
    await app.close();
  });
  const client = async (socketOptions) => {
    let c = new Client(url, socketOptions);
    c.app = app;
    clients.push(c);
    await c.open();
    return c;
  };
  return { app, client, port: address.port };
}
async function finishPlans(player) {
  const room = player.app.rooms.get(player.joined.room),
    team = room.game.team;
  for (const member of room.seats.filter(
    (member) =>
      member && !member.bot && G.seatTeam(member.seat) === team && !room.turnDone[member.seat],
  )) {
    const client = player.app.testClients.findLast(
      (client) => client.ws.readyState === 1 && client.joined?.memberId === member.id,
    );
    await client.latest((state) => state.revision >= room.revision);
    assert.equal((await client.act("end_turn")).type, "state");
  }
}
function stageCombat(app, code) {
  const game = app.rooms.get(code).game;
  for (const unit of game.units) {
    unit.x = unit.team ? 8 : 2;
    unit.y = 4 - Number(unit.id.split("-")[1]);
    game.tiles[unit.y][unit.x] = "plain";
  }
}
async function startRoom(host) {
  const room = host.app.rooms.get(host.joined.room);
  await host.latest((state) => state.revision === room.revision);
  assert.equal((await host.act("start_game")).type, "state");
}
async function confirmAssembly(...players) {
  const room = players[0].app.rooms.get(players[0].joined.room);
  if (!room.started) {
    const host = [...players, ...(players[0].app.testClients || [])].findLast(
      (player) => player.joined?.memberId === room.hostId && player.ws.readyState === 1,
    );
    assert.ok(host, "the room host explicitly starts before final assembly");
    await startRoom(host);
  }
  for (const player of players) {
    const room = player.app.rooms.get(player.joined.room);
    await player.latest((state) => state.phase === "assembly" && state.revision === room.revision);
    assert.equal((await player.act("confirm_formation")).type, "state");
  }
  for (const player of players) await player.latest((state) => state.phase !== "assembly");
}
async function readyMatch(first, second, app = first.app, stage = true, squad = {}) {
  first.app = second.app = app;
  await first.latest((s) => s.members.filter((member) => member.seat !== null).length === 2);
  const ready = await first.act("set_ready", { ready: true, ...squad });
  assert.equal(ready.type, "state");
  await second.latest((s) => s.revision >= ready.revision);
  assert.equal((await second.act("set_ready", { ready: true, ...squad })).type, "state");
  await confirmAssembly(first, second);
  await first.latest((s) => s.started);
  const placed = await first.act("deploy", { unitId: "0-0", x: 2, y: 8 });
  await second.latest((s) => s.revision === placed.revision);
  const d0 = await first.act("confirm_deployment");
  await second.latest((s) => s.revision === d0.revision);
  const d1 = await second.act("confirm_deployment");
  await first.latest((s) => s.revision === d1.revision);
  if (stage) stageCombat(app, first.joined.room);
}

test("custom squads and deployment are authoritative, versioned, deduplicated and resumable", async (t) => {
  const { client, app } = await setup(t),
    blue = await client(),
    red = await client(),
    watcher = await client();
  await blue.hello("create", "SQUADS");
  await red.hello("join", "SQUADS");
  await watcher.hello("join", "SQUADS");
  await blue.latest((s) => s.members.length === 3);
  const revision = blue.state.revision;
  assert.equal((await blue.act("set_ready", { ready: true, formation: [] })).type, "error");
  assert.equal(app.rooms.get("SQUADS").revision, revision);
  const blueSquad = [
    { unitId: "RGM_79", kitId: "machine_gun", hp: 999999 },
    { unitId: "RGM_79", kitId: "beam_spray" },
  ];
  let s = await blue.act("set_ready", { ready: true, formation: blueSquad });
  await red.latest((v) => v.revision === s.revision);
  s = await red.act("set_ready", {
    ready: true,
    formation: [{ unitId: "RGM_79", kitId: "bazooka" }],
  });
  await blue.latest((v) => v.revision === s.revision);
  await watcher.latest((v) => v.revision === s.revision);
  assert.equal(s.phase, "waiting", "all ready does not auto-start");
  await startRoom(blue);
  await confirmAssembly(blue, red);
  s = red.state;
  assert.equal(s.phase, "deployment");
  const authoritativeUnits = app.rooms.get("SQUADS").game.units;
  assert.equal(authoritativeUnits.length, 3);
  assert.equal(authoritativeUnits.find((u) => u.id === "0-0").hp, G.models.RGM_79__machine_gun.hp);
  assert.equal(authoritativeUnits.find((u) => u.id === "0-0").model, "RGM_79__machine_gun");
  assert.equal((await blue.act("end_turn")).type, "error");
  assert.equal((await watcher.act("confirm_deployment")).type, "error");
  for (const fields of [
    { unitId: "1-0", x: 2, y: 4 },
    { unitId: "0-0", x: 14, y: 4 },
    {
      unitId: "0-0",
      x: authoritativeUnits.find((u) => u.id === "0-1").x,
      y: authoritativeUnits.find((u) => u.id === "0-1").y,
    },
  ])
    assert.equal((await blue.act("deploy", fields)).type, "error");
  const id = randomUUID();
  s = await blue.act("deploy", { unitId: "0-0", x: 2, y: 8 }, { id });
  assert.equal(
    (await blue.act("deploy", { unitId: "0-0", x: 2, y: 8 }, { id, revision: 0 })).revision,
    s.revision,
  );
  s = await blue.act("confirm_deployment");
  assert.deepEqual(s.game.deployment, [true, false]);
  assert.equal((await blue.act("deploy", { unitId: "0-0", x: 1, y: 4 })).type, "error");
  red.close();
  await blue.latest((v) => !v.connected[1]);
  const resumed = await client();
  await resumed.hello("resume", "SQUADS", red.joined.token);
  assert.deepEqual(resumed.state.game.deployment, [true, false]);
  assert.equal(app.rooms.get("SQUADS").game.units.find((u) => u.id === "0-0").x, 2);
  s = await resumed.act("confirm_deployment");
  assert.equal(s.phase, "idle");
  assert.ok(!("seed" in s.game));
  assert.doesNotMatch(JSON.stringify(s), /"token"/);
  // 连发仍由服务器逐发结算并应用加成与防护；重发不能再扣 EN 或 HP。
  await blue.latest((v) => v.revision === s.revision && v.connected.every(Boolean));
  app.rooms.get("SQUADS").game.seed = 1900;
  stageCombat(app, "SQUADS");
  await moveAndConfirm(blue, { unitId: "0-0", x: 5, y: 4 });
  const incoming = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "EF_90mmMG",
  });
  assert.equal(incoming.phase, "idle");
  await finishPlans(blue);
  await resumed.latest((v) => v.revision >= incoming.revision);
  const burstId = randomUUID();
  const burst = await resumed.act("respond", { response: "evade" }, { id: burstId });
  assert.equal(burst.phase, "idle");
  assert.equal(burst.combats.at(-1).events[0].shotCount, 9);
  assert.equal(burst.combats.at(-1).events[0].damagePerShot, 725);
  // 回避确保该随机种子有命中与未命中，所有逐发结果由服务端裁定。
  const event = burst.combats.at(-1).events[0];
  assert.equal(event.strikes.length, 9);
  assert.ok(event.strikes.some((s) => s.hit) && event.strikes.some((s) => !s.hit));
  assert.equal(
    event.damage,
    event.strikes.reduce((sum, s) => sum + s.damage, 0),
  );
  const attacker = app.rooms.get("SQUADS").game.units.find((u) => u.id === "0-0");
  assert.equal(attacker.en, G.models.RGM_79__machine_gun.en - 20);
  assert.equal("ammo" in attacker, false);
  const duplicate = await resumed.act(
    "respond",
    { response: "defend" },
    { id: burstId, revision: incoming.revision },
  );
  assert.deepEqual(duplicate.game, burst.game);
  assert.deepEqual(duplicate.combats.at(-1).events, burst.combats.at(-1).events);
});

test("preparation roles, spectator authority, seat revision races and reconnect identity", async (t) => {
  const { client, app } = await setup(t);
  const first = await client(),
    second = await client(),
    watcher = await client(),
    rival = await client();
  await first.hello("create", "ROLES");
  await second.hello("join", "ROLES");
  await watcher.hello("join", "ROLES");
  await rival.hello("join", "ROLES");
  await first.latest((s) => s.members.length === 4);
  await second.latest((s) => s.members.length === 4);
  await watcher.latest((s) => s.members.length === 4);
  assert.equal(first.state.started, false);
  assert.equal(watcher.joined.seat, null);
  assert.equal((await moveAndConfirm(first, { unitId: "0-0", x: 2, y: 1 })).type, "error");
  assert.equal((await watcher.act("set_ready", { ready: true })).type, "error");
  assert.equal((await watcher.act("end_turn")).type, "error");
  assert.equal((await first.act("set_ready", { ready: true })).type, "state");
  const switchId = randomUUID();
  const switched = await first.act("switch_seat", { seat: null }, { id: switchId });
  assert.equal(switched.you.seat, null);
  assert.equal(switched.members.find((member) => member.id === first.joined.memberId).ready, true);
  const revision = switched.revision;
  assert.equal(
    (await first.act("switch_seat", { seat: null }, { id: switchId, revision: 0 })).revision,
    revision,
  );
  await watcher.latest((s) => s.revision === revision);
  await rival.latest((s) => s.revision === revision);
  // 同版本争抢同一空位，只允许一个请求成功。
  const [a, b] = await Promise.all([
    watcher.act("switch_seat", { seat: 0 }),
    rival.act("switch_seat", { seat: 0 }),
  ]);
  assert.equal([a, b].filter((result) => result.type === "state").length, 1);
  assert.equal([a, b].filter((result) => result.type === "error").length, 1);
  const controller = a.type === "state" ? watcher : rival;
  await second.latest((s) => s.revision === app.rooms.get("ROLES").revision);
  await readyMatch(controller, second);
  const observer = await client();
  const restored = await observer.hello("resume", "ROLES", first.joined.token);
  assert.equal(restored.memberId, first.joined.memberId);
  assert.equal(restored.seat, null);
  assert.equal((await observer.act("end_turn")).type, "error");
  assert.ok(
    observer.state.members.every((member) => !("token" in member) && !("requests" in member)),
  );
  assert.ok(!("seed" in observer.state.game));
  assert.equal((await observer.act("switch_seat", { seat: 1 })).type, "error");
});

test("spectators can replace a vacated defending seat; playback never gates the next team", async (t) => {
  const { client } = await setup(t),
    blue = await client(),
    red = await client(),
    watch = await client();
  await blue.hello("create", "REPLACE");
  await red.hello("join", "REPLACE");
  await watch.hello("join", "REPLACE");
  await readyMatch(blue, red);
  await moveAndConfirm(blue, { unitId: "0-0", x: 5, y: 4 });
  await blue.act("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_BeamSprayGun" });
  await finishPlans(blue);
  await red.latest((state) => state.phase === "reaction");
  await red.act("switch_seat", { seat: null });
  await watch.act("switch_seat", { seat: 1 });
  const done = await watch.act("respond", { response: "defend" });
  assert.equal(done.phase, "idle");
  assert.equal(done.game.team, 1);
  assert.equal(done.combats.length, 1);
  assert.equal((await red.act("respond", { response: "defend" })).type, "error");
  await blue.latest((state) => state.revision >= done.revision);
  assert.equal(blue.state.game.team, done.game.team);
  assert.equal(blue.state.game.round, done.game.round);
  assert.deepEqual(blue.state.game.deployment, done.game.deployment);
  assert.equal(blue.state.game.team, blue.app.rooms.get("REPLACE").game.team);
});
test("authoritative rooms, combat, duplicate protection, phases, reconnect", async (t) => {
  const { app, client, port } = await setup(t),
    blue = await client(),
    red = await client();
  assert.equal((await fetch("http://127.0.0.1:" + port + "/health")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:" + port + "/server.js")).status, 404);
  await blue.hello("create", "TEST1");
  await red.hello("join", "TEST1");
  await readyMatch(blue, red);
  // Keep this protocol fixture alive and intact so it always reaches its counterattack.
  app.rooms.get("TEST1").game.units.find((u) => u.id === "1-0").hp = 100000;
  assert.ok(!("seed" in blue.state.game));
  assert.equal((await moveAndConfirm(red, { unitId: "1-0", x: 9, y: 4 })).type, "error");
  assert.equal((await moveAndConfirm(blue, { unitId: "1-0", x: 9, y: 4 })).type, "error");
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  await blue.act("cancel_move", { unitId: "0-0" });
  assert.equal(app.rooms.get("TEST1").game.units[0].x, 2);
  await moveAndConfirm(blue, { unitId: "0-0", x: 5, y: 4 });
  const plan = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "EF_BeamSprayGun",
  });
  assert.equal(plan.phase, "idle");
  assert.equal(plan.game.units[0].en, G.models.RGM_79__beam_spray.en);
  assert.equal((await red.act("respond", { response: "defend" })).type, "error");
  await finishPlans(blue);
  await red.latest((state) => state.phase === "reaction");
  const seed = app.rooms.get("TEST1").game.seed;
  assert.equal(
    (await red.act("respond", { response: "counter", counterId: "EF_BeamSaber_A" })).type,
    "error",
  );
  assert.equal(app.rooms.get("TEST1").game.seed, seed);
  const id = randomUUID(),
    result = await red.act("respond", { response: "counter", counterId: "EF_HypeBazooka" }, { id });
  assert.equal(result.phase, "idle");
  assert.equal(result.game.team, 1);
  assert.equal(result.combats.at(-1).events.length, 2);
  const repeated = await red.act("respond", { response: "defend" }, { id, revision: 0 });
  assert.deepEqual(repeated.game, result.game);
  const token = red.joined.token;
  red.close();
  await blue.latest((state) => !state.connected[1]);
  assert.equal((await blue.act("wait", { unitId: "0-1" })).type, "error");
  const resumed = await client();
  await resumed.hello("resume", "TEST1", token);
  assert.equal(resumed.state.game.team, 1);
  assert.deepEqual(resumed.state.combats, result.combats);
  assert.equal((await resumed.act("wait", { unitId: "1-0" })).type, "state");
});
test("exhausted human turns wait for manual end, including after reconnect", async (t) => {
  const { client, app } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "AUTOTURN");
  await red.hello("join", "AUTOTURN");
  await readyMatch(blue, red);
  for (const unitId of ["0-0", "0-1", "0-2"]) await blue.act("wait", { unitId });
  assert.equal(G.hasActions(app.rooms.get("AUTOTURN").game, 0), false);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(blue.state.game.team, 0);
  assert.equal(blue.state.turnDone[0], false);
  assert.equal((await blue.act("end_turn")).game.team, 1);
  await red.latest((s) => s.game.team === 1);
  for (const unitId of ["1-0", "1-1", "1-2"]) await red.act("wait", { unitId });
  const token = blue.joined.token;
  blue.close();
  await red.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "AUTOTURN", token);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(app.rooms.get("AUTOTURN").game.team, 1);
  const finished = await red.act("end_turn");
  assert.equal(finished.game.team, 0);
  assert.equal(finished.game.round, 3);
});

test("two network clients can finish a complete match through the real protocol", async (t) => {
  const { client } = await setup(t),
    players = [await client(), await client()];
  await players[0].hello("create", "MATCH");
  await players[1].hello("join", "MATCH");
  await readyMatch(...players, undefined, false);
  let battles = 0,
    moves = 0;
  for (let step = 0; step < 500; step++) {
    const room = players[0].app.rooms.get("MATCH");
    for (const player of players) await player.latest((state) => state.revision >= room.revision);
    if (room.phase === "finished") {
      assert.ok(battles > 0);
      assert.ok(moves > 0);
      return;
    }
    if (room.phase === "reaction") {
      const a = room.game.units.find((u) => u.id === room.pending.attacker),
        b = room.game.units.find((u) => u.id === room.pending.target),
        w = G.modelOf(a).weapons.find((w) => w.id === room.pending.weapon);
      const choice = G.bestResponse(room.game, a, b, w);
      if (choice.response === "counter" && !room.pending.counterOptions.includes(choice.weapon))
        choice.response = "defend";
      const state = await players[G.ownerOf(b)].act("respond", {
        response: choice.response,
        counterId: choice.weapon,
      });
      assert.equal(state.type, "state");
      battles++;
      continue;
    }
    const player = players[room.game.team],
      u = room.game.units.find((u) => u.team === room.game.team && u.hp > 0 && !u.acted);
    if (!u) {
      await player.act("end_turn");
      continue;
    }
    const choice = G.aiChoice(room.game, u);
    if (choice && !u.moved && (choice.x !== u.x || choice.y !== u.y)) {
      assert.equal(
        (await moveAndConfirm(player, { unitId: u.id, x: choice.x, y: choice.y })).type,
        "state",
      );
      moves++;
    }
    let best = null;
    for (const b of room.game.units.filter((b) => b.hp > 0 && b.team !== u.team))
      for (const w of G.modelOf(u).weapons)
        if (G.canAttack(room.game, u, b, w)) {
          const score = G.estimate(room.game, u, b, w).damage * w.hit;
          if (!best || score > best.score) best = { b, w, score };
        }
    const state = best
      ? await player.act("attack", { unitId: u.id, targetId: best.b.id, weaponId: best.w.id })
      : await player.act("wait", { unitId: u.id });
    assert.equal(state.type, "state");
  }
  assert.fail("planned network match did not finish");
});
async function finishFixture(blue, red, app) {
  const room = app.rooms.get(blue.joined.room),
    g = room.game,
    a = g.units.find((u) => u.id === "0-0"),
    b = g.units.find((u) => u.id === "1-0");
  for (const u of g.units.filter((u) => u.team === 1)) u.hp = 0;
  Object.assign(a, { x: 2, y: 4, acted: false, en: 100 });
  Object.assign(b, { x: 4, y: 4, hp: 1, shield: 0 });
  g.tiles[4][2] = g.tiles[4][4] = "plain";
  g.seed = 1;
  const attack = await blue.act("attack", {
    unitId: a.id,
    targetId: b.id,
    weaponId: "EF_BeamSprayGun",
  });
  await finishPlans(blue);
  await red.latest((s) => s.revision >= attack.revision);
  return red.act("respond", { response: "defend" });
}

test("player IDs are validated before creating a room and empty rooms dissolve after reconnect grace", async (t) => {
  const { client, app } = await setup(t, { hostReconnectMs: 40, reconnectGraceMs: 40 }),
    bad = await client(),
    host = await client(),
    guest = await client(),
    lobby = await client();
  assert.equal((await bad.hello("create", "BADID", undefined, "x".repeat(25))).type, "error");
  assert.equal(app.rooms.has("BADID"), false);
  await host.hello("create", "NAMES", undefined, "Alice");
  await guest.hello("join", "NAMES", undefined, "ボブ");
  assert.equal(host.state.members.find((m) => m.id === host.joined.memberId).name, "Alice");
  assert.equal(guest.state.members.find((m) => m.id === guest.joined.memberId).name, "ボブ");
  assert.equal(guest.state.hostId, host.joined.memberId);
  lobby.send({ type: "list_rooms" });
  await lobby.wait((m) => m.type === "rooms" && m.rooms.length === 1);
  host.close();
  const transferred = await guest.latest(
    (s) => !s.connected[0] && s.hostId === guest.joined.memberId,
  );
  assert.equal(transferred.hostId, guest.joined.memberId);
  const from = lobby.frames.length;
  guest.close();
  await lobby.wait((m) => m.type === "rooms" && m.rooms.length === 0, from);
  assert.equal(app.rooms.has("NAMES"), false);
});
test("chat is available to spectators, preserves text, deduplicates requests and does not change the game revision", async (t) => {
  const { client, app } = await setup(t),
    blue = await client(),
    red = await client(),
    watch = await client();
  await blue.hello("create", "CHAT", undefined, "Alice");
  await red.hello("join", "CHAT", undefined, "Bob");
  await watch.hello("join", "CHAT", undefined, "Watcher");
  await blue.latest((s) => s.members.length === 3);
  const room = app.rooms.get("CHAT"),
    revision = room.revision,
    game = JSON.stringify(room.game),
    id = randomUUID();
  const sent = await blue.act(
    "chat",
    { message: "<img src=x onerror=alert(1)> 你好", name: "forged" },
    { id },
  );
  assert.equal(sent.type, "chat");
  assert.equal(sent.message.name, "Alice");
  assert.equal(sent.message.text, "<img src=x onerror=alert(1)> 你好");
  assert.equal(room.revision, revision);
  assert.equal(JSON.stringify(room.game), game);
  const duplicate = await blue.act("chat", { message: "different" }, { id });
  assert.deepEqual(duplicate.message, sent.message);
  assert.equal(room.chat.filter((m) => !m.system).length, 1);
  const spectator = await watch.act("chat", { message: "観戦中" });
  assert.equal(spectator.type, "chat");
  assert.equal(spectator.message.name, "Watcher");
  assert.equal(room.chat.filter((m) => !m.system).length, 2);
  assert.equal((await red.act("chat", { message: "x".repeat(301) })).type, "error");
  await readyMatch(blue, red, app);
  const activeRevision = room.revision;
  assert.equal((await red.act("chat", { message: "Ready!" })).type, "chat");
  assert.equal(room.revision, activeRevision);
});
test("finished games get a 30-second server deadline; only the host can return everyone and start a fresh match", async (t) => {
  const { client, app } = await setup(t),
    blue = await client(),
    red = await client(),
    watch = await client();
  await blue.hello("create", "RESULTS");
  await red.hello("join", "RESULTS");
  await watch.hello("join", "RESULTS");
  await readyMatch(blue, red, app);
  const finished = await finishFixture(blue, red, app),
    room = app.rooms.get("RESULTS"),
    matchId = finished.matchId;
  assert.equal(finished.phase, "finished");
  assert.ok(
    finished.returnAt - finished.serverTime >= 29900 &&
      finished.returnAt - finished.serverTime <= 30000,
  );
  await watch.latest((s) => s.phase === "finished");
  assert.equal((await red.act("return_room", { matchId })).type, "error");
  assert.equal((await watch.act("return_room", { matchId })).type, "error");
  assert.equal((await blue.act("return_room", { matchId: "wrong" })).type, "error");
  await blue.act("switch_seat", { seat: null });
  assert.equal(room.hostId, blue.joined.memberId);
  room.log.unshift("previous-match-log-marker");
  const previousLog = room.log.slice();
  const id = randomUUID(),
    returned = await blue.act("return_room", { matchId }, { id });
  assert.equal(returned.phase, "waiting");
  assert.equal(returned.started, false);
  assert.equal(returned.returnAt, null);
  assert.ok(returned.members.every((m) => !m.ready));
  assert.equal(returned.game.winner, null);
  assert.equal(returned.game.round, 1);
  assert.deepEqual(returned.log.slice(1), previousLog.slice(0, 79));
  const spectatorRoom = await watch.latest((s) => !s.started);
  assert.deepEqual(spectatorRoom.log, returned.log);
  assert.deepEqual((await red.act("sync")).log, room.teamLogs[1]);
  assert.deepEqual((await red.act("download_log", { perspective: "global" })).log, returned.log);
  const revision = room.revision;
  await blue.act("return_room", { matchId }, { id });
  assert.equal(room.revision, revision);
  assert.equal(room.members.get(blue.joined.memberId).token, blue.joined.token);
  await blue.act("switch_seat", { seat: 0 });
  await readyMatch(blue, red, app);
  assert.notEqual(room.matchId, matchId);
  assert.equal(room.phase, "idle");
  assert.ok(
    !room.log.includes("previous-match-log-marker"),
    "the next match clears the previous battle log",
  );
});
test("server countdown automatically returns all members without any client return request", async (t) => {
  const { client, app } = await setup(t, { resultReturnMs: 150 }),
    blue = await client(),
    red = await client();
  await blue.hello("create", "AUTOBACK");
  await red.hello("join", "AUTOBACK");
  await readyMatch(blue, red, app);
  const finished = await finishFixture(blue, red, app),
    started = Date.now();
  assert.equal(finished.phase, "finished");
  await blue.latest((s) => !s.started);
  await red.latest((s) => !s.started);
  assert.ok(Date.now() - started >= 100);
  assert.equal(blue.state.phase, "waiting");
  assert.equal(red.state.phase, "waiting");
  assert.equal(blue.state.returnAt, null);
  assert.ok(finished.log.every((line) => red.state.log.includes(line)));
  assert.deepEqual(red.state.log, app.rooms.get("AUTOBACK").teamLogs[1]);
  assert.deepEqual(blue.state.log, app.rooms.get("AUTOBACK").teamLogs[0]);
  assert.deepEqual(
    (await blue.act("download_log", { perspective: "global" })).log,
    app.rooms.get("AUTOBACK").log,
  );
});

test("confirmed movements cannot be undone; another preview cancels without changing committed positions", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "UNDO02");
  await red.hello("join", "UNDO02");
  await readyMatch(blue, red);
  const room = app.rooms.get("UNDO02"),
    [a, other] = room.game.units;
  await moveAndConfirm(blue, { unitId: a.id, x: 3, y: 4 });
  assert.equal(a.origin, null);
  await blue.act("move", { unitId: other.id, x: 2, y: 4 });
  assert.equal(other.x, 2);
  assert.equal(other.y, 3);
  assert.equal((await blue.act("undo", { unitId: a.id })).type, "error");
  assert.equal((await blue.act("move", { unitId: a.id, x: 4, y: 4 })).type, "error");
  const cancelled = await blue.act("cancel_move", { unitId: other.id });
  assert.equal(cancelled.type, "state");
  assert.deepEqual([a.x, a.y], [3, 4]);
  assert.deepEqual([other.x, other.y], [2, 3]);
  assert.equal((await blue.act("undo", { unitId: a.id })).type, "error");
});

test("focused-fire response selects exactly one counter target, survives reconnect, rejects unrelated targets and deduplicates", async (t) => {
  const { app, client } = await setup(t),
    blue = await client();
  let red = await client();
  await blue.hello("create", "COUNTER02");
  await red.hello("join", "COUNTER02");
  await readyMatch(blue, red);
  const room = app.rooms.get("COUNTER02"),
    g = room.game,
    b = g.units.find((u) => u.id === "1-0");
  for (const u of g.units) Object.assign(u, { hp: 100000, shield: 0 });
  Object.assign(b, { x: 5, y: 4, en: 1000 });
  for (let i = 0; i < 3; i++) {
    const a = g.units.find((u) => u.id === "0-" + i);
    Object.assign(a, { x: 2 + Math.abs(1 - i), y: 3 + i });
    g.tiles[a.y][a.x] = "plain";
    await blue.act("attack", { unitId: a.id, targetId: b.id, weaponId: "EF_BeamSprayGun" });
  }
  await finishPlans(blue);
  await red.latest((state) => state.phase === "reaction");
  assert.equal(red.state.pending.attacks.length, 3);
  const reactionId = room.pending.id;
  const token = red.joined.token;
  red.close();
  await blue.latest((state) => !state.connected[1]);
  red = await client();
  await red.hello("resume", "COUNTER02", token);
  assert.equal(red.state.pending.id, reactionId);
  const unchanged = JSON.stringify(room.game);
  assert.equal(
    (
      await red.act("respond", {
        response: "counter",
        counterId: "EF_HypeBazooka",
        counterTargetId: "1-1",
      })
    ).type,
    "error",
  );
  assert.equal(JSON.stringify(room.game), unchanged);
  const id = randomUUID();
  const result = await red.act(
    "respond",
    { response: "counter", counterId: "EF_HypeBazooka", counterTargetId: "0-2" },
    { id },
  );
  assert.equal(result.type, "state");
  const repeated = await red.act(
    "respond",
    { response: "counter", counterId: "EF_HypeBazooka", counterTargetId: "0-0", reactionId },
    { id },
  );
  assert.deepEqual(repeated.combats, result.combats);
  assert.equal(room.game.team, 1);
  assert.equal(room.combats.length, 3);
  assert.deepEqual(
    room.combats.map((battle) => battle.events.length),
    [1, 1, 2],
  );
  assert.equal(room.combats[2].events[1].to, "0-2");
});
async function multiRoom(t, mapId, playerCount, costLimit = 600) {
  const { app, client } = await setup(t),
    players = [];
  for (let i = 0; i < playerCount; i++) players.push(await client());
  const code = "MULTI" + playerCount;
  await players[0].hello("create", code, undefined, "Host");
  const configured = await players[0].act("configure_room", { mapId, costLimit });
  assert.equal(configured.type, "state");
  for (let i = 1; i < playerCount; i++)
    await players[i].hello("join", code, undefined, "Player" + i);
  const room = app.rooms.get(code);
  for (const p of players) await p.latest((s) => s.revision === room.revision);
  return { app, client, players, room, code };
}
async function startMulti(players, room, formation = [{ unitId: "RGM_79", kitId: "machine_gun" }]) {
  for (const p of players) {
    await p.latest((s) => s.revision === room.revision);
    assert.equal((await p.act("set_ready", { ready: true, formation })).type, "state");
  }
  await confirmAssembly(...players);
  assert.equal(room.phase, "deployment");
  for (const p of players) {
    await p.latest((s) => s.revision === room.revision);
    assert.equal((await p.act("confirm_deployment")).type, "state");
  }
  assert.equal(room.phase, "idle");
  for (const p of players) await p.latest((s) => s.revision === room.revision);
}
test("host map and budget settings validate atomically, reset readiness, resize seats and preserve spectators and chat", async (t) => {
  const { players, room } = await multiRoom(t, "frontline_3v3", 6),
    [host, guest] = players;
  assert.equal((await host.act("chat", { message: "Settings chat" })).type, "chat");
  const before = JSON.stringify(room.settings),
    revision = room.revision;
  assert.equal(
    (await guest.act("configure_room", { mapId: "frontier_1v1", costLimit: 600 })).type,
    "error",
  );
  for (const bad of [
    { mapId: "unknown", costLimit: 600 },
    { mapId: "__proto__", costLimit: 600 },
    { mapId: "crossroads_2v2", costLimit: -1 },
    { mapId: "frontier_1v1", costLimit: 100000 },
  ])
    assert.equal((await host.act("configure_room", bad)).type, "error");
  assert.equal(JSON.stringify(room.settings), before);
  assert.equal(room.revision, revision);
  assert.equal(
    (
      await host.act("set_ready", {
        ready: true,
        formation: Array(3).fill({ unitId: "RGM_79", kitId: "machine_gun" }),
      })
    ).type,
    "state",
  );
  assert.equal(
    (
      await host.act("set_ready", {
        ready: true,
        formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
      })
    ).type,
    "state",
  );
  const id = randomUUID(),
    changed = await host.act(
      "configure_room",
      { mapId: "crossroads_2v2", costLimit: 1200 },
      { id },
    );
  assert.equal(changed.connected.length, 4);
  assert.ok(changed.members.every((member) => !member.ready));
  assert.equal(changed.members.filter((member) => member.seat === null).length, 2);
  assert.equal(
    changed.chat.find((message) => message.text === "Settings chat")?.text,
    "Settings chat",
  );
  const duplicate = await host.act(
    "configure_room",
    { mapId: "frontier_1v1", costLimit: 300 },
    { id, revision: 0 },
  );
  assert.equal(duplicate.revision, changed.revision);
  assert.equal(room.settings.mapId, "crossroads_2v2");
  assert.equal(
    (await host.act("configure_room", { mapId: "frontier_1v1", costLimit: 300 }, { revision: 0 }))
      .code,
    "STALE",
  );
  // A different room keeps its own budget.
  const other = await (await setup(t)).client();
  await other.hello("create", "ISOLATE");
  assert.equal(other.state.settings.costLimit, 4500);
});
test("2v2 restricts allies to their own units and responses, shares turns, reconnects and returns to the same configured room", async (t) => {
  const { players, room, client, code } = await multiRoom(t, "crossroads_2v2", 4, 600);
  await startMulti(players, room);
  assert.equal((await players[0].act("wait", { unitId: "2-0" })).type, "error");
  const a = room.game.units.find((u) => u.id === "0-0"),
    b = room.game.units.find((u) => u.id === "3-0");
  Object.assign(a, { x: 2, y: 4, hp: 100000 });
  Object.assign(b, { x: 4, y: 4, hp: 100000, shield: 0 });
  room.game.tiles[4][2] = room.game.tiles[4][4] = "plain";
  await players[0].act("attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  await players[0].act("end_turn");
  assert.equal(room.phase, "idle");
  await players[2].act("end_turn");
  assert.equal((await players[1].act("respond", { response: "defend" })).type, "error");
  const battle = await players[3].act("respond", { response: "defend" });
  assert.equal(battle.game.team, 1);
  assert.equal(battle.combats.length, 1);
  const token = players[3].joined.token;
  players[3].close();
  await players[0].latest((state) => !state.connected[3]);
  const resumed = await client();
  await resumed.hello("resume", code, token);
  players[3] = resumed;
  assert.equal(resumed.state.you.seat, 3);
  for (const player of players) await player.latest((state) => state.revision >= room.revision);
  await players[1].act("end_turn");
  assert.equal(room.game.team, 1);
  await players[3].act("end_turn");
  assert.equal(room.game.team, 0);
  const settings = structuredClone(room.settings);
  await players[0].act("return_room", { matchId: room.matchId });
  assert.deepEqual(room.settings, settings);
  await startMulti(players, room);
});
test("3v3 prepares and independently deploys all six full formations", async (t) => {
  const { players, room } = await multiRoom(t, "frontline_3v3", 6, 7200);
  await startMulti(players, room, Array(6).fill({ unitId: "RGM_79", kitId: "machine_gun" }));
  assert.equal(room.game.units.length, 36);
  assert.equal(new Set(room.game.units.map((u) => u.x + "," + u.y)).size, 36);
  assert.equal(room.game.tiles.length, 54);
  const controller = players[4],
    own = room.game.units.find((u) => G.ownerOf(u) === 4 && G.reachable(room.game, u).size > 1),
    destination = [...G.reachable(room.game, own).values()].find((cell) => cell.path.length > 0);
  assert.ok(destination);
  const moved = await moveAndConfirm(controller, {
    unitId: own.id,
    x: destination.x,
    y: destination.y,
  });
  assert.equal(moved.type, "state");
  assert.equal(moved.game.units.find((u) => u.id === own.id).moved, true);
  await players[0].latest((s) => s.revision === room.revision);
  assert.equal((await players[0].act("undo", { unitId: own.id })).type, "error");
});

test("room AI management is host-only, versioned, preserves readiness and removes out-of-map bots", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 100000 });
  const host = await client(),
    guest = await client();
  await host.hello("create", "AICFG");
  await host.act("add_ai", { seat: 1 });
  await guest.hello("join", "AICFG");
  await host.latest((s) => s.members.length === 3);
  assert.equal(guest.joined.seat, null);
  assert.equal((await guest.act("remove_ai", { seat: 1 })).type, "error");
  const before = app.rooms.get("AICFG").revision;
  for (const seat of [-1, 2, null, "1"])
    assert.equal((await host.act("add_ai", { seat })).type, "error");
  assert.equal((await host.act("add_ai", { seat: 0 })).type, "error");
  assert.equal((await host.act("remove_ai", { seat: 0 })).type, "error");
  assert.equal(app.rooms.get("AICFG").revision, before);
  assert.equal((await host.act("remove_ai", { seat: 1 }, { revision: before - 1 })).code, "STALE");
  const id = randomUUID();
  const first = await host.act("remove_ai", { seat: 1 }, { id });
  assert.equal((await host.act("remove_ai", { seat: 1 }, { id })).revision, first.revision);
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 3600 });
  await host.act("set_ready", { ready: true });
  await host.act("add_ai", { seat: 3 });
  assert.equal(host.state.members.find((m) => m.id === host.joined.memberId).ready, true);
  const bot = host.state.members.find((m) => m.bot);
  assert.equal(bot.ready, true);
  assert.equal(bot.connected, true);
  assert.equal(host.state.hostId, host.joined.memberId);
  await host.act("configure_room", { mapId: "frontier_1v1", costLimit: 3600 });
  assert.equal(
    host.state.members.some((m) => m.bot),
    false,
  );
  assert.equal(app.rooms.get("AICFG").seats.length, 2);
});

test("AI prepares six random units and kits, auto deploys, responds without any playback barrier", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 20 });
  const host = await client();
  await host.hello("create", "AIFIGHT");
  await host.act("add_ai", { seat: 1 });
  await host.act("set_ready", { ready: true });
  await confirmAssembly(host);
  let room = app.rooms.get("AIFIGHT");
  assert.equal(room.phase, "deployment");
  assert.deepEqual(room.game.deployment, [false, true]);
  const bots = room.game.units.filter((u) => G.ownerOf(u) === 1);
  assert.equal(bots.length, 6);
  assert.ok(new Set(bots.map((u) => u.model)).size > 1);
  assert.ok(bots.reduce((sum, u) => sum + G.models[u.model].cost, 0) <= room.settings.costLimit);
  assert.equal((await host.act("remove_ai", { seat: 1 })).type, "error");
  await host.act("confirm_deployment");
  const a = room.game.units.find((u) => u.id === "0-0"),
    b = bots[0];
  // Keep the playback assertion independent of random EXAM/upkeep form changes.
  b.model = "RGM_79__machine_gun";
  b.shield = 0;
  Object.assign(a, { x: 5, y: 5, hp: 100000 });
  Object.assign(b, { x: 6, y: 5, hp: 100000, en: 1000 });
  room.game.tiles[5][5] = room.game.tiles[5][6] = "plain";
  const weapon = G.models[a.model].weapons.find((w) => w.type === "melee");
  const counter = G.bestResponse(room.game, a, b, weapon);
  await host.act("attack", { unitId: a.id, targetId: b.id, weaponId: weapon.id });
  await finishPlans(host);
  await host.latest((s) => s.combats.length > 0);
  assert.equal(room.battle, null);
  if (counter.response === "counter") {
    const events = room.combats.at(-1).events.filter((event) => event.from === b.id);
    assert.ok(events.length >= 1);
    assert.ok(events.every((event) => event.to === a.id));
    assert.ok(
      events.reduce(
        (sum, event) =>
          sum + G.actionCost(G.models[b.model].weapons.find((w) => w.id === event.weapon)),
        0,
      ) <= G.counterActionBudget(b),
    );
  }
  const after = room.game.units.map((u) => u.hp);
  const battleId = room.combats.at(-1).id;
  const ended = await host.act("battle_ready", { battleId });
  assert.equal(ended.phase, "idle");
  assert.deepEqual(
    room.game.units.map((u) => u.hp),
    after,
  );
  assert.equal((await host.act("battle_ready", { battleId })).type, "state");
});

test("AI takes its turn automatically and leaves the human target in control of its response", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 20 });
  const host = await client();
  await host.hello("create", "AITURN");
  await host.act("add_ai", { seat: 1 });
  await host.act("set_ready", { ready: true });
  await confirmAssembly(host);
  await host.act("confirm_deployment");
  const room = app.rooms.get("AITURN");
  for (const u of room.game.units) {
    u.x = u.team ? 8 : 3;
    u.y = Number(u.id.split("-")[1]) + 3;
    u.hp = 100000;
    room.game.tiles[u.y][u.x] = "plain";
  }
  await host.act("end_turn");
  await host.wait((m) => m.type === "state" && m.phase === "reaction", host.frames.length, 8000);
  assert.equal(G.ownerOf(room.game.units.find((u) => u.id === room.pending.target)), 0);
  assert.equal(room.lastEvent.type, "attack");
  const reply = await host.act("respond", { response: "defend" });
  assert.ok(["reaction", "idle"].includes(reply.phase));
  assert.equal(reply.combats.length, reply.phase === "reaction" ? 0 : room.combats.length);
  while (room.phase === "reaction") {
    const result = await host.act("respond", { response: "defend" });
    assert.equal(result.type, "state");
  }
  assert.ok(room.combats.length > 0);
});

test("AI-only battles progress for spectators and bots never retain rooms or become host", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 20, aiBattleMs: 20 });
  const host = await client();
  await host.hello("create", "AIWATCH");
  await host.act("switch_seat", { seat: null });
  await host.act("add_ai", { seat: 0 });
  await host.act("add_ai", { seat: 1 });
  const room = app.rooms.get("AIWATCH");
  assert.equal(room.started, false, "AI readiness never starts a room");
  await startRoom(host);
  assert.equal(room.started, true);
  assert.equal(room.phase, "assembly");
  await confirmAssembly(host);
  assert.equal(room.phase, "idle");
  assert.deepEqual(room.game.deployment, [true, true]);
  for (const u of room.game.units) {
    u.x = u.team ? 5 : 3;
    u.y = Number(u.id.split("-")[1]) + 3;
    u.hp = 100000;
    u.moved = true;
    room.game.tiles[u.y][u.x] = "plain";
  }
  await host.wait((s) => s.type === "state" && s.combats.length > 0, host.frames.length, 10000);
  assert.equal(room.battle, null);
  assert.ok(room.combats.length > 0);
  assert.equal(room.hostId, host.joined.memberId);
  host.send({ type: "leave" });
  await host.wait((m) => m.type === "room_closed");
  assert.equal(app.rooms.has("AIWATCH"), false);
});

test("budgeted AI formations respect low COST limits and remain deterministic", () => {
  for (const budget of [200, 400, 900, 3600, 99999]) {
    const formation = G.randomFormation(1234, budget);
    assert.deepEqual(G.randomFormation(1234, budget), formation);
    assert.ok(formation.length > 0 && formation.length <= G.catalog.formation.maxUnits);
    assert.ok(
      formation.reduce((sum, u) => sum + G.models[u.unitId + "__" + u.kitId].cost, 0) <= budget,
    );
  }
  assert.throws(() => G.randomFormation(1, 0));
});

test("AI allies finish only their own formation and do not end a human teammate's actions", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 20 });
  const host = await client(),
    guest = await client();
  await host.hello("create", "AIALLY");
  await guest.hello("join", "AIALLY");
  await host.latest((s) => s.members.length === 2);
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 3600 });
  await host.act("add_ai", { seat: 2 });
  await host.act("add_ai", { seat: 3 });
  await host.act("set_ready", { ready: true });
  await guest.act("set_ready", { ready: true });
  await confirmAssembly(host, guest);
  const room = app.rooms.get("AIALLY");
  for (const u of room.game.units.filter((u) => G.ownerOf(u) === 2)) u.moved = true;
  await host.act("confirm_deployment");
  await guest.act("confirm_deployment");
  await host.latest((s) => s.turnDone[2]);
  assert.equal(room.game.team, 0);
  assert.ok(room.game.units.some((u) => G.ownerOf(u) === 0 && !u.acted));
  assert.equal(room.turnDone[0], false);
  await host.act("end_turn");
  assert.equal(room.game.team, 1);
});

test("AI pauses when a human seat disconnects and host identity survives a short reconnect", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 200 });
  const host = await client(),
    watcher = await client();
  await host.hello("create", "AIPAUSE");
  await host.act("add_ai", { seat: 1 });
  await watcher.hello("join", "AIPAUSE");
  await host.latest((s) => s.members.length === 3);
  await host.act("set_ready", { ready: true });
  await confirmAssembly(host);
  await host.act("confirm_deployment");
  await host.act("end_turn");
  const room = app.rooms.get("AIPAUSE");
  host.close();
  await watcher.latest((s) => s.connected[0] === false);
  const revision = room.revision,
    positions = JSON.stringify(room.game.units);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(room.revision, revision);
  assert.equal(JSON.stringify(room.game.units), positions);
  assert.equal(room.hostId, host.joined.memberId);
  const resumed = await client();
  await resumed.hello("resume", "AIPAUSE", host.joined.token);
  assert.equal(resumed.state.connected.every(Boolean), true);
  room.turnNotBefore = 0;
  await resumed.act("sync");
  // Resume already scheduled AI respecting the original transition; wait through it.
  await watcher.wait(
    (m) => m.type === "state" && m.revision > revision + 1,
    watcher.frames.length,
    6000,
  );
});

test("host reconnect grace preserves creator privileges and rejects temporary guest configuration", async (t) => {
  const { client, app } = await setup(t, { hostReconnectMs: 1000 });
  const host = await client(),
    guest = await client();
  await host.hello("create", "HOSTGRACE", undefined, "Creator");
  await guest.hello("join", "HOSTGRACE", undefined, "Guest");
  await host.latest((s) => s.members.length === 2);
  const id = host.joined.memberId,
    token = host.joined.token;
  host.close();
  const disconnected = await guest.latest((s) => !s.connected[0]);
  assert.equal(disconnected.hostId, id);
  assert.equal(
    (await guest.act("configure_room", { mapId: "crossroads_2v2", costLimit: 4200 })).type,
    "error",
  );
  const resumed = await client();
  await resumed.hello("resume", "HOSTGRACE", token);
  assert.equal(resumed.joined.memberId, id);
  assert.equal(resumed.state.hostId, id);
  const changed = await resumed.act("configure_room", { mapId: "crossroads_2v2", costLimit: 4200 });
  assert.equal(changed.type, "state");
  assert.deepEqual(changed.settings, {
    ...G.defaultRoomSettings(),
    mapId: "crossroads_2v2",
    costLimit: 4200,
  });
  assert.equal(app.rooms.get("HOSTGRACE").hostId, id);
});

test("explicit host exit and expired reconnect transfer to the earliest online human, independent of seat and AI", async (t) => {
  const { client, app } = await setup(t, { hostReconnectMs: 80 });
  const host = await client(),
    first = await client(),
    second = await client();
  await host.hello("create", "HOSTQUEUE");
  await host.act("configure_room", { mapId: "frontline_3v3", costLimit: 3600 });
  await host.act("add_ai", { seat: 1 });
  await first.hello("join", "HOSTQUEUE");
  await second.hello("join", "HOSTQUEUE");
  await host.latest((s) => s.members.length === 4);
  await host.act("switch_seat", { seat: 4 });
  await second.act("switch_seat", { seat: 0 });
  await first.act("switch_seat", { seat: 5 });
  const room = app.rooms.get("HOSTQUEUE");
  assert.equal(room.hostId, host.joined.memberId);
  const token = first.joined.token;
  host.send({ type: "leave" });
  await host.wait((m) => m.type === "room_closed");
  await first.latest((s) => s.hostId === first.joined.memberId);
  assert.equal(room.hostId, first.joined.memberId);
  assert.equal(room.seats[0].id, second.joined.memberId);
  assert.equal(room.seats[1].bot, true);
  assert.equal(
    (await second.act("configure_room", { mapId: "frontline_3v3", costLimit: 4200 })).type,
    "error",
  );
  first.close();
  await second.latest((s) => s.hostId === second.joined.memberId);
  assert.equal(
    (await second.act("configure_room", { mapId: "frontline_3v3", costLimit: 4200 })).type,
    "state",
  );
  const late = await client();
  await late.hello("resume", "HOSTQUEUE", token);
  assert.equal(late.state.hostId, second.joined.memberId);
  assert.equal(
    (await late.act("configure_room", { mapId: "frontline_3v3", costLimit: 4300 })).type,
    "error",
  );
  assert.equal(room.hostId, second.joined.memberId);
});

test("ordinary broadcasts do not extend the host grace deadline and an old timeout cannot steal a restored host", async (t) => {
  const { client, app } = await setup(t, { hostReconnectMs: 200 });
  const host = await client(),
    guest = await client();
  await host.hello("create", "HOSTCLOCK");
  await guest.hello("join", "HOSTCLOCK");
  await host.latest((s) => s.members.length === 2);
  const token = host.joined.token,
    id = host.joined.memberId;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const start = Date.now();
  for (let i = 0; i < 3; i++) await guest.act("set_ready", { ready: false });
  await new Promise((r) => setTimeout(r, Math.max(0, start + 240 - Date.now())));
  assert.equal(app.rooms.get("HOSTCLOCK").hostId, guest.joined.memberId);
  // Restore the new host before its own grace expires; the first host cannot reclaim it.
  const watcher = await client();
  await watcher.hello("join", "HOSTCLOCK");
  const newToken = guest.joined.token,
    newId = guest.joined.memberId;
  guest.close();
  const resumed = await client();
  await resumed.hello("resume", "HOSTCLOCK", newToken);
  // The live spectator keeps the room alive while the current host briefly disconnects.
  assert.notEqual(resumed.joined?.type, "error");
  assert.equal(resumed.state.hostId, newId);
  await new Promise((r) => setTimeout(r, 240));
  assert.equal(resumed.state.hostId, newId);
});

test("team joins allocate current free spawns and reject full or invalid teams atomically", async (t) => {
  const { client } = await setup(t);
  const host = await client(),
    red = await client(),
    watcher = await client(),
    extra = await client();
  await host.hello("create", "JOINTEAM");
  await red.hello("join", "JOINTEAM");
  await watcher.hello("join", "JOINTEAM");
  await extra.hello("join", "JOINTEAM");
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 3600 });
  await watcher.latest((s) => s.settings.mapId === "crossroads_2v2");
  assert.equal((await watcher.act("join_team", { team: 0 })).you.seat, 2);
  assert.equal((await watcher.act("join_team", { team: 1 })).you.seat, 3);
  assert.equal((await watcher.act("join_team", { team: 1 })).you.seat, 3);
  await extra.latest((s) => s.members.find((m) => m.id === watcher.joined.memberId)?.seat === 3);
  await extra.act("sync");
  const revision = extra.state.revision;
  assert.equal((await extra.act("join_team", { team: 1 })).type, "error");
  for (const team of [-1, 2, "0", null])
    assert.equal((await extra.act("join_team", { team })).type, "error");
  assert.equal(extra.state.revision, revision);
  assert.equal((await extra.act("join_team", { team: 0 })).you.seat, 2);
});

test("chat channels filter live delivery, snapshots, role changes, cached retries and reconnects", async (t) => {
  const { app, client } = await setup(t);
  const host = await client(),
    red = await client(),
    ally = await client(),
    observer = await client();
  await host.hello("create", "CHANNELS");
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 3600 });
  await red.hello("join", "CHANNELS");
  await ally.hello("join", "CHANNELS");
  await observer.hello("join", "CHANNELS");
  await observer.act("switch_seat", { seat: null });
  const room = app.rooms.get("CHANNELS");
  async function say(c, channel, message, override = {}) {
    room.members.get(c.joined.memberId).chatAt = 0;
    return c.act("chat", { channel, message }, override);
  }
  const retryId = randomUUID();
  assert.equal((await say(ally, "team1", "green secret", { id: retryId })).type, "chat");
  assert.equal((await say(red, "team2", "red secret")).type, "chat");
  assert.equal((await say(observer, "spectators", "observer secret")).type, "chat");
  assert.equal((await say(host, "all", "public message")).type, "chat");
  const revision = room.revision,
    length = room.chat.length;
  for (const [c, channel] of [
    [host, "team2"],
    [host, "spectators"],
    [observer, "team1"],
    [observer, "team2"],
    [host, "unknown"],
    [host, null],
  ])
    assert.equal((await say(c, channel, "forbidden")).type, "error");
  assert.equal(room.chat.length, length);
  assert.equal(room.revision, revision);
  const expected = [
    [host, ["green secret", "public message"]],
    [red, ["red secret", "public message"]],
    [ally, ["green secret", "public message"]],
    [observer, ["green secret", "red secret", "observer secret", "public message"]],
  ];
  for (const [c, texts] of expected) {
    await c.act("sync");
    assert.deepEqual(
      c.state.chat.filter((m) => !m.system).map((m) => m.text),
      texts,
    );
    assert.deepEqual(
      c.frames.filter((m) => m.type === "chat").map((m) => m.message.text),
      texts,
    );
  }
  const switched = await ally.act("join_team", { team: 1 });
  assert.equal(switched.you.seat, 3);
  assert.deepEqual(
    switched.chat.filter((m) => !m.system).map((m) => m.text),
    ["red secret", "public message"],
  );
  const replay = await say(ally, "team1", "green secret", { id: retryId });
  assert.equal(replay.type, "error");
  assert.ok(!JSON.stringify(replay).includes("green secret"));
  const resumed = await client();
  await resumed.hello("resume", "CHANNELS", ally.joined.token);
  assert.deepEqual(
    resumed.state.chat.filter((m) => !m.system).map((m) => m.text),
    ["red secret", "public message"],
  );
  const joined = await observer.act("join_team", { team: 0 });
  assert.equal(joined.you.seat, 2);
  assert.deepEqual(
    joined.chat.filter((m) => !m.system).map((m) => m.text),
    ["green secret", "public message"],
  );
});

test("team chat remains isolated during an active match without advancing combat", async (t) => {
  const { app, client } = await setup(t);
  const host = await client(),
    red = await client(),
    observer = await client();
  await host.hello("create", "MATCHCHAT");
  await red.hello("join", "MATCHCHAT");
  await observer.hello("join", "MATCHCHAT");
  await readyMatch(host, red, app);
  const room = app.rooms.get("MATCHCHAT"),
    before = JSON.stringify(room.game),
    revision = room.revision;
  assert.equal(
    (await host.act("chat", { channel: "team1", message: "battle secret" })).type,
    "chat",
  );
  await red.act("sync");
  await observer.act("sync");
  assert.equal(red.state.chat.filter((m) => !m.system).length, 0);
  assert.equal(observer.state.chat.at(-1).text, "battle secret");
  assert.equal(room.revision, revision);
  assert.equal(JSON.stringify(room.game), before);
});

test("per-seat AI configuration is host-only, atomic and applied separately at deployment", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client(),
    watch = await client();
  await host.hello("create", "AIPROFILES");
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 1200 });
  await host.act("add_ai", { seat: 1 });
  await host.act("add_ai", { seat: 2 });
  await guest.hello("join", "AIPROFILES");
  await watch.hello("join", "AIPROFILES");
  const room = app.rooms.get("AIPROFILES");
  const easy = { difficulty: "easy", fill: 50 },
    hard = { difficulty: "hard", fill: 150 };
  await host.act("configure_room", {
    ...room.settings,
    teamRestrictions: [
      { bannedFactions: ["ZEON"], bannedEras: [] },
      { bannedFactions: ["EFSF"], bannedEras: [] },
    ],
  });
  assert.equal((await guest.act("configure_ai", { seat: 1, config: easy })).type, "error");
  assert.equal((await host.act("configure_ai", { seat: 1, config: easy })).type, "state");
  assert.equal((await host.act("configure_ai", { seat: 2, config: hard })).type, "state");
  const before = JSON.stringify(room.seats.map((p) => p.aiSettings)),
    revision = room.revision;
  for (const bad of [
    { difficulty: "boss" },
    { fill: 301 },
    { fill: "50" },
    { faction: "UNKNOWN" },
    { performance: 99 },
  ])
    assert.equal((await host.act("configure_ai", { seat: 1, config: bad })).type, "error");
  assert.equal((await host.act("configure_ai", { seat: 0, config: easy })).type, "error");
  assert.equal(room.revision, revision);
  assert.equal(JSON.stringify(room.seats.map((p) => p.aiSettings)), before);
  await host.act("set_ready", {
    ready: true,
    formation: [{ unitId: "RGM_79", kitId: "machine_gun", performance: 99 }],
  });
  await guest.latest((s) => s.revision === room.revision);
  await guest.act("set_ready", {
    ready: true,
    formation: [{ unitId: "MS_06F", kitId: "machine_gun" }],
  });
  await startRoom(host);
  assert.equal(room.phase, "assembly");
  await host.latest((s) => s.phase === "assembly");
  await guest.latest((s) => s.phase === "assembly");
  await watch.latest((s) => s.phase === "assembly");
  assert.deepEqual(
    host.state.assembly.players.map((p) => p.seat),
    [0, 2],
  );
  assert.deepEqual(
    guest.state.assembly.players.map((p) => p.seat),
    [1, 3],
  );
  assert.equal(watch.state.assembly.players.length, 4);
  for (const [seat, config] of [
    [1, easy],
    [2, hard],
  ]) {
    const plan = G.planFormation(room.seats[seat].formation, G.aiBudget(1200, config));
    assert.ok(plan.totalCost <= G.aiBudget(1200, config));
    assert.ok(
      plan.entries.every(
        (e) => G.models[e.unitId + "__" + e.kitId].faction === (seat % 2 === 0 ? "EFSF" : "ZEON"),
      ),
    );
  }
  await confirmAssembly(host, guest);
  assert.equal(room.phase, "deployment");
  for (const u of room.game.units) {
    const expected = u.ownerSeat === 1 ? 0.75 : u.ownerSeat === 2 ? 1.25 : 1;
    assert.equal(u.performance, expected);
    assert.equal(u.hp, Math.round(G.models[u.model].hp * expected));
  }
  assert.equal((await host.act("configure_ai", { seat: 1, config: hard })).type, "error");
});

test("final assembly edits retain teammate confirmations and disabled units never enter deployment", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client(),
    watch = await client();
  await host.hello("create", "OVERCOST");
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 700, unitCostLimit: 400 });
  await host.act("add_ai", { seat: 1 });
  await guest.hello("join", "OVERCOST");
  await host.act("add_ai", { seat: 3 });
  await watch.hello("join", "OVERCOST");
  const small = [{ unitId: "MS_06F", kitId: "machine_gun" }],
    large = [{ unitId: "MS_14A", kitId: "beam_rifle" }, ...small, ...small, ...small];
  await host.act("set_ready", { ready: true, formation: large });
  await guest.latest((s) => s.revision === app.rooms.get("OVERCOST").revision);
  await guest.act("set_ready", { ready: true, formation: small });
  const room = app.rooms.get("OVERCOST");
  await startRoom(host);
  assert.equal(room.phase, "assembly");
  assert.equal((await watch.act("confirm_formation")).type, "error");
  assert.equal((await host.act("deploy", { unitId: "0-1", x: 3, y: 8 })).type, "error");
  assert.equal(
    (await host.act("update_formation", { formation: [{ unitId: "missing", kitId: "fake" }] }))
      .type,
    "error",
  );
  await host.act("confirm_formation");
  assert.equal(room.seats[0].finalReady, true);
  await guest.latest((s) => s.revision === room.revision);
  await guest.act("update_formation", { formation: [...small, ...small] });
  assert.equal(room.seats[0].finalReady, true);
  assert.equal(room.phase, "assembly");
  const updateId = randomUUID();
  const changed = await host.act("update_formation", { formation: large }, { id: updateId });
  assert.equal(
    (await host.act("update_formation", { formation: small }, { id: updateId, revision: 0 }))
      .revision,
    changed.revision,
  );
  const own = changed.assembly.players.find((p) => p.seat === 0);
  assert.deepEqual(own.disabled, [0]);
  assert.equal(own.deployCost, 300);
  const resumed = await client();
  await resumed.hello("resume", "OVERCOST", host.joined.token);
  assert.deepEqual(resumed.state.assembly.players.find((p) => p.seat === 0).disabled, [0]);
  await guest.latest((s) => s.revision === room.revision);
  await confirmAssembly(resumed, guest);
  assert.deepEqual(
    room.game.units.filter((u) => u.ownerSeat === 0).map((u) => u.id),
    ["0-1", "0-2", "0-3"],
  );
  assert.equal((await resumed.act("deploy", { unitId: "0-0", x: 2, y: 8 })).type, "error");
  assert.equal((await resumed.act("update_formation", { formation: small })).type, "error");
});

test("host controls room unit cap; invalid and oversized requests are atomic, changes preserve readiness, AI follows cap", async (t) => {
  const { client, app } = await setup(t);
  const host = await client(),
    guest = await client();
  await host.hello("create", "UNITCAP");
  await guest.hello("join", "UNITCAP");
  await host.latest((s) => s.members.length === 2);
  assert.equal(host.state.settings.unitLimit, 6);
  const config = { mapId: "frontier_1v1", costLimit: 3600, unitLimit: 3 };
  assert.equal((await guest.act("configure_room", config)).type, "error");
  for (const unitLimit of [2, 37, 3.5, "12"]) {
    const revision = host.state.revision;
    assert.equal((await host.act("configure_room", { ...config, unitLimit })).type, "error");
    assert.equal(host.state.revision, revision);
    assert.equal(host.state.settings.unitLimit, 6);
  }
  await host.act("set_ready", { ready: true });
  const changed = await host.act("configure_room", config);
  assert.equal(changed.settings.unitLimit, 3);
  assert.equal(changed.members.find((m) => m.id === host.joined.memberId).ready, true);
  const army = Array(4).fill({ unitId: "MS_06F", kitId: "machine_gun" });
  assert.equal((await host.act("set_ready", { ready: true, formation: army })).type, "error");
  assert.equal(app.rooms.get("UNITCAP").seats[0].ready, true);
  guest.send({ type: "leave" });
  await host.latest((s) => s.members.length === 1);
  await host.act("add_ai", { seat: 1 });
  await host.act("set_ready", { ready: true, formation: army.slice(0, 3) });
  await startRoom(host);
  assert.equal(host.state.phase, "assembly");
  assert.equal(app.rooms.get("UNITCAP").seats[1].formation.length, 3);
  assert.equal((await host.act("update_formation", { formation: army })).type, "error");
  assert.equal((await host.act("confirm_formation", { formation: army })).type, "error");
  const deployment = await host.act("confirm_formation", { formation: army.slice(0, 3) });
  assert.equal(deployment.phase, "deployment");
  assert.equal(app.rooms.get("UNITCAP").game.units.length, 6);
});

test("room and team restrictions are authoritative, preserve readiness, constrain AI and exclude disabled IDs at deployment", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "TAGLIMIT");
  await guest.hello("join", "TAGLIMIT");
  await host.latest((s) => s.members.length === 2);
  assert.equal(host.state.settings.costLimit, 4500);
  assert.equal(host.state.settings.unitCostLimit, 1500);
  const settings = {
    ...host.state.settings,
    mapId: "crossroads_2v2",
    costLimit: 400,
    unitCostLimit: 400,
    teamRestrictions: [
      { bannedFactions: ["ZEON"], bannedEras: [] },
      { bannedFactions: ["EFSF"], bannedEras: [] },
    ],
  };
  assert.equal((await guest.act("configure_room", settings)).type, "error");
  const original = JSON.stringify(app.rooms.get("TAGLIMIT").settings);
  for (const bad of [
    { unitCostLimit: 0 },
    { bannedFactions: ["UNKNOWN"] },
    { bannedEras: ["0087"] },
    { teamRestrictions: [] },
  ]) {
    const revision = host.state.revision;
    assert.equal((await host.act("configure_room", { ...settings, ...bad })).type, "error");
    assert.equal(host.state.revision, revision);
    assert.equal(JSON.stringify(app.rooms.get("TAGLIMIT").settings), original);
  }
  await host.act("configure_room", settings);
  await host.act("add_ai", { seat: 2 });
  await host.act("add_ai", { seat: 3 });
  await host.act("set_ready", {
    ready: true,
    formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
  });
  await host.act("configure_room", { ...settings, bannedEras: ["0079"] });
  assert.equal(app.rooms.get("TAGLIMIT").seats[0].ready, true);
  assert.equal(
    (
      await host.act("set_ready", {
        ready: true,
        formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
      })
    ).type,
    "error",
  );
  assert.equal(app.rooms.get("TAGLIMIT").seats[0].ready, true);
  await host.act("configure_room", settings);
  const own = [
    { unitId: "RGM_79", kitId: "machine_gun" },
    { unitId: "MS_06F2", kitId: "machine_gun" },
    { unitId: "RGM_79L", kitId: "beam_gun" },
    { unitId: "RGM_79", kitId: "machine_gun" },
  ];
  await host.act("set_ready", { ready: true, formation: own });
  await guest.latest((s) => s.revision === app.rooms.get("TAGLIMIT").revision);
  await guest.act("set_ready", {
    ready: true,
    formation: [{ unitId: "MS_06F", kitId: "machine_gun" }],
  });
  const room = app.rooms.get("TAGLIMIT");
  await startRoom(host);
  assert.equal(room.phase, "assembly");
  const plan = room.seats[0].formation;
  assert.equal(plan.length, 4);
  await host.latest((s) => s.phase === "assembly");
  assert.deepEqual(host.state.assembly.players.find((p) => p.seat === 0).reasons, {
    1: "not_allowed",
    2: "cost",
    3: "cost",
  });
  for (const seat of [2, 3]) {
    const army = room.seats[seat].formation,
      restrictions = G.formationRestrictions(room.settings, seat);
    assert.ok(army.length > 0);
    assert.equal(G.planFormation(army, 400, restrictions).disabled.length, 0);
    assert.equal(Object.hasOwn(room.seats[seat].aiSettings, "faction"), false);
  }
  await confirmAssembly(host, guest);
  assert.deepEqual(
    room.game.units.filter((u) => u.ownerSeat === 0).map((u) => u.id),
    ["0-0"],
  );
  assert.ok(
    room.game.units.every(
      (u) =>
        !G.restrictionReason(
          G.models[u.model],
          G.formationRestrictions(room.settings, u.ownerSeat),
        ),
    ),
  );
});

test("host can move humans into vacant spawns or spectators and kick them; guests cannot and kicked tokens cannot resume", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client(),
    watch = await client();
  await host.hello("create", "HOSTTOOLS");
  await host.act("configure_room", { ...host.state.settings, mapId: "crossroads_2v2" });
  await guest.hello("join", "HOSTTOOLS");
  await watch.hello("join", "HOSTTOOLS");
  await host.latest((s) => s.members.length === 3);
  const room = app.rooms.get("HOSTTOOLS"),
    target = guest.joined.memberId,
    observer = watch.joined.memberId,
    token = guest.joined.token;
  const revision = room.revision;
  assert.equal(
    (await guest.act("move_player", { memberId: host.joined.memberId, seat: null })).type,
    "error",
  );
  assert.equal((await watch.act("kick_player", { memberId: target })).type, "error");
  assert.equal(room.revision, revision);
  assert.equal((await host.act("move_player", { memberId: target, seat: 2 })).type, "error");
  await host.act("set_ready", { ready: true });
  const changed = await host.act("move_player", { memberId: target, seat: 3 });
  assert.equal(changed.members.find((p) => p.id === host.joined.memberId).ready, true);
  await guest.latest((s) => s.you.seat === 3);
  assert.equal(room.seats[1], null);
  assert.equal(room.seats[3].id, target);
  await host.act("move_player", { memberId: observer, seat: null });
  await host.act("move_player", { memberId: target, seat: 2 });
  await guest.latest((s) => s.you.seat === 2);
  const id = randomUUID();
  const first = await host.act("kick_player", { memberId: target }, { id });
  assert.ok(!first.members.some((p) => p.id === target));
  assert.equal(room.seats[2], null);
  assert.equal(
    (await host.act("kick_player", { memberId: target }, { id, revision: 0 })).revision,
    first.revision,
  );
  assert.ok(guest.frames.some((m) => m.type === "room_closed"));
  const resumed = await client();
  assert.equal((await resumed.hello("resume", "HOSTTOOLS", token)).type, "error");
  assert.equal((await host.act("kick_player", { memberId: host.joined.memberId })).type, "error");
});

test("filling an all-AI room rejects impossible existing team restrictions without adding a partial bot", async (t) => {
  const { client, app } = await setup(t),
    host = await client();
  await host.hello("create", "AIFILTEREMPTY");
  await host.act("add_ai", { seat: 1 });
  await host.act("switch_seat", { seat: null });
  const settings = {
    ...host.state.settings,
    teamRestrictions: [
      { bannedFactions: [], bannedEras: [] },
      { bannedFactions: [], bannedEras: ["0079"] },
    ],
  };
  await host.act("configure_room", settings);
  const room = app.rooms.get("AIFILTEREMPTY"),
    revision = room.revision,
    count = room.members.size;
  assert.equal((await host.act("add_ai", { seat: 0 })).type, "error");
  assert.equal(room.revision, revision);
  assert.equal(room.members.size, count);
  assert.equal(room.seats[0], null);
  assert.equal(room.phase, "waiting");
  await host.act("configure_room", {
    ...settings,
    teamRestrictions: [G.validateTagRestrictions(), G.validateTagRestrictions()],
  });
  assert.equal((await host.act("add_ai", { seat: 0 })).phase, "waiting");
  await startRoom(host);
  assert.equal((await host.act("confirm_formation")).phase, "idle");
  assert.ok(room.game.deployment.every(Boolean));
});

test("per-AI unit count ratio is host-only, preserves readiness, survives resume and never expands human slots", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "AICOUNTPERCENT");
  await host.act("configure_room", {
    ...host.state.settings,
    mapId: "crossroads_2v2",
    costLimit: 10000,
    unitLimit: 12,
  });
  await host.act("add_ai", { seat: 1 });
  await host.act("add_ai", { seat: 2 });
  await guest.hello("join", "AICOUNTPERCENT");
  await host.latest((s) => s.members.length === 4);
  const room = app.rooms.get("AICOUNTPERCENT");
  assert.equal(room.seats[1].aiSettings.countPercent, 100);
  assert.equal(
    (await guest.act("configure_ai", { seat: 1, config: { countPercent: 300 } })).type,
    "error",
  );
  const original = JSON.stringify(room.seats[1].aiSettings),
    revision = room.revision;
  for (const countPercent of [0, 110, 325, "200", null])
    assert.equal(
      (await host.act("configure_ai", { seat: 1, config: { countPercent } })).type,
      "error",
    );
  assert.equal(JSON.stringify(room.seats[1].aiSettings), original);
  assert.equal(room.revision, revision);
  await host.act("set_ready", { ready: true });
  await host.act("configure_ai", { seat: 1, config: { countPercent: 300 } });
  assert.equal(room.seats[0].ready, true);
  await host.act("configure_ai", {
    seat: 2,
    config: { countPercent: 50, fill: 150, difficulty: "hard" },
  });
  const saved = host.joined.token;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "AICOUNTPERCENT", saved);
  assert.equal(resumed.state.members.find((m) => m.seat === 1).aiSettings.countPercent, 300);
  assert.equal(
    (
      await resumed.act("set_ready", {
        ready: true,
        formation: Array(13).fill({ unitId: "MS_06F", kitId: "machine_gun" }),
      })
    ).type,
    "error",
  );
  await resumed.act("set_ready", { ready: true });
  await guest.latest((s) => s.revision === room.revision);
  await guest.act("set_ready", { ready: true });
  await startRoom(resumed);
  assert.equal(room.phase, "assembly");
  assert.equal(room.seats[1].formation.length, 36);
  assert.equal(room.seats[2].formation.length, 6);
  await confirmAssembly(resumed, guest);
  assert.equal(room.phase, "deployment");
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 1).length, 36);
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 2).length, 6);
  const deployed = room.game.units.filter((u) => !u.embarked);
  assert.equal(new Set(deployed.map((u) => u.x + "," + u.y)).size, deployed.length);
  assert.equal(
    (await resumed.act("configure_ai", { seat: 1, config: { countPercent: 50 } })).type,
    "error",
  );
});

test("3v3 supports six full formations, last-seat defense and three-player planning handoff", async (t) => {
  const { players, room } = await multiRoom(t, "frontline_3v3", 6, 3000);
  await startMulti(players, room, Array(6).fill({ unitId: "RGM_79", kitId: "machine_gun" }));
  assert.equal(room.seats.length, 6);
  assert.equal(room.game.units.length, 36);
  assert.equal(new Set(room.game.units.map((u) => u.x + "," + u.y)).size, 36);
  assert.equal((await players[0].act("wait", { unitId: "4-0" })).type, "error");
  const a = room.game.units.find((u) => u.id === "0-0"),
    b = room.game.units.find((u) => u.id === "5-0");
  Object.assign(a, { x: 11, y: 2 });
  Object.assign(b, { x: 13, y: 2, shield: 0 });
  room.game.tiles[2][11] = room.game.tiles[2][13] = "plain";
  const incoming = await players[0].act("attack", {
    unitId: a.id,
    targetId: b.id,
    weaponId: "EF_90mmMG",
  });
  assert.equal(incoming.phase, "idle");
  for (const seat of [0, 2, 4]) {
    await players[seat].latest((state) => state.revision >= room.revision);
    const state = await players[seat].act("end_turn");
    assert.equal(state.game.team, 0);
    assert.equal(state.phase, seat === 4 ? "reaction" : "idle");
  }
  await players[5].latest((state) => state.phase === "reaction");
  const resolved = await players[5].act("respond", { response: "defend" });
  assert.equal(resolved.combats.length, 1);
  assert.equal(resolved.game.team, 1);
  assert.equal(resolved.phase, "idle");
  assert.equal(room.game.round, 2);
});

test("only the host can return an active match to its room, during planning, response and local playback", async (t) => {
  const { players, room, client, code } = await multiRoom(t, "frontier_1v1", 2),
    [host, guest] = players,
    spectator = await client();
  await spectator.hello("join", code, undefined, "Watcher");
  await host.act("chat", { message: "Keep room chat" });
  const settings = structuredClone(room.settings);
  let previousMatch;
  for (const phase of ["idle", "reaction", "battle"]) {
    await startMulti(players, room);
    assert.notEqual(room.matchId, previousMatch);
    previousMatch = room.matchId;
    const a = room.game.units.find((u) => u.id === "0-0"),
      b = room.game.units.find((u) => u.id === "1-0");
    if (phase !== "idle") {
      Object.assign(a, { x: 2, y: 4 });
      Object.assign(b, { x: 4, y: 4 });
      room.game.tiles[4][2] = room.game.tiles[4][4] = "plain";
      assert.equal(
        (await host.act("attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" })).phase,
        "idle",
      );
      await finishPlans(host);
      await guest.latest((s) => s.revision === room.revision);
      for (const player of [host, guest]) {
        assert.equal(player.state.game.units.find((u) => u.id === a.id).angle, 90);
        assert.equal(player.state.game.units.find((u) => u.id === b.id).angle, -90);
      }
      if (phase === "battle")
        assert.equal((await guest.act("respond", { response: "defend" })).phase, "idle");
    }
    for (const p of [host, guest, spectator]) await p.latest((s) => s.revision === room.revision);
    const before = room.revision;
    assert.equal((await guest.act("return_room", { matchId: room.matchId })).type, "error");
    assert.equal((await spectator.act("return_room", { matchId: room.matchId })).type, "error");
    assert.equal((await host.act("return_room", { matchId: "old-match" })).type, "error");
    assert.equal(room.revision, before);
    const id = randomUUID(),
      returned = await host.act("return_room", { matchId: room.matchId }, { id });
    for (const p of [host, guest, spectator]) {
      const state = await p.latest((s) => s.revision === returned.revision);
      assert.equal(state.started, false);
      assert.equal(state.phase, "waiting");
      assert.equal(state.battle, null);
      assert.equal(state.pending, null);
      assert.equal(state.returnAt, null);
      assert.ok(state.members.every((m) => !m.ready));
      assert.deepEqual(state.settings, settings);
      assert.equal(state.chat.at(-1).text, "Keep room chat");
      assert.equal(state.members.length, 3);
    }
    assert.equal(
      (await host.act("return_room", { matchId: room.matchId }, { id })).revision,
      returned.revision,
    );
    assert.equal((await host.act("return_room", { matchId: room.matchId })).type, "error");
  }
  await startMulti(players, room);
  await host.act("switch_seat", { seat: null });
  assert.equal(host.state.you.id, room.hostId);
  assert.equal((await host.act("return_room", { matchId: room.matchId })).phase, "waiting");
});

test("host can start a three-per-team map with two occupied spawns; empty slots never gate deployment, combat or reconnect", async (t) => {
  const { players, room, client, code, app } = await multiRoom(t, "frontline_3v3", 2),
    [host, guest] = players,
    watcher = await client(),
    formation = [{ unitId: "RGM_79", kitId: "machine_gun" }];
  await watcher.hello("join", code, undefined, "Watcher");
  await watcher.act("switch_seat", { seat: null });
  await host.latest((s) => s.revision === room.revision);
  await host.act("move_player", { memberId: guest.joined.memberId, seat: 5 });
  assert.equal((await guest.act("start_game", { formation })).type, "error");
  assert.equal(
    (await host.act("start_game", { formation })).type,
    "error",
    "occupied guests still ready before starting",
  );
  await guest.act("set_ready", { ready: true, formation });
  const started = await host.act("start_game", { formation });
  assert.equal(started.phase, "assembly");
  assert.ok(started.connected.every(Boolean));
  assert.equal(started.assembly.players.length, 1, "only actual teammates are included");
  await confirmAssembly(host, guest);
  assert.equal(room.phase, "deployment");
  assert.deepEqual(
    room.game.units.map((u) => u.ownerSeat),
    [0, 5],
  );
  assert.deepEqual(room.game.deployment, [false, true, true, true, true, false]);
  await host.act("confirm_deployment");
  assert.equal((await guest.act("confirm_deployment")).phase, "idle");
  const lobby = await client();
  lobby.send({ type: "list_rooms" });
  const listing = (
    await lobby.wait((m) => m.type === "rooms" && m.rooms.some((r) => r.code === code))
  ).rooms.find((r) => r.code === code);
  assert.equal(listing.players, 2);
  assert.equal(listing.capacity, 6);
  assert.equal(listing.phase, "playing");
  await host.act("end_turn");
  assert.equal(room.game.team, 1);
  room.turnNotBefore = 0;
  await guest.act("end_turn");
  assert.equal(room.game.team, 0);
  const [a, b] = room.game.units;
  Object.assign(a, { x: 2, y: 4 });
  Object.assign(b, { x: 4, y: 4 });
  room.game.tiles[4][2] = room.game.tiles[4][4] = "plain";
  await host.act("attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  await finishPlans(host);
  await guest.latest((state) => state.phase === "reaction");
  const battle = await guest.act("respond", { response: "defend" });
  assert.equal(battle.combats.length, 1);
  assert.equal(battle.phase, "idle");
  const token = guest.joined.token;
  guest.close();
  const paused = await host.latest((s) => !s.connected[5]);
  assert.ok(paused.connected.slice(1, 5).every(Boolean));
  assert.equal((await host.act("end_turn")).type, "error");
  const resumed = await client();
  await resumed.hello("resume", code, token);
  assert.equal(resumed.state.you.seat, 5);
  assert.ok(resumed.state.connected.every(Boolean));
  assert.equal((await host.act("return_room", { matchId: room.matchId })).phase, "waiting");
  assert.equal(app.rooms.get(code).members.size, 3);
});

test("partly empty AI rooms can start and deploy, including a spectating host", async (t) => {
  const { client, app } = await setup(t, { aiDelayMs: 20 }),
    host = await client();
  await host.hello("create", "SPARSEAI");
  await host.act("configure_room", { mapId: "frontline_3v3", costLimit: 600, unitLimit: 3 });
  assert.equal((await host.act("start_game")).type, "error", "both teams need a participant");
  await host.act("switch_seat", { seat: null });
  await host.act("add_ai", { seat: 0 });
  await host.act("add_ai", { seat: 5 });
  assert.equal((await host.act("start_game")).phase, "assembly");
  assert.equal((await host.act("confirm_formation")).phase, "idle");
  const room = app.rooms.get("SPARSEAI");
  assert.ok(room.game.units.every((u) => u.ownerSeat === 0 || u.ownerSeat === 5));
  assert.ok(room.game.deployment.every(Boolean));
  const before = room.revision;
  await host.latest((s) => s.revision > before);
  assert.equal((await host.act("return_room", { matchId: room.matchId })).phase, "waiting");
});

test("only a different map resets readiness; saved squads and room edits preserve readiness without bypassing deployment rules", async (t) => {
  const { client, app } = await setup(t);
  const host = await client(),
    guest = await client();
  await host.hello("create", "KEEPREADY");
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 3000 });
  await guest.hello("join", "KEEPREADY");
  const room = app.rooms.get("KEEPREADY");
  const formation = [{ unitId: "RGM_79", kitId: "machine_gun" }];
  await guest.act("set_ready", { ready: true, formation });
  const member = () => room.seats.find((p) => p?.id === guest.joined.memberId);
  const edited = [...formation, ...formation];
  assert.equal((await guest.act("update_formation", { formation: edited })).type, "state");
  assert.equal(member().ready, true);
  assert.equal(member().formation.length, 2);
  for (const patch of [
    { costLimit: 1000 },
    { unitCostLimit: 1000 },
    { unitLimit: 3 },
    { bannedFactions: ["ZEON"] },
    {
      teamRestrictions: [
        G.validateTagRestrictions(),
        G.validateTagRestrictions({ bannedFactions: ["ZEON"] }),
      ],
    },
  ]) {
    assert.equal((await host.act("configure_room", { ...room.settings, ...patch })).type, "state");
    assert.equal(member().ready, true);
  }
  await host.act("add_ai", { seat: 2 });
  await host.act("configure_ai", { seat: 2, config: { difficulty: "hard" } });
  await host.act("remove_ai", { seat: 2 });
  assert.equal(member().ready, true);
  await host.act("configure_room", { ...room.settings, bannedEras: ["0079"] });
  assert.equal(member().ready, true);
  assert.equal((await host.act("start_game", { formation })).type, "error");
  assert.equal(room.started, false);
  await host.act("configure_room", { ...room.settings, bannedEras: [] });
  assert.equal(member().ready, true);
  await host.act("configure_room", { ...room.settings, mapId: "ice_bridges_2v2" });
  assert.equal(member().ready, false);
  assert.equal(member().formation.length, 2);
});

test("broken weapon parts are authoritative, survive reconnect and never expose the part random seed", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "PARTSYNC");
  await guest.hello("join", "PARTSYNC");
  await readyMatch(host, guest);
  const room = app.rooms.get("PARTSYNC"),
    attacker = room.game.units.find((u) => u.id === "0-0"),
    target = room.game.units.find((u) => u.id === "1-0");
  attacker.brokenParts = { rightArm: true };
  Object.assign(target, { x: attacker.x + 2, y: attacker.y });
  room.game.tiles[target.y][target.x] = "plain";
  const hp = target.hp,
    en = attacker.en,
    seed = room.game.seed,
    partSeed = room.game.partSeed;
  const sync = await host.act("sync");
  assert.equal(sync.game.units.find((u) => u.id === attacker.id).brokenParts.rightArm, true);
  assert.equal("partSeed" in sync.game, false);
  const rejected = await host.act("attack", {
    unitId: attacker.id,
    targetId: target.id,
    weaponId: "EF_BeamSprayGun",
    brokenParts: {},
  });
  assert.equal(rejected.type, "error");
  assert.deepEqual(
    [target.hp, attacker.en, room.game.seed, room.game.partSeed],
    [hp, en, seed, partSeed],
  );
  const token = host.joined.token,
    id = host.joined.memberId;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const restored = await client();
  await restored.hello("resume", "PARTSYNC", token);
  assert.equal(restored.joined.memberId, id);
  assert.equal(
    restored.state.game.units.find((u) => u.id === attacker.id).brokenParts.rightArm,
    true,
  );
  assert.equal("partSeed" in restored.state.game, false);
});

test("Salamis footprint rotations are owned, authoritative, atomic, deduplicated and resumable", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "SHIPNET");
  await guest.hello("join", "SHIPNET");
  assert.equal(
    (
      await host.act("configure_room", {
        mapId: "orbital_debris_2v2",
        unitCostLimit: 2000,
        costLimit: 5000,
      })
    ).type,
    "state",
  );
  const ready = await host.act("set_ready", {
    ready: true,
    formation: [{ unitId: "SalamisClass", kitId: "standard" }],
  });
  await guest.latest((s) => s.revision >= ready.revision);
  assert.equal(
    (
      await guest.act("set_ready", {
        ready: true,
        formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
      })
    ).type,
    "state",
  );
  await confirmAssembly(host, guest);
  const room = app.rooms.get("SHIPNET"),
    ship = room.game.units.find((u) => u.ownerSeat === 0);
  assert.equal(Object.keys(ship.moduleHp).length, 16);
  assert.equal((await guest.act("rotate", { unitId: ship.id, direction: 1 })).type, "error");
  assert.equal((await host.act("rotate", { unitId: ship.id, direction: 1 })).type, "state");
  assert.equal(ship.moved, false);
  await host.act("confirm_deployment");
  await guest.latest((s) => s.game.deployment[0]);
  await guest.act("confirm_deployment");
  await host.latest((s) => s.phase === "idle");
  const id = randomUUID(),
    before = ship.angle;
  const result = await host.act("rotate", { unitId: ship.id, direction: 1 }, { id });
  assert.equal(result.type, "state");
  assert.equal(ship.angle, (before + 90 + 360) % 360);
  assert.equal(ship.moved, true);
  const duplicate = await host.act(
    "rotate",
    { unitId: ship.id, direction: 1 },
    { id, revision: 0 },
  );
  assert.deepEqual(duplicate.game, result.game);
  const invalid = await host.act("rotate", { unitId: ship.id, direction: 45 });
  assert.equal(invalid.type, "error");
  assert.equal(ship.angle, (before + 90 + 360) % 360);
  const token = host.joined.token;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "SHIPNET", token);
  const restored = resumed.state.game.units.find((u) => u.id === ship.id);
  assert.equal(restored.angle, ship.angle);
  assert.deepEqual(restored.moduleHp, ship.moduleHp);
});

for (const [environment, mapId, previousMap] of [
  ["ground", "frontier_1v1", "asteroid_crossing_1v1"],
  ["space", "asteroid_crossing_1v1", "frontier_1v1"],
]) {
  test(`AI final assembly follows the latest ${environment} map after changing maps`, async (t) => {
    const { app, client } = await setup(t);
    const host = await client();
    const code = environment === "space" ? "AISPACEMAP" : "AIGROUNDMAP";
    await host.hello("create", code);
    const settings = { costLimit: 3000, unitCostLimit: 500, unitLimit: 6 };
    assert.equal(
      (await host.act("configure_room", { ...settings, mapId: previousMap })).type,
      "state",
    );
    assert.equal((await host.act("add_ai", { seat: 1 })).type, "state");
    assert.equal((await host.act("configure_room", { ...settings, mapId })).type, "state");
    await host.act("set_ready", { ready: true });
    await startRoom(host);
    assert.equal(host.state.phase, "assembly");
    const army = app.rooms.get(code).seats[1].formation;
    assert.equal(army.length, 6);
    assert.ok(
      army.every(
        (entry) => G.models[entry.unitId + "__" + entry.kitId].adaptability[environment] === 100,
      ),
    );
  });
}

test("ejection is owner-only, atomic, deduplicated and synchronizes the new craft through reconnect", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "EJECTNET");
  await guest.hello("join", "EJECTNET");
  await host.act("configure_room", { mapId: "frontier_1v1", costLimit: 5000, unitCostLimit: 1500 });
  await host.act("set_ready", {
    ready: true,
    formation: [{ unitId: "RX_78_1", kitId: "beam_rifle", customName: "白色一号" }],
  });
  await guest.latest((s) => s.settings.unitCostLimit === 1500);
  await guest.act("set_ready", { ready: true });
  await confirmAssembly(host, guest);
  await host.act("confirm_deployment");
  await guest.latest((s) => s.game.deployment[0]);
  await guest.act("confirm_deployment");
  await host.latest((s) => s.phase === "idle");
  const room = app.rooms.get("EJECTNET"),
    original = room.game.units.find((u) => u.ownerSeat === 0);
  assert.equal(
    (
      await guest.act("skill", {
        unitId: original.id,
        skillId: "ExitUnit",
        x: original.x,
        y: original.y,
      })
    ).type,
    "error",
  );
  const before = JSON.stringify(room.game);
  assert.equal(
    (await host.act("skill", { unitId: original.id, skillId: "ExitUnit", x: -1, y: 0 })).type,
    "error",
  );
  assert.equal(JSON.stringify(room.game), before);
  original.hp = 100;
  original.en = 0;
  original.brokenParts = { head: true, rightArm: true };
  const id = randomUUID(),
    fields = {
      unitId: original.id,
      skillId: "ExitUnit",
      ...G.skillTargets(room.game, original, "ExitUnit")[0],
    };
  const response = await host.act("skill", fields, { id });
  assert.equal(response.type, "state");
  const craft = room.game.units.find((u) => u.ownerSeat === 0);
  assert.equal(craft.model, "FF_X7__standard");
  assert.equal(craft.hp, 8500);
  assert.equal(craft.en, G.modelOf(craft).en);
  assert.equal(craft.customName, "白色一号");
  assert.equal(craft.acted, true);
  assert.deepEqual(craft.brokenParts, {});
  assert.ok(response.log.some((line) => line.includes("白色一号") && line.includes("脱出")));
  await guest.latest((s) => s.revision >= response.revision);
  assert.equal(
    guest.state.game.units.some((u) => u.id === craft.id),
    false,
  );
  const duplicate = await host.act("skill", fields, { id, revision: 0 });
  assert.deepEqual(duplicate.game, response.game);
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 0).length, 1);
  const token = host.joined.token;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "EJECTNET", token);
  const restored = resumed.state.game.units.find((u) => u.id === craft.id);
  assert.deepEqual(restored, JSON.parse(JSON.stringify(craft)));
  assert.equal((await resumed.act("skill", fields)).type, "error");
});

test("AI ejects a critically damaged RX-78-1 before moving or attacking", async (t) => {
  const { app, client } = await setup(t, { aiDelayMs: 1000, aiBattleMs: 20 });
  const host = await client();
  await host.hello("create", "AIEJECT");
  await host.act("switch_seat", { seat: null });
  await host.act("add_ai", { seat: 0 });
  await host.act("add_ai", { seat: 1 });
  await startRoom(host);
  await confirmAssembly(host);
  const room = app.rooms.get("AIEJECT");
  assert.equal(room.phase, "idle");
  const unit = room.game.units.find(
    (u) => u.ownerSeat === 0 && !u.embarked && !G.models[u.model].footprint,
  );
  assert(unit, "AI formation contains a deployed 1x1 unit for the ejection fixture");
  room.game.units = room.game.units.filter((u) => u.ownerSeat !== 0 || u === unit);
  Object.assign(unit, {
    model: "RX_78_1__beam_rifle",
    hp: 100,
    en: 0,
    acted: false,
    moved: false,
    brokenParts: { rightArm: true },
  });
  for (const ally of room.game.units.filter((u) => u !== unit && u.ownerSeat === 0))
    ally.acted = true;
  const from = host.frames.length;
  const state = await host.wait((m) => m.type === "state" && m.lastEvent?.type === "skill", from);
  const craft = state.game.units.find((u) => u.id === state.lastEvent.resultId);
  assert.equal(craft.model, "FF_X7__standard");
  assert.equal(craft.hp, 8500);
  assert.equal(craft.en, G.modelOf(craft).en);
  assert.equal(craft.ownerSeat, 0);
  assert.ok(craft.acted);
  assert.equal(
    state.game.units.some((u) => u.id === unit.id),
    false,
  );
});

test("passive supply ticks through team handoff, duplicate end-turn is harmless and reconnect retains resources", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "REPAIRNET");
  await guest.hello("join", "REPAIRNET");
  await host.act("configure_room", { costLimit: 5000, unitCostLimit: 1500 });
  await host.act("set_ready", {
    ready: true,
    formation: [
      { unitId: "Type74", kitId: "standard" },
      { unitId: "RGM_79", kitId: "machine_gun" },
    ],
  });
  await guest.act("set_ready", { ready: true });
  await confirmAssembly(host, guest);
  await host.act("confirm_deployment");
  await guest.latest((s) => s.game.deployment[0]);
  await guest.act("confirm_deployment");
  await host.latest((s) => s.phase === "idle");
  const room = app.rooms.get("REPAIRNET"),
    [source, target] = room.game.units.filter((u) => u.ownerSeat === 0);
  Object.assign(source, { x: 3, y: 4, en: 100 });
  Object.assign(target, { x: 4, y: 4, hp: 1, en: 0, shield: 0, brokenParts: { head: true } });
  const fields = { unitId: source.id, skillId: "FieldMaintenance", x: target.x, y: target.y };
  assert.equal((await guest.act("skill", fields)).type, "error");
  assert.equal((await host.act("skill", fields)).type, "error");
  const id = randomUUID();
  const first = await host.act("end_turn", {}, { id });
  assert.equal(first.type, "state");
  const duplicate = await host.act("end_turn", {}, { id, revision: 0 });
  assert.deepEqual(duplicate.game, first.game);
  await guest.latest((s) => s.game.team === 1);
  assert.equal((await guest.act("end_turn")).type, "state");
  await host.latest((s) => s.game.team === 0);
  assert.equal(source.en, 100 + G.modelOf(source).en * 0.1);
  assert.equal(target.hp, 1 + Math.round(G.modelOf(target).hp * 0.05));
  assert.equal(target.en, G.modelOf(target).en * 0.1);
  assert.deepEqual(target.brokenParts, { head: true });
  const token = host.joined.token;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "REPAIRNET", token);
  assert.deepEqual(
    resumed.state.game.units.find((u) => u.id === target.id),
    JSON.parse(JSON.stringify(target)),
  );
});
test("EXAM activation is owned, atomic, deduplicated, temporary and survives reconnect", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "EXAMNET");
  await guest.hello("join", "EXAMNET");
  await host.act("configure_room", { costLimit: 5000, unitCostLimit: 2000 });
  assert.equal(
    (
      await host.act("set_ready", {
        ready: true,
        formation: [{ unitId: "RX_79_BD_1_EXAM", kitId: "kit_0" }],
      })
    ).type,
    "error",
  );
  await host.act("set_ready", {
    ready: true,
    formation: [{ unitId: "RX_79_BD_1", kitId: "kit_0" }],
  });
  await guest.act("set_ready", {
    ready: true,
    formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
  });
  await confirmAssembly(host, guest);
  await host.act("confirm_deployment");
  await guest.latest((s) => s.game.deployment[0]);
  await guest.act("confirm_deployment");
  await host.latest((s) => s.phase === "idle");
  const room = app.rooms.get("EXAMNET"),
    actor = room.game.units.find((u) => u.ownerSeat === 0),
    base = actor.model;
  const fields = { unitId: actor.id, skillId: "EXAM", x: actor.x, y: actor.y };
  assert.equal((await guest.act("skill", fields)).type, "error");
  const id = randomUUID(),
    result = await host.act("skill", fields, { id });
  assert.equal(result.type, "state");
  assert.equal(actor.en, G.modelOf(actor).en * 0.75);
  assert.equal(actor.overdrive.remaining, 3);
  const duplicate = await host.act("skill", fields, { id, revision: 0 });
  assert.deepEqual(duplicate.game, result.game);
  assert.equal(actor.en, G.modelOf(actor).en * 0.75);
  const token = host.joined.token;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "EXAMNET", token);
  assert.deepEqual(
    resumed.state.game.units.find((u) => u.id === actor.id).overdrive,
    actor.overdrive,
  );
  for (let tick = 1; tick <= 3; tick++) {
    assert.equal((await resumed.act("end_turn")).type, "state");
    await guest.latest((s) => s.game.team === 1);
    assert.equal(actor.en, G.modelOf(actor).en * (0.75 - 0.05 * tick));
    if (tick < 3) {
      assert.equal((await guest.act("end_turn")).type, "state");
      await resumed.latest((s) => s.game.team === 0);
    }
  }
  assert.equal(actor.model, base);
  assert.equal(actor.overdrive, undefined);
  assert.equal(actor.en, G.modelOf(actor).en * 0.6);
});

test("mortar reactions are area-only and all viewers finish the occupied impact playback", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "MORTAR01");
  await red.hello("join", "MORTAR01");
  await readyMatch(blue, red);
  const room = app.rooms.get("MORTAR01"),
    g = room.game,
    a = g.units.find((u) => u.id === "0-0");
  a.model = "RGC_80__machine_gun";
  Object.assign(a, { x: 10, y: 10 });
  const enemies = g.units.filter((u) => u.team === 1);
  // Find a seed where the centre is among the first three samples, then place the three defenders there.
  for (let seed = 0; ; seed++) {
    const probe = { seed },
      bag = [];
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) bag.push({ x: 16 + x, y: 10 + y });
    const picked = Array.from(
      { length: 3 },
      () => bag.splice(Math.floor(G.random(probe) * bag.length), 1)[0],
    );
    if (picked.some((c) => c.x === 16 && c.y === 10)) {
      g.seed = seed;
      enemies.forEach((b, i) => Object.assign(b, picked[i]));
      break;
    }
  }
  const b = enemies.find((b) => b.x === 16 && b.y === 10),
    w = G.modelOf(a).weapons.find((w) => w.special?.type === "mortar"),
    energy = a.en;
  assert.equal(
    (await blue.act("attack", { unitId: a.id, targetId: b.id, weaponId: w.id })).type,
    "state",
  );
  await finishPlans(blue);
  await red.latest((s) => s.phase === "reaction");
  blue.autoPlayback = red.autoPlayback = false;
  let lastId, last;
  for (let i = 0; i < 3; i++) {
    const request = red.state.pending;
    assert.ok(request);
    assert.ok(request.counterTargets.every((t) => t.options.length === 0));
    assert.equal(request.attacks[0].shotIndices.length, 1);
    assert.equal(
      (await red.act("respond", { response: "counter", counterId: "EF_HypeBazooka" })).type,
      "error",
    );
    lastId = randomUUID();
    last = await red.act("respond", { response: "defend" }, { id: lastId });
  }
  assert.equal(last.phase, "playback");
  assert.equal(a.en, energy - w.en);
  assert.equal(last.combats.length, 3);
  assert.ok(last.combats.every((b) => b.events.length === 1));
  const batchId = last.playback.id;
  await blue.latest((s) => s.playback?.id === batchId);
  await blue.act("playback_ready", { batchId });
  assert.equal(room.phase, "playback");
  const done = await red.act("playback_ready", { batchId });
  assert.equal(done.game.team, 1);
  assert.equal(done.phase, "idle");
  const en = a.en;
  await red.act("respond", { response: "defend" }, { id: lastId, revision: 0 });
  assert.equal(a.en, en);
});

test("sniper charge survives reconnect and fires immediately at next own phase with native damage and doubled hit", async (t) => {
  const { app, client } = await setup(t);
  let blue = await client();
  const red = await client();
  await blue.hello("create", "SNIPE01");
  await red.hello("join", "SNIPE01");
  await readyMatch(blue, red);
  const room = app.rooms.get("SNIPE01"),
    g = room.game,
    a = g.units[0],
    b = g.units.find((u) => u.id === "1-0");
  a.model = Object.keys(G.models).find((k) => G.models[k].prefabId === "RGM_79_G_SP");
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 14, y: 10, hp: 100000, shield: 0 });
  g.tiles.forEach((r) => r.fill("plain"));
  const w = G.modelOf(a).weapons.find((w) => w.special?.type === "snipe");
  await blue.act("attack", { unitId: a.id, targetId: b.id, weaponId: w.id });
  await finishPlans(blue);
  await red.latest((s) => s.game.team === 1);
  assert.equal(a.en, G.modelOf(a).en);
  assert.ok(a.snipeOrder);
  assert.equal(room.combats.length, 0);
  const token = blue.joined.token;
  blue.close();
  await red.latest((s) => !s.connected[0]);
  blue = await client();
  await blue.hello("resume", "SNIPE01", token);
  assert.ok(blue.state.game.units[0].snipeOrder);
  await finishPlans(red);
  await blue.latest((s) => s.game.team === 0);
  assert.equal(blue.state.game.units[0].plan.charged, true);
  assert.equal(a.en, G.modelOf(a).en);
  const base = G.modelOf(a).weapons.find((c) => c.id === w.special.baseWeapon),
    expected = Math.min(100, G.estimate(g, a, b, { ...w, hitScale: 1 }, "defend").hit * 2);
  assert.equal(room.phase, "reaction");
  await red.latest((s) => s.phase === "reaction");
  const done = await red.act("respond", { response: "defend" });
  const event = done.combats.at(-1).events[0];
  assert.equal(event.weapon, w.id);
  assert.equal(event.damagePerShot, w.damagePerShot);
  assert.equal(event.strikes[0].hitChance, expected);
  assert.equal(a.en, G.modelOf(a).en - w.en);
  assert.equal(a.snipeOrder, undefined);
});

for (const [unitId, skillId] of [
  ["MTank", "ExitUnit"],
  ["FA_78_1", "ExitUnit"],
  ["YMT_05", "Transform"],
])
  test(
    unitId + " conversion is owner-only, deduplicated and synchronized after reconnect",
    async (t) => {
      const { app, client } = await setup(t),
        host = await client(),
        guest = await client();
      const code = ("FORM" + unitId.replace(/_/g, "").slice(0, 6)).toUpperCase();
      await host.hello("create", code);
      await guest.hello("join", code);
      await host.act("configure_room", {
        mapId: "frontier_1v1",
        costLimit: 5000,
        unitCostLimit: 1500,
      });
      const kitId = Object.values(G.models).find((m) => m.prefabId === unitId).kitId;
      await host.act("set_ready", { ready: true, formation: [{ unitId, kitId }] });
      await guest.latest((s) => s.settings.unitCostLimit === 1500);
      await guest.act("set_ready", { ready: true });
      await confirmAssembly(host, guest);
      await host.act("confirm_deployment");
      await guest.act("confirm_deployment");
      const room = app.rooms.get(code),
        unit = room.game.units.find((u) => u.ownerSeat === 0),
        cell = G.skillTargets(room.game, unit, skillId)[0];
      assert.ok(cell);
      const fields = { unitId: unit.id, skillId, ...cell };
      assert.equal((await guest.act("skill", fields)).type, "error");
      const before = JSON.stringify(room.game);
      assert.equal((await host.act("skill", { ...fields, x: -1 })).type, "error");
      assert.equal(JSON.stringify(room.game), before);
      const id = randomUUID(),
        state = await host.act("skill", fields, { id });
      assert.equal(state.type, "state");
      const snapshot = JSON.parse(JSON.stringify(state.game));
      const duplicate = await host.act("skill", fields, { id, revision: 0 });
      assert.deepEqual(duplicate.game, state.game);
      await guest.latest((s) => s.revision >= state.revision);
      assert.equal(
        guest.state.game.units.some((u) => u.id === unit.id),
        false,
      );
      const token = host.joined.token;
      host.close();
      await guest.latest((s) => !s.connected[0]);
      const resumed = await client();
      await resumed.hello("resume", code, token);
      assert.deepEqual(resumed.state.game, snapshot);
      assert.equal((await resumed.act("skill", fields)).type, "error");
    },
  );

test("AI formation presets are host-only, validated, synchronized, retained on resume and used for deployment", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "AIPRESETS");
  await host.act("configure_room", {
    ...host.state.settings,
    mapId: "crossroads_2v2",
    costLimit: 3000,
    unitCostLimit: 500,
    unitLimit: 3,
  });
  await host.act("add_ai", { seat: 1 });
  await host.act("add_ai", { seat: 2 });
  await guest.hello("join", "AIPRESETS");
  await host.latest((s) => s.members.length === 4);
  const room = app.rooms.get("AIPRESETS"),
    preset = {
      name: "自定义AI",
      units: [
        { unitId: "RGM_79", kitId: "machine_gun", customName: "预设一号" },
        { unitId: "RGM_79", kitId: "bazooka", customName: "预设二号" },
        { unitId: "RGM_79", kitId: "machine_gun", customName: "预设三号" },
        { unitId: "RGM_79", kitId: "machine_gun", customName: "不出击四号" },
      ],
    };
  assert.equal(
    (await guest.act("configure_ai", { seat: 1, config: {}, formationPreset: preset })).type,
    "error",
  );
  assert.equal(
    (
      await host.act("configure_ai", {
        seat: 1,
        config: {},
        formationPreset: { name: "坏预设", units: [{ unitId: "missing", kitId: "missing" }] },
      })
    ).type,
    "error",
  );
  assert.equal(
    (
      await host.act("configure_ai", {
        seat: 1,
        config: {},
        formationPreset: { name: "空预设", units: [] },
      })
    ).type,
    "error",
  );
  assert.equal(
    (
      await host.act("configure_ai", {
        seat: 1,
        config: {},
        formationPreset: {
          name: "高COST预设",
          units: [{ unitId: "RX_79_G", kitId: "beam_rifle" }],
        },
      })
    ).type,
    "state",
  );
  assert.equal(
    (await host.act("configure_ai", { seat: 1, config: {}, formationPreset: preset })).type,
    "state",
  );
  await guest.latest((s) => s.revision === room.revision);
  assert.deepEqual(guest.state.members.find((m) => m.seat === 1).formationPreset, preset);
  assert.equal(guest.state.members.find((m) => m.seat === 2).formationPreset, null);
  await host.act("configure_ai", { seat: 1, config: { difficulty: "hard" } });
  assert.deepEqual(room.seats[1].formationPreset, preset);
  const token = host.joined.token;
  host.close();
  await guest.latest((s) => !s.connected[0]);
  const resumed = await client();
  await resumed.hello("resume", "AIPRESETS", token);
  assert.deepEqual(resumed.state.members.find((m) => m.seat === 1).formationPreset, preset);
  assert.equal(
    (
      await resumed.act("configure_ai", {
        seat: 1,
        config: { difficulty: "hard" },
        formationPreset: null,
      })
    ).type,
    "state",
  );
  assert.equal(room.seats[1].formationPreset, null);
  await resumed.act("configure_ai", {
    seat: 1,
    config: { difficulty: "hard" },
    formationPreset: preset,
  });
  await guest.latest((s) => s.revision === room.revision);
  await resumed.act("set_ready", { ready: true });
  await guest.latest((s) => s.revision === room.revision);
  await guest.act("set_ready", { ready: true });
  await startRoom(resumed);
  assert.deepEqual(room.seats[1].formation, preset.units);
  await confirmAssembly(resumed, guest);
  assert.equal(room.phase, "deployment");
  assert.deepEqual(
    room.game.units
      .filter((u) => u.ownerSeat === 1)
      .map((u) => ({
        unitId: u.model.split("__")[0],
        kitId: u.model.split("__")[1],
        customName: u.customName,
      })),
    preset.units,
  );
});

test("host return counts down five seconds in assembly and battle, synchronizes on reconnect and freezes game actions", async (t) => {
  const { client, app } = await setup(t, { roomReturnMs: 5000 });
  const host = await client();
  let guest = await client();
  host.autoReturn = guest.autoReturn = false;
  await host.hello("create", "RETURNCOUNTDOWN");
  await guest.hello("join", "RETURNCOUNTDOWN");
  const room = app.rooms.get("RETURNCOUNTDOWN");
  for (const stage of ["assembly", "idle"]) {
    await host.act("set_ready", { ready: true });
    await guest.latest((s) => s.revision === room.revision);
    await guest.act("set_ready", { ready: true });
    await startRoom(host);
    if (stage === "idle") {
      await confirmAssembly(host, guest);
      await host.act("confirm_deployment");
      await guest.latest((s) => s.revision === room.revision);
      await guest.act("confirm_deployment");
      await host.latest((s) => s.phase === "idle");
    }
    assert.equal(room.phase, stage);
    const matchId = room.matchId,
      id = randomUUID();
    const started = await host.act("return_room", { matchId }, { id });
    assert.equal(started.started, true);
    assert.equal(started.phase, stage);
    assert.ok(
      started.returnCountdown.at - started.serverTime >= 4900 &&
        started.returnCountdown.at - started.serverTime <= 5000,
    );
    await guest.latest((s) => !!s.returnCountdown);
    assert.deepEqual(guest.state.returnCountdown, started.returnCountdown);
    assert.equal((await guest.act("return_room", { matchId })).type, "error");
    assert.equal((await guest.act("end_turn")).type, "error");
    assert.deepEqual(
      (await host.act("return_room", { matchId }, { id })).returnCountdown,
      started.returnCountdown,
    );
    assert.deepEqual(
      (await host.act("return_room", { matchId })).returnCountdown,
      started.returnCountdown,
    );
    const token = guest.joined.token;
    guest.close();
    await host.latest((s) => !s.connected[1]);
    guest = await client();
    guest.autoReturn = false;
    await guest.hello("resume", "RETURNCOUNTDOWN", token);
    assert.deepEqual(guest.state.returnCountdown, started.returnCountdown);
    const returned = await host.wait(
      (m) => m.type === "state" && !m.started,
      host.frames.length,
      7000,
    );
    assert.ok(returned.serverTime >= started.returnCountdown.at);
    assert.equal(returned.phase, "waiting");
    assert.equal(returned.returnCountdown, null);
    await guest.latest((s) => !s.started);
    assert.equal(room.returnCountdown, null);
  }
});

test("host configures human and AI armies; assigned presets bypass room limits and apply each player's strength", async (t) => {
  const { client, app } = await setup(t),
    host = await client();
  let guest = await client();
  await host.hello("create", "PLAYERARMY");
  await host.act("configure_room", {
    ...host.state.settings,
    mapId: "crossroads_2v2",
    costLimit: 1000,
    unitLimit: 3,
    unitCostLimit: 500,
  });
  await guest.hello("join", "PLAYERARMY");
  await host.latest((s) => s.members.length === 2);
  await host.act("add_ai", { seat: 2 });
  const room = app.rooms.get("PLAYERARMY"),
    guestId = guest.joined.memberId,
    bot = room.seats[2];
  const config = {
    difficulty: 300,
    fill: 300,
    countPercent: 300,
    unitCostLimit: null,
    unitCostPercent: 200,
  };
  assert.equal((await guest.act("configure_player", { memberId: guestId, config })).type, "error");
  for (const invalid of [
    { ...config, unitCostPercent: 0 },
    { ...config, countPercent: 110 },
    { ...config, difficulty: "invalid" },
  ])
    assert.equal(
      (await host.act("configure_player", { memberId: guestId, config: invalid })).type,
      "error",
    );
  assert.equal((await host.act("configure_player", { memberId: guestId, config })).type, "state");
  assert.equal(G.armyUnitLimit(room.settings, room.seats[1]), 9);
  assert.equal(G.armyBudget(room.settings, room.seats[1]), 3000);
  assert.equal(G.armyRestrictions(room.settings, room.seats[1]).unitCostLimit, 1000);
  await guest.latest((s) => s.revision === room.revision);
  const personal = Array.from({ length: 9 }, () => ({ unitId: "RGM_79", kitId: "machine_gun" }));
  assert.equal((await guest.act("set_ready", { ready: true, formation: personal })).type, "state");
  const preset = {
    name: "房主指定RX小队",
    units: Array.from({ length: 8 }, (_, i) => ({
      unitId: "RX_79_G",
      kitId: "beam_rifle",
      customName: "指定RX" + (i + 1),
    })),
  };
  await host.latest((s) => s.revision === room.revision);
  assert.equal(
    (await host.act("configure_player", { memberId: guestId, config, formationPreset: preset }))
      .type,
    "state",
  );
  assert.equal(room.seats[1].ready, true);
  assert.equal(
    (await host.act("configure_player", { memberId: guestId, config, formationPreset: null })).type,
    "state",
  );
  assert.deepEqual(room.seats[1].formation, personal);
  await host.act("configure_player", { memberId: guestId, config, formationPreset: preset });
  await host.act("configure_player", {
    memberId: bot.id,
    config: { difficulty: 25, fill: 25, countPercent: 25, unitCostLimit: 25 },
    formationPreset: preset,
  });
  await host.act("configure_room", {
    ...room.settings,
    teamRestrictions: [
      { bannedFactions: [], bannedEras: [] },
      { bannedFactions: ["EFSF"], bannedEras: ["0079"], bannedTypes: ["MS"] },
    ],
  });
  await guest.latest((s) => s.revision === room.revision);
  await guest.act("update_formation", { formation: [{ unitId: "MS_06F", kitId: "machine_gun" }] });
  assert.deepEqual(room.seats[1].formation, preset.units);
  assert.deepEqual(guest.state.settings.teamRestrictions[1].bannedTypes, ["MS"]);
  const token = guest.joined.token;
  guest.close();
  await host.latest((s) => !s.connected[1]);
  guest = await client();
  await guest.hello("resume", "PLAYERARMY", token);
  assert.deepEqual(guest.state.members.find((m) => m.id === guestId).armySettings, config);
  assert.deepEqual(guest.state.members.find((m) => m.id === guestId).formationPreset, preset);
  await host.latest((s) => s.revision === room.revision);
  assert.equal(
    (await host.act("start_game", { formation: [{ unitId: "RGM_79", kitId: "machine_gun" }] }))
      .type,
    "state",
  );
  const plan = host.state.assembly.players.find((p) => p.seat === 2);
  assert.equal(plan.entries.length, 8);
  assert.deepEqual(plan.disabled, []);
  await confirmAssembly(host, guest);
  assert.equal(room.phase, "deployment");
  for (const [seat, factor] of [
    [1, 3],
    [2, 0.25],
  ]) {
    const units = room.game.units.filter((u) => u.ownerSeat === seat);
    assert.equal(units.length, 8);
    assert.ok(units.every((u) => u.performance === factor && u.hp === G.modelOf(u).hp));
    assert.deepEqual(
      units.map((u) => u.customName),
      preset.units.map((e) => e.customName),
    );
  }
  assert.equal((await host.act("configure_player", { memberId: guestId, config })).type, "error");
});

test("large snapshots negotiate compression while legacy clients keep the same authoritative state", async (t) => {
  const { app, client } = await setup(t, { heartbeatMs: 60000 });
  const host = await client({ perMessageDeflate: true }),
    guest = await client({ perMessageDeflate: false });
  await host.hello("create", "COMPRESSED");
  await guest.hello("join", "COMPRESSED");
  assert.ok(host.ws.extensions.includes("permessage-deflate"));
  assert.equal(guest.ws.extensions, "");
  await readyMatch(host, guest, app);
  const before = host.ws._socket.bytesRead;
  const state = await host.act("sync");
  const wireBytes = host.ws._socket.bytesRead - before;
  const jsonBytes = Buffer.byteLength(JSON.stringify(state));
  assert.ok(wireBytes < jsonBytes / 2, `${wireBytes} / ${jsonBytes} bytes`);
  const other = await guest.act("sync");
  for (const field of [
    "mapId",
    "environment",
    "fogMode",
    "costLimit",
    "unitLimit",
    "team",
    "round",
    "winner",
  ])
    assert.deepEqual(state.game[field], other.game[field]);
  assert.deepEqual(state.game.deployment, other.game.deployment);
  assert.ok(!("seed" in state.game));
  assert.ok(!("seed" in other.game));
  t.diagnostic(
    `snapshot JSON ${jsonBytes} bytes; compressed WebSocket ${wireBytes} bytes (${Math.round((1 - wireBytes / jsonBytes) * 100)}% smaller)`,
  );
});

test("concurrent deployment accepts an older same-match snapshot without weakening ownership or occupancy", async (t) => {
  const { players, room } = await multiRoom(t, "crossroads_2v2", 4, 600);
  for (const player of players) {
    await player.latest((s) => s.revision === room.revision);
    await player.act("set_ready", {
      ready: true,
      formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
    });
  }
  await confirmAssembly(...players);
  const revision = room.revision,
    matchId = room.matchId,
    round = room.game.round;
  const overrides = { revision, matchId, round };
  for (const player of players) {
    const seat = player.joined.seat;
    const unit = room.game.units.find((u) => u.ownerSeat === seat);
    const cell = G.deploymentCells(room.game, seat, unit).find(
      (c) => !room.game.units.some((u) => u.x === c.x && u.y === c.y),
    );
    assert.equal(
      (await player.act("deploy", { unitId: unit.id, ...cell }, overrides)).type,
      "state",
    );
  }
  const enemy = room.game.units.find((u) => u.ownerSeat === 1);
  assert.equal(
    (await players[0].act("deploy", { unitId: enemy.id, x: enemy.x, y: enemy.y }, overrides)).type,
    "error",
  );
  for (const player of players)
    assert.equal((await player.act("confirm_deployment", {}, overrides)).type, "state");
  assert.equal(room.phase, "idle");
  assert.equal(new Set(room.game.units.map((u) => u.x + "," + u.y)).size, room.game.units.length);
});

test("counter weapon sequences synchronize, survive resume and execute once against the selected attacker", async (t) => {
  const { players, room, client, code } = await multiRoom(t, "crossroads_2v2", 4, 1200);
  const entry = { unitId: "RGM_79", kitId: "beam_spray" };
  await startMulti(players, room, [entry, entry]);
  for (const u of room.game.units) {
    const seat = G.ownerOf(u),
      index = Number(u.id.split("-")[1]);
    Object.assign(u, {
      x: seat % 2 ? 4 : 2,
      y: 4 + Math.floor(seat / 2) + index * 3,
      hp: 1000000,
      shield: 0,
    });
  }
  room.game.units.find((u) => u.id === "0-1").y = 6;
  room.game.tiles.forEach((row) => row.fill("plain"));
  for (const [seat, unitId, targetId] of [
    [0, "0-0", "1-0"],
    [2, "2-0", "1-0"],
    [0, "0-1", "3-0"],
  ]) {
    await players[seat].latest((s) => s.revision === room.revision);
    assert.equal(
      (await players[seat].act("attack", { unitId, targetId, weaponId: "EF_BeamSprayGun" })).type,
      "state",
    );
  }
  for (const seat of [0, 2]) {
    await players[seat].latest((s) => s.revision === room.revision);
    await players[seat].act("end_turn");
  }
  let defender = players[1];
  await defender.latest((s) => s.phase === "reaction");
  const responseId = defender.state.pending.id;
  assert.equal(
    (
      await defender.act("respond", {
        response: "counter",
        counterIds: Array(3).fill("EF_BeamSprayGun"),
        counterTargetId: "2-0",
      })
    ).type,
    "error",
  );
  const requestId = randomUUID(),
    energy = room.game.units.find((u) => u.id === "1-0").en;
  assert.equal(
    (
      await defender.act(
        "respond",
        {
          response: "counter",
          counterIds: Array(2).fill("EF_BeamSprayGun"),
          counterTargetId: "2-0",
        },
        { id: requestId, reactionId: responseId },
      )
    ).type,
    "state",
  );
  assert.equal(room.combats.length, 0);
  assert.equal(room.game.units.find((u) => u.id === "1-0").en, energy);
  const token = defender.joined.token;
  defender.close();
  await players[0].latest((s) => !s.connected[1]);
  defender = await client();
  await defender.hello("resume", code, token);
  assert.deepEqual(
    defender.state.counterPlans.find((p) => p.attacker === "1-0").weapons,
    Array(2).fill("EF_BeamSprayGun"),
  );
  await players[3].latest((s) => s.connected.every(Boolean) && s.pending?.target === "3-0");
  await players[3].act("respond", { response: "defend" });
  await defender.latest((s) => s.phase === "idle");
  const counters = room.combats.flatMap((b) => b.events).filter((e) => e.from === "1-0");
  assert.deepEqual(
    counters.map((e) => [e.weapon, e.to]),
    Array(2).fill(["EF_BeamSprayGun", "2-0"]),
  );
  const unit = room.game.units.find((u) => u.id === "1-0");
  assert.equal(room.game.team, 1); // 全员演出确认后，进入防守方自己的回合并重置反击次数。
  assert.equal(unit.en, energy - 50);
  const before = JSON.stringify(room.game.units);
  await defender.act(
    "respond",
    { response: "counter", counterIds: Array(2).fill("EF_BeamSprayGun"), counterTargetId: "2-0" },
    { id: requestId, reactionId: responseId },
  );
  assert.equal(JSON.stringify(room.game.units), before);
});

test("native hangars synchronize cargo, enforce ownership and capacity, deduplicate and resume", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "HANGARS");
  await red.hello("join", "HANGARS");
  await readyMatch(blue, red);
  const room = app.rooms.get("HANGARS"),
    carrier = room.game.units.find((u) => u.id === "0-0"),
    passenger = room.game.units.find((u) => u.id === "0-1");
  room.game.tiles.forEach((row) => row.fill("plain"));
  carrier.model = Object.keys(G.models).find((id) => id.startsWith("PegasusClass__"));
  Object.assign(carrier, { x: 10, y: 10, hp: G.modelOf(carrier).hp, en: G.modelOf(carrier).en });
  Object.assign(passenger, { x: 9, y: 10 });
  room.game.units
    .filter((u) => u !== carrier && u !== passenger)
    .forEach((u, i) => Object.assign(u, { x: 3, y: 3 + i }));
  const h = G.hangars.of(carrier)[0],
    requestId = randomUUID(),
    before = { hp: passenger.hp, en: passenger.en };
  assert.equal(
    (await red.act("embark", { unitId: passenger.id, carrierId: carrier.id, hangarId: h.id })).type,
    "error",
  );
  const boarded = await blue.act(
    "embark",
    { unitId: passenger.id, carrierId: carrier.id, hangarId: h.id },
    { id: requestId },
  );
  assert.equal(boarded.type, "state");
  assert(boarded.game.units.find((u) => u.id === passenger.id).embarked);
  await red.latest((s) => s.revision === room.revision);
  assert(!red.state.game.units.some((u) => u.id === passenger.id));
  const count = G.hangars.used(room.game, carrier, h.id);
  await blue.act(
    "embark",
    { unitId: passenger.id, carrierId: carrier.id, hangarId: h.id },
    { id: requestId },
  );
  assert.equal(G.hangars.used(room.game, carrier, h.id), count);
  assert.equal((await blue.act("wait", { unitId: passenger.id })).type, "error");
  assert.equal((await blue.act("launch", { unitId: passenger.id, x: 9, y: 10 })).type, "error");
  const token = blue.joined.token;
  blue.close();
  await red.latest((s) => !s.connected[0]);
  const restored = await client();
  await restored.hello("resume", "HANGARS", token);
  assert(restored.state.game.units.find((u) => u.id === passenger.id).embarked);
  assert.equal(passenger.hp, before.hp);
  assert.equal(passenger.en, before.en);
  G.end(room.game);
  G.end(room.game);
  const point = G.hangars.launchCells(room.game, passenger).find((p) => p.distance > 1);
  assert(point);
  const launched = await restored.act("launch", { unitId: passenger.id, x: point.x, y: point.y });
  assert.equal(launched.type, "state");
  assert(!passenger.embarked);
  assert(passenger.moved);
  assert(!passenger.acted);
  await red.latest((s) => s.revision === room.revision);
  assert(red.state.game.units.some((u) => u.id === passenger.id));
  assert(room.log.some((text) => text.includes("搭载至")));
  assert(room.log.some((text) => text.includes("出击至")));
});

test("saved formation preloads are authoritative through assembly, deployment and reconnect", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "PRELOAD");
  await red.hello("join", "PRELOAD");
  const m = Object.values(G.models).find((m) => m.prefabId === "PegasusClass"),
    h = m.hangars[0],
    gm = { unitId: "RGM_79", kitId: "machine_gun" },
    fleet = [
      { unitId: m.prefabId, kitId: m.kitId },
      { ...gm, customName: "预装[A01]", preload: { carrierIndex: 0, hangarId: h.id } },
    ];
  assert.equal(
    (
      await blue.act("configure_room", {
        ...G.defaultRoomSettings(),
        costLimit: 99999,
        unitCostLimit: 99999,
      })
    ).type,
    "state",
  );
  assert.equal((await blue.act("set_ready", { ready: true, formation: fleet })).type, "state");
  assert.equal((await red.act("set_ready", { ready: true, formation: [gm] })).type, "state");
  await confirmAssembly(blue, red);
  await blue.latest((s) => s.phase === "deployment");
  const room = app.rooms.get("PRELOAD"),
    cargo = room.game.units.find((u) => u.customName === "预装[A01]");
  const summaries = room.log.filter((line) => line.includes("部署编制："));
  assert.equal(summaries.length, 2);
  assert(
    summaries.some((line) =>
      line.includes(`2台 · 总计COST ${m.cost + G.models.RGM_79__machine_gun.cost}`),
    ),
  );
  assert(
    room.log.some(
      (line) => line.includes("预装[A01](RGM-79 吉姆) 编制：") && line.includes("预先搭载于"),
    ),
  );
  assert(blue.state.log.some((line) => line.includes(cargo.customName)));
  assert(!blue.state.log.some((line) => line.includes("[红方]")));
  assert(cargo?.embarked);
  assert.equal(cargo.embarked.carrierId, "0-0");
  assert(blue.state.game.units.some((u) => u.id === cargo.id));
  await red.latest((s) => s.revision === room.revision);
  assert(!red.state.game.units.some((u) => u.id === cargo.id));
  assert(red.state.log.some((line) => line.includes("[红方]")));
  assert(!red.state.log.some((line) => line.includes(cargo.customName)));
  const token = blue.joined.token;
  blue.close();
  await red.latest((s) => !s.connected[0]);
  const restored = await client();
  await restored.hello("resume", "PRELOAD", token);
  assert(restored.state.log.some((line) => line.includes(cargo.customName)));
  assert(!restored.state.log.some((line) => line.includes("[红方]")));
  assert.equal(room.log.filter((line) => line.includes("部署编制：")).length, 2);
  assert.deepEqual(
    restored.state.game.units.find((u) => u.id === cargo.id).embarked,
    cargo.embarked,
  );
  assert.equal((await restored.act("confirm_deployment")).type, "state");
  await red.latest((s) => s.revision === room.revision);
  assert.equal((await red.act("confirm_deployment")).type, "state");
  await restored.latest((s) => s.phase === "idle");
  const point = G.hangars.launchCells(room.game, cargo)[0];
  assert(point);
  assert.equal(
    (await restored.act("launch", { unitId: cargo.id, x: point.x, y: point.y })).type,
    "state",
  );
  assert(!cargo.embarked);
  assert.equal(cargo.customName, "预装[A01]");
});

test("personal unit sharing grants allied commands and responses, survives resume and resets on room return", async (t) => {
  const { players, room, client, code } = await multiRoom(t, "crossroads_2v2", 4, 3000);
  const [host, enemy, ally, enemyAlly] = players;
  await startMulti(players, room);
  room.game.tiles.forEach((r) => r.fill("plain"));
  room.game.units.forEach((u, i) =>
    Object.assign(u, { x: 10 + (i % 2) * 2, y: 8 + Math.floor(i / 2) * 3 }),
  );
  const shared = room.game.units.find((u) => G.ownerOf(u) === 2),
    target = room.game.units.find((u) => G.ownerOf(u) === 1);
  assert.equal((await host.act("wait", { unitId: shared.id })).type, "error");
  const id = randomUUID();
  assert.equal(
    (await ally.act("share_units", { memberId: host.joined.memberId }, { id })).type,
    "state",
  );
  assert(room.seats[2].shareUnits);
  assert(!room.seats[0].shareUnits);
  const logCount = room.log.length;
  await ally.act("share_units", {}, { id });
  assert.equal(room.log.length, logCount);
  await host.latest((s) => s.revision === room.revision);
  const destination = [...G.reachable(room.game, shared).values()].find((p) => p.path.length === 1);
  assert.equal(
    (await moveAndConfirm(host, { unitId: shared.id, x: destination.x, y: destination.y })).type,
    "state",
  );
  assert.equal(G.ownerOf(shared), 2);
  assert.equal(
    (await moveAndConfirm(host, { unitId: shared.id, x: destination.x, y: destination.y })).type,
    "error",
  );
  assert.equal((await host.act("undo", { unitId: shared.id })).type, "error");
  Object.assign(target, { x: shared.x + 2, y: shared.y });
  const weapon = G.modelOf(shared).weapons.find((w) => w.id === "EF_90mmMG");
  assert.equal(
    (await host.act("attack", { unitId: shared.id, targetId: target.id, weaponId: weapon.id }))
      .type,
    "state",
  );
  assert.equal((await host.act("cancel_attack", { unitId: shared.id })).type, "state");
  assert.equal(
    (await host.act("attack", { unitId: shared.id, targetId: target.id, weaponId: weapon.id }))
      .type,
    "state",
  );
  await enemy.latest((s) => s.revision === room.revision);
  assert.equal((await enemy.act("share_units")).type, "state");
  await finishPlans(host);
  await enemyAlly.latest((s) => s.phase === "reaction");
  const reactionId = enemyAlly.state.pending.id;
  assert.equal(enemyAlly.state.pending.target, target.id);
  assert.equal(
    (await enemyAlly.act("respond", { response: "defend" }, { reactionId })).type,
    "state",
  );
  assert.equal((await enemy.act("respond", { response: "defend" }, { reactionId })).type, "error");
  const token = ally.joined.token;
  ally.close();
  await host.latest((s) => !s.connected[2]);
  const resumed = await client();
  await resumed.hello("resume", code, token);
  assert(resumed.state.members.find((m) => m.seat === 2).shareUnits);
  await host.latest((s) => s.connected.every(Boolean));
  assert.equal((await host.act("return_room")).type, "state");
  assert(room.seats.every((m) => !m?.shareUnits));
});

test("room sharing is host controlled and never permits enemies or spectators to command units", async (t) => {
  const { players, room, client, code } = await multiRoom(t, "crossroads_2v2", 4, 3000);
  const [host, enemy, ally] = players;
  assert.equal(
    (await ally.act("configure_room", { ...room.settings, shareAlliedUnits: true })).type,
    "error",
  );
  assert.equal(
    (await host.act("configure_room", { ...room.settings, shareAlliedUnits: "true" })).type,
    "error",
  );
  assert.equal(
    (await host.act("configure_room", { ...room.settings, shareAlliedUnits: true })).type,
    "state",
  );
  await startMulti(players, room);
  const u = room.game.units.find((u) => G.ownerOf(u) === 2),
    enemyUnit = room.game.units.find((u) => G.ownerOf(u) === 1);
  assert.equal((await host.act("wait", { unitId: enemyUnit.id })).type, "error");
  const spectator = await client();
  await spectator.hello("join", code);
  assert.equal((await spectator.act("share_units")).type, "error");
  assert.equal((await spectator.act("wait", { unitId: u.id })).type, "error");
  await host.latest((s) => s.revision === room.revision);
  assert.equal((await host.act("wait", { unitId: u.id })).type, "state");
  assert(u.acted);
  assert.equal(G.ownerOf(u), 2);
});

test("flight stance is authoritative, deduplicated and synchronized without spending movement", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "FLIGHT");
  await guest.hello("join", "FLIGHT");
  const formation = [{ unitId: "Type61", kitId: "standard" }], licenses = { Type61: true };
  await readyMatch(host, guest, app, false, { formation, licenses });
  const room = app.rooms.get("FLIGHT"),
    u = room.game.units.find((u) => G.ownerOf(u) === 0);
  u.model = Object.keys(G.models).find((id) => id.startsWith("MS_07H__"));
  const fields = { unitId: u.id, skillId: "flight_stance", x: u.x, y: u.y };
  assert.equal((await guest.act("skill", fields)).type, "error");
  const id = randomUUID(),
    state = await host.act("skill", fields, { id });
  assert.equal(state.type, "state");
  assert.equal(u.flying, true);
  assert.equal(u.actionPoints, 4);
  assert.equal(u.moved, false);
  await guest.latest((s) => s.revision === state.revision);
  assert.equal(
    guest.state.game.units.some((x) => x.id === u.id),
    false,
  );
  await host.act("skill", fields, { id });
  assert.equal(u.actionPoints, 4);
  assert.equal(u.flying, true);
  const target = [...G.reachable(room.game, u).values()].find((p) => p.x !== u.x || p.y !== u.y);
  assert(target);
  assert.equal(
    (await moveAndConfirm(host, { unitId: u.id, x: target.x, y: target.y })).type,
    "state",
  );
  assert.equal(u.actionPoints, 4);
});

test("Chinese room names support creation, listing, joining and reconnect", async (t) => {
  const { client } = await setup(t),
    host = await client(),
    guest = await client(),
    lobby = await client();
  const name = "联机";
  assert.equal((await host.hello("create", name)).type, "joined");
  assert.equal(host.state.room, name);
  lobby.send({ type: "list_rooms" });
  assert((await lobby.wait((m) => m.type === "rooms")).rooms.some((r) => r.code === name));
  assert.equal((await guest.hello("join", name)).type, "joined");
  const token = guest.joined.token,
    member = guest.joined.memberId;
  guest.close();
  await host.latest((s) => !s.connected[1]);
  const resumed = await client();
  assert.equal((await resumed.hello("resume", name, token)).type, "joined");
  assert.equal(resumed.joined.memberId, member);
  const invalid = await client();
  assert.equal((await invalid.hello("create", "<房间>")).type, "error");
  assert.equal((await invalid.hello("create", "中".repeat(21))).type, "error");
});

test("unit renaming is rejected and deployment logs use formation ordinals with numbered teams", async (t) => {
  const {app,client}=await setup(t),a=await client(),b=await client();
  await a.hello("create","RENAME");await b.hello("join","RENAME");
  const formation=[{unitId:"Type61",kitId:"standard"}],licenses={Type61:true};
  await a.latest(s=>s.members.length===2);
  const ready=await a.act("set_ready",{ready:true,formation,licenses});assert.equal(ready.type,"state");
  await b.latest(s=>s.revision===ready.revision);
  assert.equal((await b.act("set_ready",{ready:true,formation,licenses})).type,"state");
  await confirmAssembly(a,b);
  const room=app.rooms.get("RENAME"),u=room.game.units[0],before=G.unitLogName(u);
  assert.match(before,/\[No\.1\]$/);
  for(const player of [a,b]){
    await player.latest(s=>s.revision===room.revision);
    assert.equal((await player.act("rename_unit",{unitId:u.id,name:"任意名称"})).type,"error");
  }
  assert.equal(G.unitLogName(u),before);
  assert.equal(u.customName,undefined);
  assert(room.log.some(line=>line.includes("[队伍1]")&&line.includes(before)));
  assert(room.log.some(line=>line.includes("[队伍2]")));
  assert(!room.log.some(line=>/蓝方|红方/.test(line)));
});

test("mortar accepts an empty cell over the network and rejects ordinary ground-target attacks", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "MORTARCELL");
  await red.hello("join", "MORTARCELL");
  await readyMatch(blue, red);
  const room = app.rooms.get("MORTARCELL"),
    a = room.game.units.find((u) => u.id === "0-0");
  Object.assign(a, { model: "RGC_80__machine_gun", x: 10, y: 10 });
  const w = G.modelOf(a).weapons.find((w) => w.special?.type === "mortar");
  const normal = G.modelOf(a).weapons.find((w) => !w.special);
  assert.equal(
    (await blue.act("attack", { unitId: a.id, targetCell: { x: 12, y: 10 }, weaponId: normal.id }))
      .type,
    "error",
  );
  assert.equal(
    (await blue.act("attack", { unitId: a.id, targetCell: { x: 16, y: 10 }, weaponId: w.id })).type,
    "state",
  );
  assert.deepEqual(a.plan.targetCell, { x: 16, y: 10 });
});

test("spectator perspective and permissioned log downloads work over WebSocket and survive reconnect", async (t) => {
  const { client, app } = await setup(t);
  const blue = await client(),
    red = await client(),
    watcher = await client();
  await blue.hello("create", "LOGVIEWS");
  await red.hello("join", "LOGVIEWS");
  await readyMatch(blue, red, app);
  await watcher.hello("join", "LOGVIEWS");
  const room = app.rooms.get("LOGVIEWS");
  room.teamLogs[0].unshift("blue-only");
  room.teamLogs[1].unshift("red-only");
  room.log.unshift("global-only");
  assert.equal((await blue.act("download_log", { perspective: "global" })).type, "error");
  const state = await watcher.act("spectate", { team: 1 });
  assert.equal(state.viewTeam, 1);
  assert.equal(state.game.intel.team, 1);
  assert.equal(state.log[0], "red-only");
  assert.equal((await watcher.act("download_log", { perspective: "team:1" })).log[0], "red-only");
  const token = watcher.joined.token;
  watcher.close();
  const resumed = await client();
  await resumed.hello("resume", "LOGVIEWS", token);
  assert.equal(resumed.state.viewTeam, 1);
  assert.equal((await resumed.act("download_log", { perspective: "team:0" })).type, "error");
  await blue.act("return_room");
  const full = await resumed.act("download_log", { perspective: "global" });
  assert.equal(full.type, "battle_log");
  assert.ok(full.log.includes("global-only"));
  assert.ok(
    (await resumed.act("download_log", { perspective: "team:0" })).log.includes("blue-only"),
  );
});

test("records replay over WebSocket with host controls, independent views and reconnect, without saving or takeover", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "RECORD");
  await guest.hello("join", "RECORD");
  await readyMatch(host, guest, app, false);
  const room = app.rooms.get("RECORD");
  assert.equal((await host.act("record_export", { perspective: "team:0" })).type, "record_reply");
  await host.act("return_room");
  assert.equal((await host.act("replay_open")).type, "record_reply");
  await guest.latest((s) => !!s.replay);
  const replayId = host.state.replay.id;
  assert.equal((await guest.act("replay_control", { replayId, playing: true })).type, "error");
  await guest.act("replay_view", { perspective: "team:1" });
  assert.equal(guest.state.replay.perspective, "team:1");
  const resumed = await client();
  await resumed.hello("resume", "RECORD", guest.joined.token);
  assert.equal(resumed.state.replay.id, replayId);
  assert.equal(resumed.state.replay.perspective, "team:1");
  for (const perspective of ["team:0", "team:1", "global"]) {
    const reply = await host.act("replay_log", { replayId, perspective });
    assert.equal(reply.type, "record_reply");
    const expected = require("../shared/match-records.js").view(
      room.replay.record,
      room.replay.record.frames.length - 1,
      perspective,
    ).log;
    assert.deepEqual(reply.log, expected);
  }
  assert.equal(
    (await resumed.act("replay_log", { replayId, perspective: "team:99" })).type,
    "error",
  );
  assert.equal(
    (await resumed.act("replay_log", { replayId: "stale", perspective: "global" })).type,
    "error",
  );
  const before = JSON.stringify(room.game),
    revision = room.revision;
  for (const action of ["replay_fork"]) {
    assert.equal(
      (await host.act(action, { replayId, index: 0, assignments: [host.joined.memberId, "ai"] }))
        .type,
      "error",
    );
    assert.equal(JSON.stringify(room.game), before);
    assert.equal(room.revision, revision);
    assert.equal(room.replay.id, replayId);
  }
  assert.equal((await host.act("replay_close")).type, "record_reply");
  await resumed.latest((s) => !s.replay);
  assert.equal(room.started, false);
});

async function moveAndConfirm(player, fields, override) {
  const preview = await player.act("move", fields, override);
  return preview.type === "state" ? player.act("confirm_move", { unitId: fields.unitId }) : preview;
}
test("movement preview preserves intel, survives reconnect, cancels atomically and confirms exactly once over WebSocket", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "PREVIEW");
  await red.hello("join", "PREVIEW");
  await readyMatch(blue, red, app, false);
  const room = app.rooms.get("PREVIEW");
  for (const unit of room.game.units)
    Object.assign(unit, { x: unit.team ? 45 : 0, y: 1 + Number(unit.id.split("-")[1]) });
  const own = room.game.units[0],
    enemy = room.game.units.find((unit) => unit.id === "1-0");
  Object.assign(own, { x: 4, y: 8 });
  Object.assign(enemy, { x: 19, y: 8 });
  room.game.tiles = room.game.tiles.map((row) => row.map(() => "plain"));
  const initial = await blue.act("sync"),
    original = structuredClone(initial.game.intel);
  const previewId = randomUUID();
  const preview = await blue.act("move", { unitId: own.id, x: 10, y: 8 }, { id: previewId });
  assert.equal(preview.type, "state");
  assert.equal(own.x, 4);
  assert.equal(own.pendingMove.x, 10);
  assert.deepEqual(preview.game.intel, original);
  const revision = room.revision;
  await blue.act("move", { unitId: own.id, x: 10, y: 8 }, { id: previewId });
  assert.equal(room.revision, revision);
  assert.equal((await blue.act("end_turn")).type, "error");
  assert.equal(
    (await blue.act("attack", { unitId: own.id, targetId: enemy.id, weaponId: "EF_BeamSprayGun" }))
      .type,
    "error",
  );
  const enemyView = await red.act("sync");
  assert.equal(enemyView.lastEvent, null);
  assert.equal(enemyView.effectEvent, null);
  assert.ok(!JSON.stringify(enemyView.game.units).includes('"pendingMove":{"'));
  const resumed = await client();
  await resumed.hello("resume", "PREVIEW", blue.joined.token);
  assert.equal(resumed.state.game.units.find((unit) => unit.id === own.id).pendingMove.x, 10);
  assert.deepEqual(resumed.state.game.intel, original);
  const cancelled = await resumed.act("cancel_move", { unitId: own.id });
  assert.equal(cancelled.type, "state");
  assert.equal(own.pendingMove, undefined);
  assert.deepEqual([own.x, own.y, own.moved], [4, 8, false]);
  assert.deepEqual(cancelled.game.intel, original);
  await resumed.act("move", { unitId: own.id, x: 10, y: 8 });
  const confirmId = randomUUID();
  const confirmed = await resumed.act("confirm_move", { unitId: own.id }, { id: confirmId });
  assert.equal(confirmed.type, "state");
  assert.equal(own.x, 10);
  assert.equal(own.moved, true);
  assert.equal(own.origin, null);
  assert.ok(confirmed.game.intel.visibleIds.includes(enemy.id));
  assert.ok(confirmed.game.intel.detectedIds.includes(enemy.id));
  const after = JSON.stringify(room.game),
    finalRevision = room.revision;
  await resumed.act("confirm_move", { unitId: own.id }, { id: confirmId });
  assert.equal(JSON.stringify(room.game), after);
  assert.equal(room.revision, finalRevision);
  assert.equal((await resumed.act("cancel_move", { unitId: own.id })).type, "error");
});

test("uploaded pilot portraits larger than 16 KiB synchronize to another client", async (t) => {
  const { client } = await setup(t),
    host = await client(),
    guest = await client(),
    watcher = await client();
  await host.hello("create", "PORTRAITS");
  await guest.hello("join", "PORTRAITS");
  await watcher.hello("join", "PORTRAITS");
  await host.latest((s) => s.members.length === 3);
  const P = require("../shared/pilots.js");
  const portrait = "data:image/jpeg;base64,/9j/" + "A".repeat(12000);
  const formation = [0, 1].map((i) => ({
    unitId: "Type61",
    kitId: "standard",
    customPilot: P.custom({
      ...P.createCustom("custom-portrait-" + i, "Pilot " + i, P.catalog.named[0].id, "PMC"),
      uploadedPortrait: portrait,
    }),
  }));
  assert(JSON.stringify(formation).length > 16384);
  let state = await host.act("set_ready", { ready: true, formation });
  assert.equal(state.type, "state", JSON.stringify(state));
  await guest.latest((s) => s.revision === state.revision);
  state = await guest.act("set_ready", {
    ready: true,
    formation: [{ unitId: "Type61", kitId: "standard" }],
  });
  assert.equal(state.type, "state");
  await startRoom(host);
  await watcher.latest((s) => s.phase === "assembly");
  const entries = watcher.state.assembly.players.find((p) => p.seat === host.joined.seat).entries;
  assert.equal(entries[0].customPilot.uploadedPortrait, portrait);
  await confirmAssembly(host, guest);
  await watcher.latest((s) => s.phase === "deployment");
  const pilots = watcher.state.game.units.filter((u) => u.pilot?.custom);
  assert.equal(pilots.length, 2);
  assert(pilots.every((u) => u.pilot.uploadedPortrait === portrait && u.pilot.faction === "PMC"));
});

test("researched technology sent with a formation unlocks its units on the server", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "RESEARCH");
  await guest.hello("join", "RESEARCH");
  await host.latest((s) => s.members.length === 2);
  const D = require("../shared/development.js");
  const node = D.nodes("EFSF").find(
    (n) => n.points > 0 && n.requires.every((id) => D.unlockedTech("EFSF").includes(id)),
  );
  const prefab = G.catalog.prefabs.find(
    (p) => node.unlocks.includes(p.id) && !D.allows("PMC", p.id),
  );
  const formation = [{ unitId: prefab.id, kitId: prefab.weaponKits[0].id }];
  const researched = { EFSF: [node.id] };
  const result = await host.act("set_ready", { ready: true, formation, researched });
  assert.equal(result.type, "state", JSON.stringify(result));
  const room = app.rooms.get("RESEARCH"),
    member = room.seats[host.joined.seat];
  assert.notEqual(
    G.planFormation(formation, Infinity, G.armyRestrictions(room.settings, member)).reasons[0],
    "not_developed",
  );
  assert.equal(
    G.planFormation(
      formation,
      Infinity,
      G.armyRestrictions(room.settings, { ...member, researched: {} }),
    ).reasons[0],
    "not_developed",
  );
});

for (const faction of ["EFSF", "ZEON", "PMC"])
  test(`AI full technology survives room assembly and deploys a funded ${faction} roster`, async (t) => {
    const { app, client } = await setup(t, { aiDelayMs: 10000 });
    const host = await client();
    await host.hello("create", "AITECH");
    const configured = await host.act("configure_room", {
      mapId:"frontier_1v1", costLimit:900, unitCostLimit:250, unitLimit:12,
      bannedEras:["0083"],
    });
    assert.equal(configured.type,"state",JSON.stringify(configured));
    assert.equal((await host.act("add_ai",{seat:1,characterFaction:faction})).type,"state");
    const room=app.rooms.get("AITECH");
    const readiness=await host.act("set_ready",{ready:true,
      formation:[{unitId:"Type61",kitId:"standard"}],inventory:{Type61:1}});
    assert.equal(readiness.type,"state",JSON.stringify(readiness));
    await startRoom(host);
    await confirmAssembly(host);
    const bot=room.seats[1],army=bot.formation;
    const restrictions=G.armyRestrictions(room.settings,bot);
    const cost=army.reduce((sum,e)=>sum+G.models[e.unitId+"__"+e.kitId].cost,0);
    assert(cost>=775&&cost<=900,String(cost));
    assert(G.formationPoints(army)<=12);
    assert(army.some(e=>!require("../shared/development.js").allows(faction,e.unitId,{})));
    assert(army.every(e=>!G.restrictionReason(G.models[e.unitId+"__"+e.kitId],restrictions)));
    assert.equal(room.game.units.filter(u=>G.ownerOf(u)===1).length,army.length);
    assert.equal(room.phase,"deployment");
  });

test("host changes AI faction without bypassing ownership or forced team faction", async (t) => {
  const { app, client } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "AIFACTIONS");
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 900 });
  await host.act("add_ai", { seat: 1 });
  await guest.hello("join", "AIFACTIONS");
  await host.latest((s) => s.members.length === 3);
  const room = app.rooms.get("AIFACTIONS"),
    bot = room.seats[1];
  const change = { seat: 1, config: {}, characterFaction: "EFSF" };
  assert.equal((await guest.act("configure_ai", change)).type, "error");
  assert.equal(bot.characterFaction, "ZEON");
  await host.act("sync");
  assert.equal((await host.act("configure_ai", change)).type, "state");
  assert.equal(bot.characterFaction, "EFSF");
  assert.equal(
    (await host.act("configure_ai", { ...change, characterFaction: "unknown" })).type,
    "error",
  );
  assert.equal(bot.characterFaction, "EFSF");
  const forced = await host.act("configure_room", {
    mapId: "crossroads_2v2",
    costLimit: 900,
    teamFactions: [null, "ZEON"],
  });
  assert.equal(forced.type, "state", JSON.stringify(forced));
  assert.equal(bot.characterFaction, "ZEON");
  assert.equal((await host.act("configure_ai", change)).type, "error");
  assert.equal(bot.characterFaction, "ZEON");
});

test("V36 multi-target requests are atomic, owner-checked, deduplicated and gated by both playback acknowledgments", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  blue.autoPlayback = red.autoPlayback = false;
  await blue.hello("create", "V36NETWORK");
  await red.hello("join", "V36NETWORK");
  const room = app.rooms.get("V36NETWORK"),
    entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const sync = async (c) => {
    await c.latest((s) => s.revision >= room.revision);
  };
  await sync(blue);
  assert.equal(
    (
      await blue.act("configure_room", {
        ...G.defaultRoomSettings(),
        fogMode: "disabled",
        costLimit: 900,
        unitCostLimit: 99999,
      })
    ).type,
    "state",
  );
  for (const c of [blue, red]) {
    await sync(c);
    const r = await c.act("set_ready", {
      ready: true,
      formation: [entry, entry],
      inventory: { RGM_79: 4 },
    });
    assert.equal(r.type, "state", JSON.stringify(r));
  }
  await confirmAssembly(blue, red);
  for (const c of [blue, red]) {
    await sync(c);
    assert.equal((await c.act("confirm_deployment")).type, "state");
  }
  const [a, ally, b, other] = room.game.units;
  [
    [a, 2, 3],
    [ally, 3, 4],
    [b, 4, 3],
    [other, 3, 3],
  ].forEach(([u, x, y]) => Object.assign(u, { x, y, hp: 100000, shield: 0 }));
  room.game.tiles.forEach((row) => row.fill("plain"));
  const gun = G.modelOf(a).weapons[0],
    sword = G.modelOf(a).weapons.find((w) => w.type === "melee"),
    head = G.modelOf(b).weapons.find((w) => G.actionCost(w) === 1);
  await sync(red);
  const rev = room.revision;
  assert.equal(
    (await red.act("attack", { unitId: a.id, orders: [{ targetId: b.id, weaponIds: [gun.id] }] }))
      .type,
    "error",
  );
  assert.equal(room.revision, rev);
  await sync(blue);
  assert.equal(
    (
      await blue.act("attack", {
        unitId: a.id,
        orders: [
          { targetId: b.id, weaponIds: [gun.id] },
          { targetId: other.id, weaponIds: [gun.id] },
        ],
      })
    ).type,
    "error",
  );
  assert.equal(room.plans.length, 0);
  assert.equal(a.actionPoints, G.actionBudget(a));
  const orders = [
    { targetId: b.id, weaponIds: [gun.id] },
    { targetId: other.id, weaponIds: [sword.id] },
  ];
  const valid = await blue.act("attack", { unitId: a.id, orders }, { id: "v36-atomic" });
  assert.equal(valid.type, "state", JSON.stringify(valid));
  const reserved = a.actionPoints;
  assert.equal(
    (await blue.act("attack", { unitId: a.id, orders }, { id: "v36-atomic", revision: rev })).type,
    "state",
  );
  assert.equal(room.plans.length, 2);
  assert.equal(a.actionPoints, reserved);
  assert.equal(
    (await blue.act("attack", { unitId: ally.id, targetId: b.id, weaponId: head.id })).type,
    "state",
  );
  await blue.act("end_turn");
  await sync(red);
  let replied = false;
  while (room.phase === "reaction") {
    const pending = red.state.pending;
    const response =
      pending.target === b.id
        ? {
            response: "counter",
            counterOrders: [a, ally].map((u) => ({ targetId: u.id, weaponIds: [head.id] })),
          }
        : { response: "defend" };
    const result = await red.act("respond", response);
    assert.equal(result.type, "state", JSON.stringify(result));
    replied = true;
  }
  assert(replied);
  assert.equal(room.phase, "playback");
  assert.deepEqual(
    room.combatBatch.map((b) => b.combatStage),
    ["attack", "attack", "attack", "counter"],
  );
  assert.deepEqual(
    room.combatBatch.at(-1).events.map((e) => e.to),
    [a.id, ally.id],
  );
  assert.equal(b.counterCount, 1);
  await sync(blue);
  const batchId = room.playback.id;
  await blue.act("playback_ready", { batchId });
  assert.equal(room.phase, "playback");
  await sync(red);
  await red.act("playback_ready", { batchId });
  assert.notEqual(room.phase, "playback");
});


test("native pilot weapon gates reject forged client stats and allow the server pilot threshold", async t => {
  const {app,client} = await setup(t);
  const blue = await client(), red = await client();
  await blue.hello("create", "PILOTGATE");
  await red.hello("join", "PILOTGATE");
  const liveRoom = app.rooms.get("PILOTGATE");
  const sync = c => c.latest(s => s.revision === liveRoom.revision);
  await blue.act("configure_room", {...G.defaultRoomSettings(),fogMode:"disabled"});
  for (const c of [blue,red]) {
    await sync(c);
    const reply = await c.act("set_ready",{ready:true,
      formation:[{unitId:"RGM_79",kitId:"machine_gun"}],inventory:{RGM_79:1}});
    assert.equal(reply.type,"state",JSON.stringify(reply));
  }
  await confirmAssembly(blue,red);
  for (const c of [blue,red]) { await sync(c); await c.act("confirm_deployment"); }
  await sync(blue);
  const room = app.rooms.get("PILOTGATE"), u = room.game.units.find(u=>u.id === "0-0"),
    target = room.game.units.find(u=>u.id === "1-0");
  const model = Object.values(G.models).find(m=>m.prefabId === "RX_78_2");
  Object.assign(u,{model:Object.keys(G.models).find(key=>G.models[key] === model),en:10000,shield:10000,x:5,y:5});
  u.pilot = {...u.pilot,stats:{...u.pilot.stats,melee:145}};
  Object.assign(target,{x:6,y:5});
  room.game.tiles[5][5] = room.game.tiles[5][6] = "plain";
  const weapon = model.weapons.find(w=>w.pilotRequirements);
  const before = [u.en,target.hp,room.revision,room.game.seed];
  const rejected = await blue.act("attack",{unitId:u.id,targetId:target.id,weaponId:weapon.id,
    pilot:{stats:{melee:200}},pilotRequirements:[]});
  assert.equal(rejected.type,"error");
  assert.deepEqual([u.en,target.hp,room.revision,room.game.seed],before);
  u.pilot.stats.melee = 146;
  assert.equal((await blue.act("attack",{unitId:u.id,targetId:target.id,weaponId:weapon.id})).type,"state");
  assert.equal(G.attackOrders(u)[0].weapons[0],weapon.id);
});


test("ejection spends one authoritative AP and rejects zero-AP or enemy requests", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "EJECTAP");
  await red.hello("join", "EJECTAP");
  const room = app.rooms.get("EJECTAP"),
    sync = (c) => c.latest((s) => s.revision === room.revision);
  await blue.act("configure_room", {
    ...G.defaultRoomSettings(),
    fogMode: "disabled",
  });
  for (const c of [blue, red]) {
    await sync(c);
    assert.equal(
      (
        await c.act("set_ready", {
          ready: true,
          formation: [{ unitId: "RGM_79", kitId: "machine_gun" }],
          inventory: { RGM_79: 1 },
        })
      ).type,
      "state",
    );
  }
  await confirmAssembly(blue, red);
  for (const c of [blue, red]) {
    await sync(c);
    await c.act("confirm_deployment");
  }
  await sync(blue);
  const u = room.game.units.find((u) => u.id === "0-0"),
    model = Object.values(G.models).find((m) => m.prefabId === "RX_78_1");
  Object.assign(u, {
    model: Object.keys(G.models).find((id) => G.models[id] === model),
    x: 5,
    y: 5,
    actionPoints: 0,
  });
  room.game.tiles[5][5] = room.game.tiles[5][6] = "plain";
  const fields = {
    unitId: u.id,
    skillId: "ExitUnit",
    x: 6,
    y: 5,
    actionPoints: 5,
    consumeAction: false,
  };
  const before = JSON.stringify(room.game),
    revision = room.revision;
  assert.equal((await blue.act("skill", fields)).type, "error");
  assert.equal(JSON.stringify(room.game), before);
  assert.equal(room.revision, revision);
  u.actionPoints = 3;
  await sync(red);
  assert.equal((await red.act("skill", fields)).type, "error");
  assert.equal(u.actionPoints, 3);
  await sync(blue);
  assert.equal((await blue.act("skill", fields)).type, "state");
  const craft = room.game.units.find((v) => v.ownerSeat === 0);
  assert.equal(craft.model, "FF_X7__standard");
  assert.equal(craft.actionPoints, 2);
  assert.equal(craft.acted, false);
  await sync(red);
  assert.equal(
    red.state.game.units.find((v) => v.id === craft.id).actionPoints,
    2,
  );
});


test("ACE shared attachment survives WebSocket deployment and earns native XP without manual stats", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "ACEONLINE");
  await red.hello("join", "ACEONLINE");
  const room = app.rooms.get("ACEONLINE"),
    sync = (c) => c.latest((s) => s.revision === room.revision),
    P = G.pilots;
  const profile = P.catalog.aces.find((p) => p.price),
    pilot = P.gainExperience(P.createAce(profile.id), profile.experienceBase);
  await blue.act("configure_room", {
    ...G.defaultRoomSettings(),
    fogMode: "disabled",
  });
  await sync(blue);
  const forged = structuredClone(pilot);
  forged.stats.shooting++;
  const ready = (p) => ({
    ready: true,
    formation: [
      {
        unitId: "RGM_79",
        kitId: "machine_gun",
        ...(p ? { customPilot: p } : {}),
      },
    ],
    inventory: { RGM_79: 1 },
  });
  assert.equal((await blue.act("set_ready", ready(forged))).type, "error");
  for (const [c, p] of [
    [blue, pilot],
    [
      red,
      P.gainExperience(P.createAce(profile.id), profile.experienceBase + 45),
    ],
  ]) {
    await sync(c);
    assert.equal((await c.act("set_ready", ready(p))).type, "state");
  }
  await confirmAssembly(blue, red);
  for (const c of [blue, red]) {
    await sync(c);
    await c.act("confirm_deployment");
  }
  const [a, b] = room.game.units;
  assert.equal(a.pilot.ace, true);
  assert.deepEqual(a.pilot.stats, pilot.stats);
  Object.assign(a, { x: 4, y: 5 });
  Object.assign(b, { x: 6, y: 5, hp: 1, shield: 0 });
  room.game.tiles[5][4] = room.game.tiles[5][6] = "plain";
  room.game.seed = 1;
  await sync(blue);
  const w = G.modelOf(a).weapons.find((w) => G.canAttack(room.game, a, b, w));
  assert(w);
  assert.equal(
    (await blue.act("attack", { unitId: a.id, targetId: b.id, weaponId: w.id }))
      .type,
    "state",
  );
  await blue.act("end_turn");
  await sync(red);
  assert.equal(
    (await red.act("respond", { response: "defend" })).type,
    "state",
  );
  assert.equal(b.hp, 0);
  assert.equal(a.pilot.level, 1);
  const award = room.pilotAwards.find(
    (a) => a.pilotId === pilot.id && a.kind === "kill",
  );
  assert(award?.experiencePoints > 0);
  assert.equal(a.pilot.experience, award.experiencePoints);
  await red.latest((s) =>
    s.pilotAwards.some((a) => a.pilotId === b.pilot.id && a.kind === "loss"),
  );
  const loss = red.state.pilotAwards.find(
    (a) => a.pilotId === b.pilot.id && a.kind === "loss",
  );
  assert.equal(loss.requiresRecruitment, true);
  assert.equal(b.pilot.needsRecruitment, true);
  assert.equal(b.pilot.level, 1);
  assert.equal(b.pilot.experience, 45);
  const archive = {
    pilots: [
      P.gainExperience(P.createAce(profile.id), profile.experienceBase + 45),
    ],
    awards: [],
  };
  P.creditAwards(archive, [loss]);
  assert.equal(archive.pilots[0].needsRecruitment, true);
  assert.equal(archive.pilots[0].experience, 45);
});


test("remote salvos enforce awakening, ownership, reservation and request deduplication over WebSocket", async t => {
  const {app,client}=await setup(t), blue=await client(), red=await client();
  await blue.hello('create','REMOTES');await red.hello('join','REMOTES');
  const room=app.rooms.get('REMOTES'),sync=c=>c.latest(s=>s.revision===room.revision);
  await blue.act('configure_room',{...G.defaultRoomSettings(),fogMode:'disabled'});
  for(const c of [blue,red]) {
    await sync(c);
    assert.equal((await c.act('set_ready',{ready:true,formation:[{unitId:'RGM_79',kitId:'machine_gun'}],inventory:{RGM_79:1}})).type,'state');
  }
  await confirmAssembly(blue,red);
  for(const c of [blue,red]){await sync(c);await c.act('confirm_deployment');}
  await sync(blue);
  const u=room.game.units[0],target=room.game.units[1];
  Object.assign(u,{model:'MAN_08__standard',hp:100000,en:1000,x:5,y:5});
  u.pilot={...u.pilot,stats:{...u.pilot.stats,awakening:74}};
  Object.assign(target,{x:8,y:5,hp:100000,shield:0});
  room.game.tiles.forEach(r=>r.fill('plain'));
  const weapon=G.modelOf(u).weapons.find(w=>w.remote), intent={unitId:u.id,targetId:target.id,weaponId:weapon.id};
  const initial=JSON.stringify(room.game),rev=room.revision;
  assert.equal((await blue.act('attack',{...intent,pilot:{stats:{awakening:200}},damage:999999,remote:{units:[]}})).type,'error');
  assert.equal(JSON.stringify(room.game),initial);assert.equal(room.revision,rev);
  await sync(red);assert.equal((await red.act('attack',intent)).type,'error');
  u.pilot.stats.awakening=75;
  await sync(blue);
  assert.equal((await blue.act('attack',intent,{id:'remote-once'})).type,'state');
  assert.equal(u.actionPoints,2);assert.equal(u.en,1000);assert.equal(room.plans.length,1);
  const reserved=JSON.stringify(room.game),reservedRev=room.revision;
  assert.equal((await blue.act('attack',intent,{id:'remote-once',revision:rev})).type,'state');
  assert.equal(JSON.stringify(room.game),reserved);assert.equal(room.revision,reservedRev);
  await sync(blue);assert.equal((await blue.act('end_turn')).type,'state');
  await sync(red);assert.equal(room.phase,'reaction');
  assert.equal((await red.act('respond',{response:'defend'})).type,'state');
  assert.equal(u.en,800);assert.equal(room.game.units.length,2);
  const event=room.combats.flatMap(combat=>combat.events).find(e=>e.weapon===weapon.id);
  assert.equal(event.strikes.length,10);
  assert.equal(new Set(event.strikes.map(s=>s.shotIndex)).size,10);
  assert.ok(target.hp<100000);assert.ok(u.en>=0);
});

test('default host disconnect immediately transfers to the first online human and reconnect keeps the new host',async t=>{
 const {client,app}=await setup(t);
 const host=await client(),guest=await client();
 await host.hello('create','HOSTIMMEDIATE');await guest.hello('join','HOSTIMMEDIATE');
 await host.latest(s=>s.members.length===2);
 const token=host.joined.token,oldId=host.joined.memberId;
 host.close();
 const next=await guest.latest(s=>s.hostId===guest.joined.memberId);
 assert(!next.connected[0]);
 const resumed=await client();await resumed.hello('resume','HOSTIMMEDIATE',token);
 assert.equal(resumed.joined.memberId,oldId);
 assert.equal(resumed.state.hostId,guest.joined.memberId);
 assert.equal(app.rooms.get('HOSTIMMEDIATE').hostId,guest.joined.memberId);
});

test('updated custom and ACE levels and XP survive room formation refresh and deployment snapshots',async t=>{
 const {client,app}=await setup(t),host=await client(),guest=await client();
 await host.hello('create','PILOTLEVEL');await guest.hello('join','PILOTLEVEL');
 await host.latest(s=>s.members.length===2);
 const e={unitId:'Type61',kitId:'standard'},licenses={Type61:true};
 const P=G.pilots,aceSource=require('../shared/pilots.json').aces.find(a=>a.price);
 let ace=P.createAce(aceSource.id),custom=P.createCustom('custom-level-network','Level');
 const formation=()=>[{...e,customPilot:ace},{...e,customPilot:custom}];
 await host.act('set_ready',{ready:true,formation:formation(),licenses});
 for(let i=0;i<3;i++){
  ace=P.upgrade(P.gainExperience(ace,Math.max(0,P.experienceRequired(ace.level,ace)-ace.experience)));
  custom=P.upgrade(P.gainExperience(custom,Math.max(0,P.experienceRequired(custom.level,custom)-custom.experience)));
 }
 assert.equal((await host.act('update_formation',{formation:formation(),licenses})).type,'state');
 await guest.latest(s=>s.revision===app.rooms.get('PILOTLEVEL').revision);
 await guest.act('set_ready',{ready:true,formation:[e],licenses});
 await host.latest(s=>s.revision===app.rooms.get('PILOTLEVEL').revision);
 await host.act('set_ready',{ready:true,formation:formation(),licenses});
 await confirmAssembly(host,guest);
 const room=app.rooms.get('PILOTLEVEL');
 for(const p of [ace,custom]){
  const actor=room.game.units.find(u=>u.pilot?.id===p.id);
  assert(actor);assert.equal(actor.pilot.level,3);assert.equal(actor.pilot.experience,p.experience);
  assert.deepEqual(actor.pilot.stats,p.stats);
  assert.equal(host.state.game.units.find(u=>u.id===actor.id).pilot.level,3);
 }
});

test('Big Zam beam arcs survive network planning and execution without rotating the hull or spending duplicate EN',async t=>{
 const {client,app}=await setup(t),host=await client(),guest=await client();
 await host.hello('create','ZAMARC');await guest.hello('join','ZAMARC');await host.latest(s=>s.members.length===2);
 await host.act('configure_room',{mapId:'asteroid_crossing_1v1',costLimit:6000,unitCostLimit:99999,fogMode:'disabled'});
 await host.act('set_ready',{ready:true,formation:[{unitId:'MA_08',kitId:'standard'}],licenses:{MA_08:true}});
 await guest.latest(s=>s.revision===app.rooms.get('ZAMARC').revision);
 await guest.act('set_ready',{ready:true,formation:[{unitId:'Type61',kitId:'standard'}],licenses:{Type61:true}});
 await confirmAssembly(host,guest);
 await host.act('confirm_deployment');await guest.latest(s=>s.revision===app.rooms.get('ZAMARC').revision);await guest.act('confirm_deployment');
 const room=app.rooms.get('ZAMARC'),[a,b]=room.game.units;
 room.game.tiles.forEach(r=>r.fill('plain'));
 Object.assign(a,{x:10,y:10,angle:0,actionPoints:5});
 const c=G.center(a);Object.assign(b,{x:c.x,y:c.y-4,hp:1000000,shield:0});
 room.turnNotBefore=0;
 await host.act('sync');
 const en=a.en;
 assert.equal((await host.act('attack',{unitId:a.id,targetId:b.id,weaponId:'ZN_MA_08_AA_BeamCannon'})).type,'state');
 assert.equal(a.angle,0);
 await finishPlans(host);
 await guest.latest(s=>s.phase==='reaction');
 assert.equal((await guest.act('respond',{response:'defend'})).type,'state');
 await host.latest(s=>s.phase==='playback');
 assert.equal(a.en,en-180);assert.equal(a.angle,0);
 const event=room.combatBatch.flatMap(c=>c.events).find(e=>e.weaponId==='ZN_MA_08_AA_BeamCannon'||e.weapon==='ZN_MA_08_AA_BeamCannon');
 assert(event);assert.equal(event.strikeCount,2);
});

test('finished WebSocket match writes one private server settlement JSON with all player totals',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'greed-ws-settlement-'));
 const {client,app}=await setup(t,{settlementDirectory:directory});
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const a=await client(),b=await client();await a.hello('create','AUDIT');await b.hello('join','AUDIT');await a.latest(s=>s.members.length===2);
 const entry={unitId:'Type61',kitId:'standard'},licenses={Type61:true};
 await a.act('configure_room',{fogMode:'disabled'});
 await a.act('set_ready',{ready:true,formation:[entry],licenses});await b.latest(s=>s.revision===app.rooms.get('AUDIT').revision);
 await b.act('set_ready',{ready:true,formation:[entry],licenses});await confirmAssembly(a,b);
 await a.act('confirm_deployment');await b.latest(s=>s.revision===app.rooms.get('AUDIT').revision);await b.act('confirm_deployment');
 const room=app.rooms.get('AUDIT'),[attacker,target]=room.game.units;
 room.game.tiles.forEach(r=>r.fill('plain'));Object.assign(attacker,{x:2,y:4});Object.assign(target,{x:4,y:4,hp:1,shield:0});room.game.seed=1;room.turnNotBefore=0;
 await a.act('sync');await a.act('attack',{unitId:attacker.id,targetId:target.id,weaponId:'EF_Type61_Cannon'});await finishPlans(a);
 await b.latest(s=>s.phase==='reaction');await b.act('respond',{response:'evade'});await a.latest(s=>s.phase==='finished');
 const files=fs.readdirSync(directory);assert.deepEqual(files,[room.matchId+'.json']);
 const file=path.join(directory,files[0]),saved=fs.readFileSync(file,'utf8'),record=JSON.parse(saved);
 assert.equal(record.version,require('../project.json').version);assert.equal(record.costLimit,room.settings.costLimit);assert.equal(record.players.length,2);
 for(const p of record.players)assert.equal(p.total.money,room.economyAwards.filter(a=>a.memberId===p.memberId).reduce((n,a)=>n+a.money,0));
 await a.act('sync');assert.equal(fs.readFileSync(file,'utf8'),saved);assert.doesNotMatch(saved,/token|secret|seed/i);
});


test("ten-AP rules enforce doubled weapon costs, extended reach and atomic refunds over WebSocket",async t=>{
 const {app,client}=await setup(t),blue=await client(),red=await client();
 await blue.hello("create","AP10");await red.hello("join","AP10");
 await blue.latest(s=>s.members.length===2);
 await blue.act("configure_room",{...G.defaultRoomSettings(),fogMode:"disabled"});
 await readyMatch(blue,red,app,false,{formation:[{unitId:"Type61",kitId:"standard",customPilot:G.pilots.createCustom("custom-ap-network","AP")}],licenses:{Type61:true}});
 const room=app.rooms.get("AP10"),[a,b]=room.game.units;
 room.game.tiles.forEach(row=>row.fill("plain"));Object.assign(a,{x:5,y:8});Object.assign(b,{x:10,y:8});
 assert.equal(a.actionPoints,10);
 const weapon=G.modelOf(a).weapons.find(w=>w.actionCost===4 && w.max>=5);assert(weapon);
 await blue.latest(s=>s.revision===room.revision);
 const before=room.revision;
 assert.equal((await blue.act("attack",{unitId:a.id,orders:[{targetId:b.id,weaponIds:[weapon.id,weapon.id,weapon.id]}]})).type,"error");
 assert.equal(room.revision,before);assert.equal(a.actionPoints,10);
 assert.equal((await blue.act("attack",{unitId:a.id,orders:[{targetId:b.id,weaponIds:[weapon.id,weapon.id]}]})).type,"state");
 assert.equal(a.actionPoints,2);
 assert.equal((await blue.act("cancel_attack",{unitId:a.id})).type,"state");assert.equal(a.actionPoints,10);
});


test("half-point AP survives authoritative WebSocket reservations and cancellation",async t=>{
 const {app,client}=await setup(t),blue=await client(),red=await client();
 await blue.hello("create","APHALF");await red.hello("join","APHALF");
 await blue.latest(s=>s.members.length===2);
 await blue.act("configure_room",{...G.defaultRoomSettings(),fogMode:"disabled",costLimit:6000,unitCostLimit:1200});
 await readyMatch(blue,red,app,false,{formation:[{unitId:"RX_78_2",kitId:"kit_1",customPilot:G.pilots.createCustom("custom-half-network","Half AP")}],licenses:{RX_78_2:true}});
 const room=app.rooms.get("APHALF"),[a,b]=room.game.units;
 room.game.tiles.forEach(row=>row.fill("plain"));Object.assign(a,{x:5,y:8});Object.assign(b,{x:7,y:8});
 assert.equal(a.actionPoints,10.5);
 const weapon=G.modelOf(a).weapons.find(w=>w.id==="EF_RX_78_2_BR");assert.equal(weapon.actionCost,4);
 await blue.latest(s=>s.revision===room.revision);
 const result=await blue.act("attack",{unitId:a.id,orders:[{targetId:b.id,weaponIds:[weapon.id,weapon.id]}]});
 assert.equal(result.type,"state");assert.equal(a.actionPoints,2.5);
 assert.equal(result.game.units.find(u=>u.id===a.id).actionPoints,2.5);
 assert.equal((await blue.act("cancel_attack",{unitId:a.id})).type,"state");
 assert.equal(a.actionPoints,10.5);
 assert.equal(G.counterActionBudget(a),8);
});
