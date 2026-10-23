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
  wait(pred, from = 0) {
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
      }, 3000);
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
    clients.push(c);
    await c.open();
    return c;
  };
  return { app, client, port: address.port };
}
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
  await blue.latest((s) => s.started);
  assert.equal(blue.state.phase, "idle");
  assert.ok(!("seed" in blue.state.game));
  let third = await client();
  assert.equal((await third.hello("join", "TEST1")).type, "error");
  assert.equal((await red.act("move", { unitId: "1-0", x: 9, y: 1 })).type, "error");
  assert.equal((await blue.act("move", { unitId: "1-0", x: 9, y: 1 })).type, "error");
  let move = await blue.act("move", { unitId: "0-0", x: 5, y: 1 });
  assert.equal(move.game.units[0].x, 5);
  assert.equal((await blue.act("move", { unitId: "0-0", x: 6, y: 1 })).type, "error");
  let undo = await blue.act("undo", { unitId: "0-0" });
  assert.equal(undo.game.units[0].x, 1);
  move = await blue.act("move", { unitId: "0-0", x: 5, y: 1 });
  let attack = await blue.act("attack", {
    unitId: "0-0",
    targetId: "1-0",
    weaponId: "br",
  });
  await red.latest((s) => s.revision === attack.revision);
  assert.equal(attack.phase, "reaction");
  assert.equal((await blue.act("respond", { response: "defend" })).type, "error");
  assert.equal((await blue.act("end_turn")).type, "error");
  let bad = await red.act("respond", { response: "counter", counterId: "bs" });
  assert.equal(bad.type, "error");
  assert.equal(app.rooms.get("TEST1").game.units[0].en, 100);
  let responseId = randomUUID(),
    fight = await red.act("respond", { response: "counter", counterId: "bz" }, { id: responseId });
  assert.equal(fight.phase, "battle");
  assert.equal(fight.game.units[0].en, 84);
  assert.equal(fight.game.units[3].ammo.bz, 3);
  assert.equal(fight.battle.events.length, 2);
  await blue.latest((s) => s.revision === fight.revision);
  assert.deepEqual(blue.state.game, fight.game);
  let duplicate = await red.act(
    "respond",
    { response: "counter", counterId: "bz" },
    { id: responseId, revision: attack.revision },
  );
  assert.equal(duplicate.game.units[3].ammo.bz, 3);
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
test("two network clients can finish a complete match through the real protocol", async (t) => {
  let { client } = await setup(t),
    clients = [await client(), await client()];
  await clients[0].hello("create", "MATCH");
  await clients[1].hello("join", "MATCH");
  await clients[0].latest((s) => s.started);
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
