const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createServer } = require("../server");
const version = require("../project.json").version;
const G = require("../shared/rules");
for (const presetId of [null,"0079T1-cost-1500","0079T2-cost-10000","0087T1-cost-1500","0087T2-cost-20000"]) test("network PMC players receive one authoritative battlefield result / "+(presetId || "custom"), async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1", aiDelayMs: 999999 });
  const address = await app.listen(),
    sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
  });
  async function client(mode) {
    const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/ws");
    sockets.push(ws);
    const frames = [],
      listeners = new Set();
    let state = null;
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw);
      frames.push(frame);
      if (frame.type === "state") state = frame;
      for (const notify of listeners) notify();
    });
    const wait = (predicate, from = 0) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(run);
          reject(Error("battlefield frame timeout: " + JSON.stringify(frames.at(-1))));
        }, 5000);
        const run = () => {
          const frame = frames.slice(from).find(predicate);
          if (frame) {
            clearTimeout(timeout);
            listeners.delete(run);
            resolve(frame);
          }
        };
        listeners.add(run);
        run();
      });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        type: "hello",
        version,
        mode,
        room: "BFNETWORK",
        roomMode: "battlefield",
        characterFaction: "PMC",
        licenses: { Medea: true },
        inventory: {Medea:5},
        kits: {},
      }),
    );
    await wait((frame) => frame.type === "joined");
    await wait((frame) => frame.type === "state");
    return {
      get state() {
        return state;
      },
      frames,
      async act(action, fields = {}) {
        const id = randomUUID(),
          from = frames.length;
        // Read the server revision in this harness so independent human acknowledgements do not race.
        const room = app.rooms.get("BFNETWORK");
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
          (frame) =>
            (frame.type === "state" && frame.ack === id) ||
            (frame.type === "error" && frame.id === id),
          from,
        );
      },
    };
  }
  const host = await client("create"),
    guest = await client("join");
  assert.equal(host.state.you.seat, 2);
  assert.equal(guest.state.you.seat, 3);
  assert.equal((await host.act("remove_ai", { seat: 1 })).type, "error");
  if (presetId) {
    const patch = G.battlefieldMode.presetSettings(presetId,host.state.settings.battlefieldTeams,G.eras);
    const configured = await host.act("configure_room",{...host.state.settings,...patch});
    assert.equal(configured.type,"state");
    assert.equal(G.battlefieldMode.roomPreset(configured.settings).id,presetId);
    assert.equal(configured.settings.battlefieldEra, patch.battlefieldEra);
    assert.equal((await host.act("configure_room",{...configured.settings,costLimit:patch.costLimit+25})).type,"error");
    const custom = await host.act("configure_room",{...configured.settings,battlefieldEra:"custom",costLimit:patch.costLimit+25});
    assert.equal(custom.type,"state");
    assert.equal(custom.settings.battlefieldEra,"custom");
    assert.equal((await host.act("configure_room",configured.settings)).type,"state");
    assert.equal((await guest.act("configure_room",{...configured.settings,costLimit:1})).type,"error");
  }
  const formation = [{ unitId: "Medea", kitId: "standard" }];
  assert.equal((await guest.act("set_ready", { ready: true, formation })).type, "state");
  assert.equal((await host.act("start_game", { formation })).phase, "assembly");
  await host.act("confirm_formation");
  assert.equal((await guest.act("confirm_formation")).phase, "deployment");
  await host.act("confirm_deployment");
  assert.equal((await guest.act("confirm_deployment")).phase, "idle");
  const room = app.rooms.get("BFNETWORK");
  assert.equal(room.seats[0].bot, true);
  assert.equal(room.seats[1].bot, true);
  assert.deepEqual(room.stockReservations, {});
  for (const unit of room.game.units.filter(unit => unit.ownerSeat >= 2)) unit.hp = 0;
  G.battlefieldMode.sync(G, room.game);
  const reserves = room.game.battlefield.reserves;
  const own = reserves.find(item => item.ownerSeat === 2), enemy = reserves.find(item => item.ownerSeat === 3);
  const hostView = (await host.act("sync")).game.battlefield.reserves;
  const guestView = (await guest.act("sync")).game.battlefield.reserves;
  assert.deepEqual(hostView.map(item => item.id), [own.id]);
  assert.deepEqual(guestView.map(item => item.id), [enemy.id]);
  assert.equal(hostView[0].template, undefined);
  room.game.round = own.readyRound;
  const site = G.battlefieldMode.deploymentSites(G, room.game, 0)[0];
  assert.equal((await host.act("battlefield_deploy", { reserveId: enemy.id, siteId: site.id })).type, "error");
  const queued = await host.act("battlefield_deploy", { reserveId: own.id, siteId: site.id });
  assert.equal(queued.type, "state");
  assert.equal(queued.game.battlefield.reserves[0].request.arrivalRound, room.game.round + 1);
  room.game.round++; G.battlefieldMode.advance(G, room.game);
  const arrival = (await host.act("sync")).game.units.find(unit => unit.id.startsWith("pmc-airdrop-"));
  assert(arrival?.hp > 0 && arrival.ownerSeat === 2);
  room.game.units.find((unit) => unit.team === 1 && unit.facility?.type === "base").hp = 0;
  const result = await host.act("wait", {
    unitId: arrival.id,
    single: true,
  });
  assert.equal(result.phase, "finished");
  assert.equal(result.game.winner, 0);
  assert.deepEqual(result.game.battlefield.strength, [
    G.battlefieldMode.eraStrength[room.settings.battlefieldTeams[0].era] - G.models.Medea__standard.cost, 0]);
  assert.equal(result.game.seed, undefined);
  assert.equal(result.game.partSeed, undefined);
  assert.equal(room.economyAwards.filter(award => award.kind === "result").length, 2);
  for (const award of room.economyAwards.filter(award=>award.kind === "result")) {
    const player=room.members.get(award.memberId);
    const expected=G.battlefieldMode.baseReward(room.settings,G.seatTeam(player.seat));
    assert.equal(award.money,expected.money);assert.equal(award.supplies,expected.supplies);
  }
  assert.deepEqual(room.techAwards, []);
  const again = await host.act("sync");
  assert.deepEqual(again.game.battlefield.strength, result.game.battlefield.strength);
});
