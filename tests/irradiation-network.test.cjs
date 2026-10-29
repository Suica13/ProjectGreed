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
      inventory: { RGM_79: 3 },
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
          kitId: "machine_gun",
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
async function readyMatch(first, second, app = first.app, stage = true) {
  first.app = second.app = app;
  await first.latest((s) => s.members.filter((member) => member.seat !== null).length === 2);
  const ready = await first.act("set_ready", { ready: true });
  assert.equal(ready.type, "state", JSON.stringify(ready));
  await second.latest((s) => s.revision >= ready.revision);
  assert.equal((await second.act("set_ready", { ready: true })).type, "state");
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

test("irradiation is authoritative, deduplicated, visible through fog and waits for every playback acknowledgement", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client(),
    watch = await client();
  await blue.hello("create", "BEAM");
  await red.hello("join", "BEAM");
  await watch.hello("join", "BEAM");
  await watch.act("switch_seat", { seat: null });
  await readyMatch(blue, red);
  for (const c of [blue, red, watch]) c.autoPlayback = false;
  const room = app.rooms.get("BEAM"),
    g = room.game,
    u = g.units.find((u) => u.id === "0-0"),
    target = g.units.find((u) => u.id === "1-0");
  u.model = Object.keys(G.models).find((id) => G.models[id].prefabId === "RX_78_4_Bst");
  Object.assign(u, { x: 3, y: 8, en: G.modelOf(u).en, actionPoints: 5, acted: false });
  Object.assign(target, { x: 12, y: 8, hp: 1000000 });
  for (const other of g.units)
    if (other !== u && other !== target)
      Object.assign(other, { x: other.team ? 22 : 1, y: other.team ? 16 : 2 });
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "full";
  u.brokenParts = { head: true };
  assert.equal(G.sensors.visible(g, 0, target), false);
  const skill = G.unitSkills(u).find((s) => s.type === "irradiation"),
    en = u.en,
    actionId = randomUUID();
  const result = await blue.act(
    "skill",
    { unitId: u.id, skillId: skill.id, x: 4, y: 8 },
    { id: actionId },
  );
  assert.equal(result.type, "state");
  assert.equal(result.phase, "playback");
  assert.equal(u.en, en * 0.5);
  assert.equal(
    result.playback.skillEffect.hits.some((h) => h.unitId === target.id),
    false,
  );
  assert.equal(
    result.playback.skillEffect.actors.some((a) => a.id === target.id),
    false,
  );
  assert.ok(result.playback.skillEffect.to.x > u.x);
  assert.equal(
    result.game.units.some((a) => a.id === target.id),
    false,
  );
  const same = await blue.act(
    "skill",
    { unitId: u.id, skillId: skill.id, x: 4, y: 8 },
    { id: actionId, revision: 0 },
  );
  assert.equal(same.playback.id, result.playback.id);
  assert.equal(u.en, en * 0.5);
  await red.latest((s) => s.phase === "playback");
  await watch.latest((s) => s.phase === "playback");
  assert.ok(red.state.playback.skillEffect);
  assert.ok(watch.state.playback.skillEffect);
  for (const c of [blue, red]) {
    await c.latest((s) => s.revision === room.revision);
    assert.equal((await c.act("playback_ready", { batchId: room.playback.id })).phase, "playback");
  }
  await watch.latest((s) => s.revision === room.revision);
  const end = await watch.act("playback_ready", { batchId: room.playback.id });
  assert.equal(end.phase, "idle");
  assert.equal(end.game.team, 0);
  assert.equal(end.game.round, g.round);
  assert.equal(room.irradiationHits, null);
  assert.equal(room.irradiationActors, null);
});

test("burn waits through planning and sync, then ticks once at its owner team turn end", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "BURN");
  await red.hello("join", "BURN");
  await readyMatch(blue, red);
  const room = app.rooms.get("BURN"),
    g = room.game,
    u = g.units.find((u) => u.id === "1-0"),
    source = g.units.find((u) => u.id === "0-0");
  u.burning = { expiresRound: g.round + 6, hpPercent: 5, sourceId: source.id };
  const hp = u.hp;
  assert.equal((await blue.act("wait", { unitId: source.id })).type, "state");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await blue.act("sync");
  assert.equal(u.hp,hp);
  assert.equal((await blue.act("end_turn")).type,"state");
  assert.equal(u.hp,hp);
  await red.latest(s=>s.revision===room.revision);
  room.turnNotBefore=0;
  assert.equal((await red.act("end_turn")).type,"state");
  assert.equal(hp-u.hp,Math.round(G.modelOf(u).hp*.05));
  assert.equal(g.turnEffects.filter(e=>e.type==='burn').length,1);
  await blue.latest(s=>s.revision===room.revision);
  await blue.act('sync');
  assert.equal(hp-u.hp,Math.round(G.modelOf(u).hp*.05));

});

test("irradiation settles a destroyed carrier and trapped passengers exactly once", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "CARRIER");
  await red.hello("join", "CARRIER");
  await readyMatch(blue, red);
  blue.autoPlayback = red.autoPlayback = false;
  const room = app.rooms.get("CARRIER"),
    g = room.game,
    u = g.units.find((a) => a.id === "0-0"),
    carrier = g.units.find((a) => a.id === "1-0"),
    passenger = g.units.find((a) => a.id === "1-1");
  u.model = Object.keys(G.models).find((id) => G.models[id].prefabId === "RX_78_4_Bst");
  carrier.model = Object.keys(G.models).find((id) => G.models[id].prefabId === "Medea");
  for (const other of g.units) Object.assign(other, { x: other.team ? 20 : 1, y: 16 });
  Object.assign(u, { x: 3, y: 8, en: G.modelOf(u).en, actionPoints: 5, acted: false });
  Object.assign(carrier, { x: 8, y: 8, hp: 1, shield: 0 });
  Object.assign(passenger, {
    x: 8,
    y: 8,
    embarked: { carrierId: carrier.id, hangarId: "Hangar_1" },
  });
  g.tiles.forEach((row) => row.fill("rock"));
  g.fogMode = "disabled";
  g.seed = 1;
  const skill = G.unitSkills(u).find((s) => s.type === "irradiation");
  const result = await blue.act("skill", { unitId: u.id, skillId: skill.id, x: 4, y: 8 });
  assert.equal(result.type, "state", JSON.stringify(result));
  assert.equal(carrier.hp, 0);
  assert.equal(passenger.hp, 0);
  for (const actor of [carrier, passenger]) {
    assert.ok(room.economyDefeats.has(actor.id));
    assert.equal(
      room.economyAwards.filter((award) => award.targetId === actor.id && award.kind === "kill")
        .length,
      1,
    );
  }
});

test("smoke cost and area are authoritative and repeated requests cannot spend twice", async (t) => {
  const { app, client } = await setup(t),
    blue = await client(),
    red = await client();
  await blue.hello("create", "SMOKE");
  await red.hello("join", "SMOKE");
  await readyMatch(blue, red);
  const room = app.rooms.get("SMOKE"),
    g = room.game,
    u = g.units.find((a) => a.id === "0-0"),
    enemy = g.units.find((a) => a.id === "1-0");
  u.model = Object.keys(G.models).find((id) => G.models[id].prefabId === "YMT_05");
  Object.assign(u, { x: 5, y: 8, en: 100, actionPoints: 5, acted: false });
  Object.assign(enemy, { x: 6, y: 8 });
  const skill = G.unitSkills(u).find((s) => s.type === "smoke"),
    id = randomUUID();
  const result = await blue.act(
    "skill",
    { unitId: u.id, skillId: skill.id, x: u.x, y: u.y, en: 999999 },
    { id },
  );
  assert.equal(result.type, "state", JSON.stringify(result));
  assert.equal(u.en, 0);
  assert.equal(u.actionPoints, 3);
  assert.equal(result.game.smokeFields.length, 1);
  assert.ok(G.smokeAt(g, enemy));
  const again = await blue.act(
    "skill",
    { unitId: u.id, skillId: skill.id, x: u.x, y: u.y },
    { id, revision: 0 },
  );
  assert.equal(again.revision, result.revision);
  assert.equal(g.smokeFields.length, 1);
  assert.equal(u.en, 0);
  await red.latest((s) => s.revision === room.revision);
  assert.equal(
    (await red.act("skill", { unitId: u.id, skillId: skill.id, x: u.x, y: u.y })).type,
    "error",
  );
});


test("turn-end burning credits a destroyed carrier and trapped passengers exactly once", async t=>{
  const {app,client}=await setup(t),blue=await client(),red=await client();
  await blue.hello('create','BURNCARRIER');await red.hello('join','BURNCARRIER');
  await readyMatch(blue,red);
  const room=app.rooms.get('BURNCARRIER'),g=room.game;
  assert.equal((await blue.act('end_turn')).type,'state');
  const source=g.units.find(u=>u.id==='0-0'),carrier=g.units.find(u=>u.id==='1-0'),passenger=g.units.find(u=>u.id==='1-1');
  carrier.model=Object.keys(G.models).find(id=>G.models[id].prefabId==='Medea');
  Object.assign(carrier,{hp:1,shield:0,burning:{expiresRound:g.round+6,hpPercent:5,sourceId:source.id}});
  Object.assign(passenger,{embarked:{carrierId:carrier.id,hangarId:'Hangar_1'}});
  g.tiles.forEach(row=>row.fill('rock'));
  room.turnNotBefore=0;
  await red.latest(s=>s.revision===room.revision);
  assert.equal((await red.act('end_turn')).type,'state');
  for(const actor of [carrier,passenger]){
    assert.equal(actor.hp,0);
    assert.equal(room.economyAwards.filter(a=>a.targetId===actor.id&&a.kind==='kill').length,1);
  }
});
