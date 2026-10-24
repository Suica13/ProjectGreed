const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws"),
  { createServer } = require("../server.js"),
  G = require("../shared/rules.js");
class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.frames = [];
    this.listeners = new Set();
    this.state = null;
    this.joined = null;
    this.playbackAcks = new Set();
    this.autoPlayback = true;
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
    this.send({ type: "hello", mode, room, token, name });
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
        ((m.type === "state" || m.type === "chat") && m.ack === (override.id || id)) ||
        (m.type === "error" && m.id === (override.id || id)),
      from,
    );
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

test("public lobby lists safe room summaries and tracks joins, disconnects and explicit exits", async () => {
  const app = createServer({ port: 0, host: "127.0.0.1" });
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
      costLimit: 3000,
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
  let app = createServer({ port: 0, host: "127.0.0.1", ...options }),
    address = await app.listen(),
    url = "ws://127.0.0.1:" + address.port + "/ws",
    clients = [];
  app.testClients = clients;
  t.after(async () => {
    clients.forEach((c) => c.close());
    await app.close();
  });
  const client = async () => {
    let c = new Client(url);
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
    unit.x = unit.team ? 9 : 2;
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
async function readyMatch(first, second, app = first.app, stage = true) {
  first.app = second.app = app;
  await first.latest((s) => s.members.filter((member) => member.seat !== null).length === 2);
  const ready = await first.act("set_ready", { ready: true });
  assert.equal(ready.type, "state");
  await second.latest((s) => s.revision >= ready.revision);
  assert.equal((await second.act("set_ready", { ready: true })).type, "state");
  await confirmAssembly(first, second);
  await first.latest((s) => s.started);
  const placed = await first.act("deploy", { unitId: "0-0", x: 3, y: 8 });
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
  assert.equal(s.game.units.length, 3);
  assert.equal(s.game.units[0].hp, 16500);
  assert.equal(s.game.units[0].model, "RGM_79__machine_gun");
  assert.equal((await blue.act("end_turn")).type, "error");
  assert.equal((await watcher.act("confirm_deployment")).type, "error");
  for (const fields of [
    { unitId: "1-0", x: 2, y: 4 },
    { unitId: "0-0", x: 6, y: 4 },
    { unitId: "0-0", x: 1, y: 3 },
  ])
    assert.equal((await blue.act("deploy", fields)).type, "error");
  const id = randomUUID();
  s = await blue.act("deploy", { unitId: "0-0", x: 3, y: 8 }, { id });
  assert.equal(
    (await blue.act("deploy", { unitId: "0-0", x: 3, y: 8 }, { id, revision: 0 })).revision,
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
  assert.equal(resumed.state.game.units[0].x, 3);
  s = await resumed.act("confirm_deployment");
  assert.equal(s.phase, "idle");
  assert.ok(!("seed" in s.game));
  assert.doesNotMatch(JSON.stringify(s), /"token"/);
  // 连发仍由服务器逐发结算并应用加成与防护；重发不能再扣 EN 或 HP。
  await blue.latest((v) => v.revision === s.revision && v.connected.every(Boolean));
  app.rooms.get("SQUADS").game.seed = 1900;
  stageCombat(app, "SQUADS");
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
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
  assert.equal(burst.game.units[0].en, 87.5);
  assert.equal("ammo" in burst.game.units[0], false);
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
  assert.equal((await first.act("move", { unitId: "0-0", x: 2, y: 1 })).type, "error");
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
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
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
  assert.deepEqual(blue.state.game, done.game);
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
  assert.equal((await red.act("move", { unitId: "1-0", x: 9, y: 4 })).type, "error");
  assert.equal((await blue.act("move", { unitId: "1-0", x: 9, y: 4 })).type, "error");
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  await blue.act("undo", { unitId: "0-0" });
  assert.equal(app.rooms.get("TEST1").game.units[0].x, 2);
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  const plan = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "EF_BeamSprayGun",
  });
  assert.equal(plan.phase, "idle");
  assert.equal(plan.game.units[0].en, 100);
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
test("server automatically ends an exhausted turn after one second, cancels on undo, and pauses on disconnect", async (t) => {
  const { client, app } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "AUTOTURN");
  await red.hello("join", "AUTOTURN");
  await readyMatch(blue, red);
  await blue.act("wait", { unitId: "0-1" });
  await blue.act("wait", { unitId: "0-2" });
  await blue.act("move", { unitId: "0-0", x: 1, y: 4 });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(blue.state.game.team, 0);
  await blue.act("undo", { unitId: "0-0" });
  await new Promise((r) => setTimeout(r, 750));
  assert.equal(blue.state.game.team, 0);
  const started = Date.now();
  await blue.act("move", { unitId: "0-0", x: 1, y: 4 });
  const next = await blue.latest((s) => s.game.team === 1);
  assert.ok(Date.now() - started >= 1000);
  assert.equal(next.game.round, 2);
  assert.equal(next.lastEvent.automatic, true);
  assert.equal(next.lastEvent.fromTeam, 0);
  await red.latest((s) => s.game.team === 1);
  for (const unitId of ["1-0", "1-1", "1-2"]) await red.act("wait", { unitId });
  const token = blue.joined.token;
  blue.close();
  await red.latest((s) => !s.connected[0]);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(app.rooms.get("AUTOTURN").game.team, 1);
  const resumed = await client();
  await resumed.hello("resume", "AUTOTURN", token);
  const final = await red.wait(
    (s) => s.type === "state" && s.game.team === 0,
    red.frames.length,
    6000,
  );
  assert.equal(final.game.round, 3);
  assert.equal(final.lastEvent.automatic, true);
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
        (await player.act("move", { unitId: u.id, x: choice.x, y: choice.y })).type,
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

test("player IDs are validated before creating a room and empty rooms dissolve when everyone disconnects", async (t) => {
  const { client, app } = await setup(t, { hostReconnectMs: 40 }),
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
  assert.equal(room.chat.length, 1);
  const spectator = await watch.act("chat", { message: "観戦中" });
  assert.equal(spectator.type, "chat");
  assert.equal(spectator.message.name, "Watcher");
  assert.equal(room.chat.length, 2);
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
  assert.deepEqual((await red.act("sync")).log, returned.log);
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
  assert.deepEqual(blue.state.log.slice(1), finished.log.slice(0, 79));
  assert.deepEqual(red.state.log, blue.state.log);
});

test("a later unit movement commits earlier moves and rejects undo through the authoritative protocol", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "UNDO02");
  await red.hello("join", "UNDO02");
  await readyMatch(blue, red);
  const room = app.rooms.get("UNDO02"),
    [a, other] = room.game.units;
  const first = await blue.act("move", { unitId: a.id, x: 3, y: 4 });
  assert.ok(first.game.units[0].origin);
  const second = await blue.act("move", { unitId: other.id, x: 2, y: 4 });
  assert.equal(second.game.units[0].origin, null);
  const before = JSON.stringify(room.game),
    revision = room.revision;
  assert.equal((await blue.act("undo", { unitId: a.id })).type, "error");
  assert.equal(JSON.stringify(room.game), before);
  assert.equal(room.revision, revision);
  assert.equal(new Set(room.game.units.map((u) => u.x + "," + u.y)).size, room.game.units.length);
  const undone = await blue.act("undo", { unitId: other.id });
  assert.equal(undone.game.units[1].y, 3);
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
    Object.assign(a, { x: 2, y: 3 + i });
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
  assert.equal(changed.chat[0].text, "Settings chat");
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
  assert.equal(other.state.settings.costLimit, 3000);
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
  assert.equal(room.game.tiles.length, 36);
  const controller = players[4],
    own = room.game.units.find((u) => G.ownerOf(u) === 4 && G.reachable(room.game, u).size > 1),
    destination = [...G.reachable(room.game, own).values()].find((cell) => cell.path.length > 0);
  assert.ok(destination);
  const moved = await controller.act("move", {
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
  assert.ok(bots.reduce((sum, u) => sum + G.models[u.model].cost, 0) <= 3000);
  assert.equal((await host.act("remove_ai", { seat: 1 })).type, "error");
  await host.act("confirm_deployment");
  const a = room.game.units.find((u) => u.id === "0-0"),
    b = bots[0];
  Object.assign(a, { x: 5, y: 5, hp: 100000 });
  Object.assign(b, { x: 6, y: 5, hp: 100000, en: 1000 });
  room.game.tiles[5][5] = room.game.tiles[5][6] = "plain";
  const weapon = G.models[a.model].weapons.find((w) => w.type === "melee");
  const counter = G.bestResponse(room.game, a, b, weapon);
  await host.act("attack", { unitId: a.id, targetId: b.id, weaponId: weapon.id });
  await finishPlans(host);
  await host.latest((s) => s.combats.length > 0);
  assert.equal(room.battle, null);
  if (counter.response === "counter") assert.equal(room.combats.at(-1).events.length, 2);
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
    assert.ok(formation.length > 0 && formation.length <= 12);
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
  await host.latest((s) => s.game.units.filter((u) => G.ownerOf(u) === 2).every((u) => u.acted));
  assert.equal(room.game.team, 0);
  assert.ok(room.game.units.some((u) => G.ownerOf(u) === 0 && !u.acted));
  assert.equal(room.turnDone[0], false);
  await host.latest((state) => state.turnDone[2]);
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
      c.state.chat.map((m) => m.text),
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
    switched.chat.map((m) => m.text),
    ["red secret", "public message"],
  );
  const replay = await say(ally, "team1", "green secret", { id: retryId });
  assert.equal(replay.type, "error");
  assert.ok(!JSON.stringify(replay).includes("green secret"));
  const resumed = await client();
  await resumed.hello("resume", "CHANNELS", ally.joined.token);
  assert.deepEqual(
    resumed.state.chat.map((m) => m.text),
    ["red secret", "public message"],
  );
  const joined = await observer.act("join_team", { team: 0 });
  assert.equal(joined.you.seat, 2);
  assert.deepEqual(
    joined.chat.map((m) => m.text),
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
  assert.equal(red.state.chat.length, 0);
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
    { fill: 200 },
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
  await host.act("configure_room", { mapId: "crossroads_2v2", costLimit: 700, unitCostLimit: 500 });
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
  assert.equal(own.deployCost, 600);
  const resumed = await client();
  await resumed.hello("resume", "OVERCOST", host.joined.token);
  assert.deepEqual(resumed.state.assembly.players.find((p) => p.seat === 0).disabled, [0]);
  await guest.latest((s) => s.revision === room.revision);
  await confirmAssembly(resumed, guest);
  assert.deepEqual(
    room.game.units.filter((u) => u.ownerSeat === 0).map((u) => u.id),
    ["0-1", "0-2", "0-3"],
  );
  assert.equal((await resumed.act("deploy", { unitId: "0-0", x: 3, y: 8 })).type, "error");
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
  for (const unitLimit of [2, 13, 3.5, "12"]) {
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
  assert.equal(deployment.game.units.length, 6);
});

test("room and team restrictions are authoritative, preserve readiness, constrain AI and exclude disabled IDs at deployment", async (t) => {
  const { client, app } = await setup(t),
    host = await client(),
    guest = await client();
  await host.hello("create", "TAGLIMIT");
  await guest.hello("join", "TAGLIMIT");
  await host.latest((s) => s.members.length === 2);
  assert.equal(host.state.settings.costLimit, 3000);
  assert.equal(host.state.settings.unitCostLimit, 500);
  const settings = {
    ...host.state.settings,
    mapId: "crossroads_2v2",
    costLimit: 600,
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
    assert.equal(G.planFormation(army, 600, restrictions).disabled.length, 0);
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
    (await guest.act("configure_ai", { seat: 1, config: { countPercent: 200 } })).type,
    "error",
  );
  const original = JSON.stringify(room.seats[1].aiSettings),
    revision = room.revision;
  for (const countPercent of [25, 110, 225, "200", null])
    assert.equal(
      (await host.act("configure_ai", { seat: 1, config: { countPercent } })).type,
      "error",
    );
  assert.equal(JSON.stringify(room.seats[1].aiSettings), original);
  assert.equal(room.revision, revision);
  await host.act("set_ready", { ready: true });
  await host.act("configure_ai", { seat: 1, config: { countPercent: 200 } });
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
  assert.equal(resumed.state.members.find((m) => m.seat === 1).aiSettings.countPercent, 200);
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
  assert.equal(room.seats[1].formation.length, 24);
  assert.equal(room.seats[2].formation.length, 6);
  await confirmAssembly(resumed, guest);
  assert.equal(room.phase, "deployment");
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 1).length, 24);
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 2).length, 6);
  assert.equal(new Set(room.game.units.map((u) => u.x + "," + u.y)).size, room.game.units.length);
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
