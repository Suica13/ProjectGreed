const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const G = require("../shared/rules"),
  { createServer } = require("../server"),
  version = require("../project.json").version;
const entry = (id) => {
  const p = G.catalog.prefabs.find((p) => p.id === id);
  return { unitId: id, kitId: p.weaponKits[0].id };
};
test("deployed transports suppress air presentation and APC/SFS board an airborne carrier over water", () => {
  for (const id of [
    "Medea_DeployState",
    "MedeaKai_DeployState",
    "FatUncle_DeployState",
    "FatUncleKai_DeployState",
  ]) {
    const m = Object.values(G.models).find((m) => m.prefabId === id);
    assert(m.deployed);
    assert.equal(m.movementType, "ground");
    const art = G.catalog.units.find((u) => u.id.startsWith(id + "__"));
    assert.equal(art.presentation.thrusters, false);
    assert.equal(art.presentation.movement, "walk");
  }
  for (const id of [
    "Type74",
    "Type74Kai",
    "ZN_APC",
    "Cui",
    "SamsonGroundTransportTruck",
    "ZN_APC_WithMS",
    "DodaiYS",
    "BaseJabber",
    "Gator",
  ]) {
    const g = G.create(false, 1, [[entry("Medea"), entry(id)], [entry("Type61")]], false, {
      costLimit: 99999,
      unitCostLimit: 99999,
    });
    const carrier = g.units.find((u) => u.id === "0-0"),
      passenger = g.units.find((u) => u.id === "0-1");
    g.tiles.forEach((row) => row.fill("water"));
    g.deployment = [false, false];
    const cell = G.deploymentCells(g, 0, carrier).find((c) =>
      G.fits(g, carrier, c.x, c.y, carrier.angle, false, 0),
    );
    assert(cell, id + " carrier fits");
    Object.assign(carrier, cell);
    passenger.x = -20;
    passenger.y = -20;
    assert(
      G.hangars.canEmbark(g, passenger, carrier, "Hangar_1", true),
      id + " may enter carrier at deployment even if passenger cannot stand on water",
    );
    G.hangars.embark(g, passenger, carrier, "Hangar_1", true);
    assert.equal(passenger.embarked.carrierId, carrier.id);
  }
});
test("every rebuilt encounter shares staging areas, packs twelve-unit armies and retains detailed tiles", () => {
  const maps = Object.values(G.catalog.maps).filter((m) => m.encounterScale?.version === 4);
  assert.equal(maps.length, 17);
  for (const m of maps) {
    assert(m.height <= 36);
    assert.equal(m.tileMap.tilesets[0].image, "asset:biome-" + m.tileMap.biomeStyle.biome);
    for (let s = 2; s < m.spawns.length; s++)
      assert.deepEqual(m.deploymentAreas[s], m.deploymentAreas[s % 2]);
    const armies = Array.from({ length: m.spawns.length }, () =>
        Array.from({ length: 12 }, () => entry(m.environment === "space" ? "MS_06F" : "Type61")),
      ),
      g = G.create(false, 123, armies, true, {
        mapId: m.id,
        costLimit: 99999,
        unitCostLimit: 99999,
      });
    assert.equal(g.units.length, m.spawns.length * 12, m.id);
    const positions = new Set(g.units.map((u) => u.x + "," + u.y));
    assert.equal(positions.size, g.units.length, m.id);
  }
  assert.equal(
    G.models.RGM_79_E__standard?.cost ||
      G.models["RGM_79_E__" + G.catalog.prefabs.find((p) => p.id === "RGM_79_E").weaponKits[0].id]
        .cost,
    150,
  );
  for (const id of ["MS_06G", "MS_06R_2", "MS_06R_2_JonCustom"])
    assert.equal(
      G.catalog.prefabs.find((p) => p.id === id).weaponKits.find((k) => k.id === "kit_2").cost,
      50,
    );
});
test("WebSocket assembly can be unconfirmed and edited; team markers stay private, validate coordinates and deduplicate", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1", aiDelayMs: 999999 }),
    address = await app.listen(),
    clients = [];
  t.after(async () => {
    for (const c of clients) c.ws.terminate();
    await app.close();
  });
  async function connect(mode) {
    const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/ws"),
      frames = [],
      listeners = new Set();
    let state;
    ws.on("message", (data) => {
      const m = JSON.parse(data);
      frames.push(m);
      if (m.type === "state") state = m;
      for (const f of listeners) f();
    });
    function wait(predicate, from = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(run);
          reject(Error("Timeout: " + JSON.stringify(frames.at(-1))));
        }, 8000);
        function run() {
          const m = frames.slice(from).find(predicate);
          if (m) {
            clearTimeout(timer);
            listeners.delete(run);
            resolve(m);
          }
        }
        listeners.add(run);
        run();
      });
    }
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        type: "hello",
        version,
        mode,
        room: "CURRENTCHANGES",
        roomMode: "battlefield",
        characterFaction: "PMC",
        licenses: { Medea: true, Type61: true },
        inventory: { Medea: 5, Type61: 10 },
      }),
    );
    await wait((m) => m.type === "state");
    const c = {
      ws,
      frames,
      get state() {
        return state;
      },
      async act(action, fields = {}, id = randomUUID()) {
        const room = app.rooms.get("CURRENTCHANGES"),
          from = frames.length;
        ws.send(
          JSON.stringify({
            type: "action",
            id,
            revision: room.revision,
            round: room.game.round,
            matchId: room.matchId,
            phase: room.phase,
            action,
            ...fields,
          }),
        );
        return wait(
          (m) =>
            (m.ack === id && ["state", "chat"].includes(m.type)) ||
            (m.type === "error" && m.id === id),
          from,
        );
      },
    };
    clients.push(c);
    return c;
  }
  const host = await connect("create"),
    enemy = await connect("join"),
    ally = await connect("join");
  assert.equal(host.state.you.seat, 2);
  assert.equal(ally.state.you.seat, 4);
  const formation = [entry("Medea"), entry("Type61")];
  assert.equal(
    (
      await host.act("configure_room", {
        ...host.state.settings,
        battlefieldEra: "custom",
        costLimit: 10000,
        unitCostLimit: 2000,
      })
    ).type,
    "state",
  );
  for (const c of [enemy, ally])
    assert.equal(
      (await c.act("set_ready", { ready: true, formation: [entry("Type61")] })).type,
      "state",
    );
  assert.equal((await host.act("start_game", { formation })).phase, "assembly");
  await host.act("confirm_formation");
  assert.equal(
    host.state.assembly.players.find((p) => p.memberId === host.state.you.id).ready,
    true,
  );
  const cancelId = randomUUID();
  await host.act("confirm_formation", { ready: false }, cancelId);
  await host.act("confirm_formation", { ready: false }, cancelId);
  assert.equal(
    host.state.assembly.players.find((p) => p.memberId === host.state.you.id).ready,
    false,
  );
  const preload = [
    entry("Medea"),
    { ...entry("Type61"), preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
  ];
  const changed = await host.act("update_formation", { formation: preload });
  assert.equal(changed.type, "state");
  assert.deepEqual(
    changed.assembly.players.find((p) => p.memberId === host.state.you.id).entries[1].preload,
    preload[1].preload,
  );
  await host.act("confirm_formation");
  await enemy.act("confirm_formation");
  assert.equal((await ally.act("confirm_formation")).phase, "deployment");
  const room = app.rooms.get("CURRENTCHANGES"),
    id = randomUUID(),
    marker = { kind: "attack", x: 10, y: 10 };
  const message = await host.act("chat", { channel: "team1", message: "进攻 K11", marker }, id);
  assert.equal(message.type, "chat");
  assert.deepEqual(message.message.marker, { ...marker, matchId: room.matchId });
  await host.act("chat", { channel: "team1", message: "进攻 K11", marker }, id);
  assert.equal(room.chat.filter((m) => m.id === message.message.id).length, 1);
  await new Promise((r) => setTimeout(r, 30));
  assert(ally.frames.some((m) => m.type === "chat" && m.message.marker));
  assert(!enemy.frames.some((m) => m.type === "chat" && m.message.marker));
  for (const fields of [
    { channel: "all", marker },
    { channel: "team1", marker: { ...marker, x: -1 } },
    { channel: "team1", marker: { ...marker, kind: "cheat" } },
    { channel: "team1", marker, matchId: "other" },
  ]) {
    room.seats[2].chatAt = 0;
    assert.equal((await host.act("chat", { message: "标记", ...fields })).type, "error");
  }
});
