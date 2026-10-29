const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createServer } = require("../server.js"),
  G = require("../shared/rules.js");
const version = require("../project.json").version;
async function peer(url, mode) {
  const ws = new WebSocket(url),
    frames = [],
    listeners = new Set();
  let state;
  ws.on("message", (data) => {
    const m = JSON.parse(data);
    frames.push(m);
    if (m.type === "state") state = m;
    for (const fn of listeners) fn();
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  function wait(predicate, from = 0) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(Error("WS timeout: " + JSON.stringify(frames.at(-1))));
      }, 4000);
      function check() {
        const m = frames.slice(from).find(predicate);
        if (m) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(m);
        }
      }
      listeners.add(check);
      check();
    });
  }
  ws.send(
    JSON.stringify({
      type: "hello",
      version,
      characterFaction: "PMC",
      room: "SFSTEST",
      mode,
      inventory: { RGM_79: 5 },
      name: mode,
    }),
  );
  await wait((m) => m.type === "joined");
  await wait((m) => m.type === "state");
  async function act(action, fields = {}, id = randomUUID()) {
    // Let the other peer's broadcast reach this socket before taking its revision.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const from = frames.length;
    ws.send(
      JSON.stringify({
        type: "action",
        action,
        id,
        revision: state.revision,
        round: state.game.round,
        matchId: state.matchId,
        ...fields,
      }),
    );
    return wait((m) => m.ack === id || (m.type === "error" && m.id === id), from);
  }
  return { ws, act, wait };
}
test("real WebSocket SFS boarding, duplicate confirmation, passenger combat ownership and launch cancellation", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const host = await peer(url, "create"),
    guest = await peer(url, "join");
  t.after(async () => {
    host.ws.terminate();
    guest.ws.terminate();
    await app.close();
  });
  const e = { unitId: "RGM_79", kitId: "machine_gun" };
  const hostReady = await host.act("set_ready", { ready: true, formation: [e, e] });
  assert.equal(hostReady.type, "state", JSON.stringify(hostReady));
  const guestReady = await guest.act("set_ready", { ready: true, formation: [e] });
  assert.equal(guestReady.type, "state", JSON.stringify(guestReady));
  for (const [player, action] of [
    [host, "start_game"],
    [host, "confirm_formation"],
    [guest, "confirm_formation"],
  ]) {
    const result = await player.act(action);
    assert.equal(result.type, "state", JSON.stringify(result));
  }
  const hostDeploy = await host.act("confirm_deployment"),
    guestDeploy = await guest.act("confirm_deployment");
  assert.equal(hostDeploy.type, "state", JSON.stringify(hostDeploy));
  assert.equal(guestDeploy.type, "state", JSON.stringify(guestDeploy));
  const room = app.rooms.get("SFSTEST"),
    [carrier, u, enemy] = room.game.units;
  room.game.fogMode = "disabled";
  room.game.tiles.forEach((row) => row.fill("plain"));
  carrier.model = Object.keys(G.models).find((id) => id.startsWith("DodaiYS__"));
  Object.assign(carrier, { x: 10, y: 8, hp: G.modelOf(carrier).hp, en: G.modelOf(carrier).en });
  Object.assign(u, { x: 9, y: 8 });
  Object.assign(enemy, { x: 12, y: 8 });
  await host.act("sync");
  let result = await host.act("move", { unitId: u.id, x: 10, y: 8 });
  assert.equal(result.type, "state", JSON.stringify(result));
  assert(u.pendingMove.boarding);
  assert(!u.embarked);
  assert.equal(u.x, 9);
  await host.act("cancel_move", { unitId: u.id });
  assert.equal(u.x, 9);
  assert(!u.pendingMove);
  await host.act("move", { unitId: u.id, x: 10, y: 8 });
  const id = randomUUID();
  result = await host.act("confirm_move", { unitId: u.id }, id);
  assert.equal(result.type, "state");
  assert(u.embarked.exposed);
  await host.act("confirm_move", { unitId: u.id }, id);
  assert.equal(G.hangars.cargo(room.game, carrier).length, 1);
  result = await guest.act("sync");
  assert(result.game.units.find((x) => x.id === u.id).embarked.exposed);
  assert.equal((await guest.act("wait", { unitId: u.id })).type, "error");
  u.acted = false;
  u.moved = false;
  u.actionPoints = G.actionBudget(u);
  u.embarked.boardRound = null;
  await host.act("sync");
  result = await host.act("attack", {
    unitId: u.id,
    targetId: enemy.id,
    weaponIds: [G.modelOf(u).weapons[0].id],
  });
  assert.equal(result.type, "state");
  assert(u.plan);
  await host.act("cancel_attack", { unitId: u.id });
  const p = G.hangars.launchCells(room.game, u)[0];
  assert(p);
  result = await host.act("move", { unitId: u.id, x: p.x, y: p.y });
  assert.equal(result.type, "state");
  assert(u.pendingMove.launch && u.embarked);
  await host.act("cancel_move", { unitId: u.id });
  assert(u.embarked);
  assert.equal(u.x, carrier.x);
});

test("real WebSocket loaded APC boarding keeps nested cargo and rejects unauthorized launch", async(t)=>{
  const app=createServer({host:"127.0.0.1",port:0}), address=await app.listen();
  const url=`ws://127.0.0.1:${address.port}/ws`;
  const host=await peer(url,"create"), guest=await peer(url,"join");
  t.after(async()=>{host.ws.terminate();guest.ws.terminate();await app.close();});
  const e={unitId:"RGM_79",kitId:"machine_gun"};
  for(const [player,action,fields] of [
    [host,"set_ready",{ready:true,formation:[e,e,e]}],
    [guest,"set_ready",{ready:true,formation:[e]}],
    [host,"start_game"],[host,"confirm_formation"],[guest,"confirm_formation"],
    [host,"confirm_deployment"],[guest,"confirm_deployment"]
  ]) {const r=await player.act(action,fields);assert.equal(r.type,"state",JSON.stringify(r));}
  const room=app.rooms.get("SFSTEST"), g=room.game;
  g.fogMode="disabled";g.tiles.forEach(r=>r.fill("plain"));
  const [ship,apc,passenger]=g.units;
  for(const [u,id] of [[ship,"PegasusClass"],[apc,"Type74"],[passenger,"Army_Squad_EFSF_0079_N_G_A"]]) {
    u.model=Object.keys(G.models).find(key=>key.startsWith(id+"__"));
    Object.assign(u,{hp:G.modelOf(u).hp,en:G.modelOf(u).en,x:10,y:8});
  }
  const edge=G.cells(ship)[0];Object.assign(apc,{x:edge.x-1,y:edge.y});
  Object.assign(passenger,{x:apc.x-1,y:apc.y});
  G.hangars.embark(g,passenger,apc,G.hangars.of(apc)[0].id);
  await host.act("sync");
  const fields={unitId:apc.id,carrierId:ship.id,hangarId:G.hangars.of(ship)[0].id};
  assert.equal((await guest.act("embark",fields)).type,"error");
  const id=randomUUID(), result=await host.act("embark",fields,id);
  assert.equal(result.type,"state",JSON.stringify(result));
  await host.act("embark",fields,id);
  assert.equal(G.hangars.used(g,ship,fields.hangarId),1);
  assert.equal(result.game.units.find(u=>u.id===passenger.id).embarked.carrierId,apc.id);
  assert.equal(result.game.units.find(u=>u.id===apc.id).embarked.carrierId,ship.id);
  assert.equal((await host.act("launch",{unitId:passenger.id,x:8,y:8})).type,"error");
  assert.equal(passenger.embarked.carrierId,apc.id);
});
