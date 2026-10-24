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
    this.ws.on("message", (data) => {
      const m = JSON.parse(data);
      this.frames.push(m);
      if (m.type === "state") this.state = m;
      if (m.type === "joined") this.joined = m;
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
  async hello(mode, room, token) {
    let from = this.frames.length;
    this.send({ type: "hello", mode, room, token });
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
      ...fields,
      ...override,
    });
    return this.wait(
      (m) =>
        (m.type === "state" && m.ack === (override.id || id)) ||
        (m.type === "error" && m.id === (override.id || id)),
      from,
    );
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
    const remaining = await lobby.wait(
      (m) => m.type === "rooms" && m.rooms[0]?.players === 0,
      from,
    );
    assert.equal(remaining.rooms[0].joinable, true);
    const resumed = await new Client(url).open();
    try {
      await resumed.hello("resume", "LOBBY", guest.joined.token);
      resumed.send({ type: "leave" });
      await lobby.wait((m) => m.type === "rooms" && m.rooms.length === 0, from);
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
async function setup(t) {
  let app = createServer({ port: 0, host: "127.0.0.1" }),
    address = await app.listen(),
    url = "ws://127.0.0.1:" + address.port + "/ws",
    clients = [];
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
function stageCombat(app, code) {
  const game = app.rooms.get(code).game;
  for (const unit of game.units) {
    unit.x = unit.team ? 10 : 2;
    unit.y = 4 - Number(unit.id.split("-")[1]);
    game.tiles[unit.y][unit.x] = "plain";
  }
}
async function readyMatch(first, second, app = first.app, stage = true) {
  await first.latest((s) => s.members.filter((member) => member.seat !== null).length === 2);
  const ready = await first.act("set_ready", { ready: true });
  assert.equal(ready.type, "state");
  await second.latest((s) => s.revision >= ready.revision);
  assert.equal((await second.act("set_ready", { ready: true })).type, "state");
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
  assert.equal(s.phase, "deployment");
  assert.equal(s.game.units.length, 3);
  assert.equal(s.game.units[0].hp, 21000);
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
  // 连发仍由服务器一次结算：9 × 725，再应用防御减半；重发不能再扣弹药或 HP。
  await blue.latest((v) => v.revision === s.revision && v.connected.every(Boolean));
  app.rooms.get("SQUADS").game.seed = 1;
  stageCombat(app, "SQUADS");
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  const incoming = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "EF_90mmMG",
  });
  await resumed.latest((v) => v.revision === incoming.revision);
  const burstId = randomUUID();
  const burst = await resumed.act("respond", { response: "defend" }, { id: burstId });
  assert.equal(burst.phase, "battle");
  assert.equal(burst.battle.events[0].shotCount, 9);
  assert.equal(burst.battle.events[0].damagePerShot, 725);
  // (725 - 75 shell protection) * 90% * 9 rounds * 50% defend.
  const event = burst.battle.events[0];
  assert.equal(event.strikes.length, 9);
  assert.ok(event.strikes.some((s) => s.hit) && event.strikes.some((s) => !s.hit));
  assert.equal(
    event.damage,
    event.strikes.reduce((sum, s) => sum + s.damage, 0),
  );
  assert.equal(burst.game.units[0].en, 90);
  assert.equal("ammo" in burst.game.units[0], false);
  const duplicate = await resumed.act(
    "respond",
    { response: "defend" },
    { id: burstId, revision: incoming.revision },
  );
  assert.deepEqual(duplicate.game, burst.game);
  assert.deepEqual(duplicate.battle.events, burst.battle.events);
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
  assert.ok(switched.members.every((member) => !member.ready));
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

test("spectators do not gate battle confirmation and can replace a vacated team mid battle", async (t) => {
  const { client } = await setup(t);
  const blue = await client(),
    red = await client(),
    spectator = await client();
  await blue.hello("create", "REPLACE");
  await red.hello("join", "REPLACE");
  await spectator.hello("join", "REPLACE");
  await blue.latest((s) => s.members.length === 3);
  await red.latest((s) => s.members.length === 3);
  await readyMatch(blue, red);
  await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  const attack = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "EF_BeamSprayGun",
  });
  await red.latest((s) => s.revision === attack.revision);
  const battle = await red.act("respond", { response: "counter", counterId: "EF_HypeBazooka" });
  await blue.latest((s) => s.revision === battle.revision);
  await spectator.latest((s) => s.revision === battle.revision);
  assert.equal((await spectator.act("battle_ready", { battleId: battle.battle.id })).type, "error");
  await blue.act("battle_ready", { battleId: battle.battle.id });
  const vacated = await red.act("switch_seat", { seat: null });
  assert.equal(vacated.connected[1], false);
  assert.equal(vacated.phase, "battle");
  await spectator.latest((s) => s.revision === vacated.revision);
  const joined = await spectator.act("switch_seat", { seat: 1 });
  assert.equal(joined.you.seat, 1);
  assert.equal(joined.battle.ready[1], false);
  await red.latest((s) => s.revision === joined.revision);
  assert.equal((await red.act("battle_ready", { battleId: battle.battle.id })).type, "error");
  const done = await spectator.act("battle_ready", { battleId: battle.battle.id });
  assert.equal(done.phase, "idle");
  assert.deepEqual(done.game, battle.game);
  await red.latest((s) => s.revision === done.revision);
  assert.deepEqual(red.state.game, done.game);
});
test("authoritative rooms, combat, duplicate protection, phases, reconnect", async (t) => {
  const { app, client, port } = await setup(t),
    blue = await client(),
    red = await client();
  assert.equal((await fetch("http://127.0.0.1:" + port + "/health")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:" + port + "/")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:" + port + "/server.js")).status, 404);
  await blue.hello("create", "TEST1");
  assert.equal(blue.joined.seat, 0);
  assert.equal((await blue.act("end_turn")).type, "error");
  await red.hello("join", "TEST1");
  assert.equal(red.joined.seat, 1);
  await readyMatch(blue, red);
  assert.equal(blue.state.phase, "idle");
  assert.ok(!("seed" in blue.state.game));
  let third = await client();
  assert.equal((await third.hello("join", "TEST1")).seat, null);
  assert.equal((await third.act("end_turn")).type, "error");
  await blue.latest((s) => s.revision >= third.state.revision);
  assert.equal((await red.act("move", { unitId: "1-0", x: 9, y: 1 })).type, "error");
  assert.equal((await blue.act("move", { unitId: "1-0", x: 9, y: 1 })).type, "error");
  let move = await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  assert.equal(move.game.units[0].x, 5);
  assert.equal((await blue.act("move", { unitId: "0-0", x: 6, y: 1 })).type, "error");
  let undo = await blue.act("undo", { unitId: "0-0" });
  assert.equal(undo.game.units[0].x, 2);
  move = await blue.act("move", { unitId: "0-0", x: 5, y: 4 });
  let attack = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "EF_BeamSprayGun",
  });
  await red.latest((s) => s.revision === attack.revision);
  assert.equal(attack.phase, "reaction");
  assert.equal((await blue.act("respond", { response: "defend" })).type, "error");
  assert.equal((await blue.act("end_turn")).type, "error");
  let bad = await red.act("respond", { response: "counter", counterId: "EF_BeamSaber_A" });
  assert.equal(bad.type, "error");
  assert.equal(app.rooms.get("TEST1").game.units[0].en, 100);
  let responseId = randomUUID(),
    fight = await red.act(
      "respond",
      { response: "counter", counterId: "EF_HypeBazooka" },
      { id: responseId },
    );
  assert.equal(fight.phase, "battle");
  assert.equal(fight.game.units[0].en, 88);
  assert.equal(fight.game.units[3].en, 82);
  assert.equal(fight.battle.events.length, 2);
  await blue.latest((s) => s.revision === fight.revision);
  assert.deepEqual(blue.state.game, fight.game);
  let duplicate = await red.act(
    "respond",
    { response: "counter", counterId: "EF_HypeBazooka" },
    { id: responseId, revision: attack.revision },
  );
  assert.equal(duplicate.game.units[3].en, 82);
  let battle = fight.battle.id;
  let ack0 = await blue.act("battle_ready", { battleId: battle });
  assert.equal(ack0.phase, "battle");
  let ack1 = await red.act("battle_ready", { battleId: battle });
  assert.equal(ack1.phase, "idle");
  await blue.latest((s) => s.revision === ack1.revision);
  let stale = await blue.act("end_turn", {}, { revision: 0 });
  assert.equal(stale.code, "STALE");
  assert.equal(app.rooms.get("TEST1").game.team, 0);
  let end = await blue.act("end_turn");
  assert.equal(end.game.team, 1);
  await red.latest((s) => s.game.team === 1);
  const token = red.joined.token;
  red.close();
  await blue.latest((s) => !s.connected[1]);
  let paused = await blue.act("wait", { unitId: "0-1" });
  assert.equal(paused.type, "error");
  let replacement = await client();
  await replacement.hello("resume", "TEST1", token);
  assert.equal(replacement.joined.seat, 1);
  assert.equal(replacement.state.game.team, 1);
  await blue.latest((s) => s.connected.every(Boolean));
  assert.deepEqual(blue.state.game, replacement.state.game);
  let stranger = await client();
  assert.equal((await stranger.hello("resume", "TEST1", "incorrect")).type, "error");
  let wait = await replacement.act("wait", { unitId: "1-0" });
  assert.equal(wait.game.units[3].acted, true);
  let sameSession = await client();
  await sameSession.hello("resume", "TEST1", token);
  assert.equal(sameSession.state.game.units[3].acted, true);
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
  let { client } = await setup(t),
    clients = [await client(), await client()];
  await clients[0].hello("create", "MATCH");
  await clients[1].hello("join", "MATCH");
  await readyMatch(clients[0], clients[1], undefined, false);
  let moves = 0,
    battles = 0,
    turns = 0;
  for (let actions = 0; actions < 400; actions++) {
    let snapshot = clients[0].state,
      g = snapshot.game;
    if (g.winner !== null && snapshot.phase === "finished") {
      assert.ok(battles > 5);
      assert.ok(moves > 0);
      console.log(
        "network match:",
        moves,
        "moves,",
        battles,
        "engagements,",
        turns,
        "phase switches",
      );
      return;
    }
    let team = g.team,
      c = clients[team];
    await c.latest((s) => s.revision >= snapshot.revision);
    g = c.state.game;
    let u = g.units.find((u) => u.team === team && u.hp > 0 && !u.acted);
    if (!u) {
      let r = await c.act("end_turn");
      assert.equal(r.type, "state");
      await clients[1 - team].latest((s) => s.revision >= r.revision);
      turns++;
      continue;
    }
    let choice = G.aiChoice(g, u);
    if (choice && (choice.x !== u.x || choice.y !== u.y) && !u.moved) {
      let r = await c.act("move", { unitId: u.id, x: choice.x, y: choice.y });
      assert.equal(r.type, "state");
      g = r.game;
      u = g.units.find((x) => x.id === u.id);
      moves++;
    }
    let best = null;
    for (let b of g.units.filter((x) => x.team !== team && x.hp > 0))
      for (let w of G.models[u.model].weapons)
        if (G.canAttack(g, u, b, w)) {
          let e = G.estimate(g, u, b, w),
            score = e.hit * e.damage;
          if (!best || score > best.score) best = { b, w, score };
        }
    if (best) {
      let attack = await c.act("attack", {
          unitId: u.id,
          targetId: best.b.id,
          weaponId: best.w.id,
        }),
        defender = clients[1 - team];
      await defender.latest((s) => s.revision >= attack.revision);
      let response = G.bestResponse(g, u, best.b, best.w),
        result = await defender.act("respond", {
          response: response.response,
          counterId: response.weapon,
        });
      assert.equal(result.type, "state");
      await c.latest((s) => s.revision >= result.revision);
      assert.deepEqual(c.state.game, defender.state.game);
      await c.act("battle_ready", { battleId: result.battle.id });
      let done = await defender.act("battle_ready", {
        battleId: result.battle.id,
      });
      await c.latest((s) => s.revision >= done.revision);
      battles++;
    } else {
      let r = await c.act("wait", { unitId: u.id });
      assert.equal(r.type, "state");
      await clients[1 - team].latest((s) => s.revision >= r.revision);
    }
    await clients[0].latest(
      (s) => s.revision >= Math.max(clients[0].state.revision, clients[1].state.revision),
    );
  }
  assert.fail("network match failed to terminate");
});
