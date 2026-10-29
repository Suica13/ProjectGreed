const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws"),
  G = require("../shared/rules.js"),
  { createServer } = require("../server.js");
const tank = { unitId: "Type61", kitId: "standard" };
const army = (n) => Array.from({ length: n }, () => ({ ...tank }));
test("stock is shared across duplicate kits and the creation boundary omits excess units", () => {
  const entries = army(3),
    rules = { inventory: { Type61: 1 } };
  assert.equal(G.validateFormation(entries, 99999).length, 3);
  const plan = G.planFormation(entries, 99999, rules);
  assert.deepEqual(plan.indices, [0]);
  assert.equal(plan.reasons[1], "inventory");
  const game = G.create(false, 1, [entries, army(1)], true, {
    costLimit: 99999,
    unitCostLimit: 99999,
    seatFormationRules: [rules, { inventory: { Type61: 1 } }],
  });
  assert.equal(game.units.filter((u) => u.ownerSeat === 0).length, 1);
  assert.deepEqual(
    game.units.filter((u) => u.ownerSeat === 0).map((u) => u.id),
    ["0-0"],
  );
  assert.equal(
    G.armyRestrictions(G.defaultRoomSettings(), { seat: 0, bot: true }).inventory,
    undefined,
  );
  assert.deepEqual(G.armyRestrictions(G.defaultRoomSettings(), { seat: 0 }).inventory, {});
  assert.throws(() => G.normalizeInventory({ fake: 1 }));
});
class Peer {
  static peers = new Set();
  constructor(url) {
    Peer.peers.add(this);
    this.ws = new WebSocket(url);
    this.frames = [];
    this.ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      this.frames.push(m);
      if (m.type === "state") this.state = m;
      if (m.type === "joined") this.joined = m;
    });
  }
  async wait(predicate) {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const m = this.frames.find(predicate);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error("Timeout: " + JSON.stringify(this.frames.at(-1)));
  }
  async join(mode, room, inventory) {
    if (this.ws.readyState !== 1) await new Promise((r) => this.ws.once("open", r));
    this.ws.send(
      JSON.stringify({
        type: "hello",
        version: require("../project.json").version,
        mode,
        room,
        characterFaction: "PMC",
        inventory,
        name: mode,
      }),
    );
    await this.wait((m) => m.type === "joined");
    await this.wait((m) => m.type === "state");
  }
  async action(action, fields = {}, override = {}) {
    // A different client may receive the broadcast before this peer; wait for the
    // same revision before issuing the next test action instead of racing snapshots.
    const revision = Math.max(0, ...[...Peer.peers]
      .filter(p => p.ws.url === this.ws.url && p.ws.readyState === 1)
      .map(p => p.state?.revision ?? 0));
    if ((this.state?.revision ?? 0) < revision)
      await this.wait(m => m.type === "state" && m.revision >= revision);
    const id = randomUUID();
    this.ws.send(
      JSON.stringify({
        type: "action",
        action,
        id,
        revision: this.state.revision,
        ...fields,
        ...override,
      }),
    );
    return this.wait(
      (m) => m.ack === (override.id || id) || (m.type === "error" && m.id === (override.id || id)),
    );
  }
}
test("real WebSocket ready/assembly/start paths enforce stock and keep inventory private", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const a = new Peer(`ws://127.0.0.1:${address.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async () => {
    a.ws.terminate();
    b.ws.terminate();
    await app.close();
  });
  await a.join("create", "STOCK", { Type61: 1 });
  await b.join("join", "STOCK", { Type61: 2 });
  let r = await b.action("set_ready", {
    ready: true,
    formation: army(3),
    inventory: { Type61: 2 },
  });
  assert.equal(r.type, "state");
  r = await a.action("start_game", { formation: army(3), inventory: { Type61: 1 } });
  assert.equal(r.phase, "assembly");
  const own = r.assembly.players.find((p) => p.memberId === a.joined.memberId);
  assert.equal(own.deployable.length, 1);
  assert.equal(own.reasons[2], "inventory");
  assert.deepEqual(r.members.find((m) => m.id === a.joined.memberId).inventory, { Type61: 1 });
  assert.equal(r.members.find((m) => m.id === b.joined.memberId).inventory, undefined);
  const room = app.rooms.get("STOCK"),
    oldInventory = room.seats[0].inventory;
  r = await a.action("update_formation", {
    formation: [{ unitId: "fake", kitId: "fake" }],
    inventory: { Type61: 99 },
  });
  assert.equal(r.type, "error");
  assert.deepEqual(room.seats[0].inventory, oldInventory);
  const requestId = randomUUID();
  r = await a.action("confirm_formation", { inventory: { Type61: 1 } }, { id: requestId });
  assert.equal(r.type, "state");
  await a.action("confirm_formation", { inventory: { Type61: 99 } }, { id: requestId });
  assert.equal(room.seats[0].inventory.Type61, 1);
  r = await b.action("confirm_formation", { inventory: { Type61: 2 } });
  assert.equal(r.phase, "deployment");
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 0).length, 1);
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 1).length, 2);
});

test("a human may force readiness with zero stock but receives no spawned units", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const a = new Peer(`ws://127.0.0.1:${address.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async () => {
    a.ws.terminate();
    b.ws.terminate();
    await app.close();
  });
  await a.join("create", "ZERO", {});
  await b.join("join", "ZERO", { Type61: 1 });
  let result = await a.action("set_ready", { ready: true, formation: army(1), inventory: {} });
  assert.equal(result.type, "state");
  assert.equal(result.members.find((m) => m.id === a.joined.memberId).ready, true);
  await b.action("set_ready", { ready: true, formation: army(1), inventory: { Type61: 1 } });
  await a.wait(m => m.type === "state" && m.revision === app.rooms.get("ZERO").revision);
  result = await a.action("start_game", { formation: army(1), inventory: {} });
  assert.equal(result.phase, "assembly");
  await a.action("confirm_formation", { inventory: {} });
  await b.wait(m => m.type === "state" && m.revision === app.rooms.get("ZERO").revision);
  result = await b.action("confirm_formation", { inventory: { Type61: 1 } });
  assert.equal(result.phase, "deployment");
  const game = app.rooms.get("ZERO").game;
  assert.equal(game.units.filter((u) => u.ownerSeat === 0).length, 0);
  assert.equal(game.units.filter((u) => u.ownerSeat === 1).length, 1);
  assert.equal(game.deployment[0], true);
});

const Development = require('../shared/development.js');
const lockedModel = Object.values(G.models).find(m => !m.wip && m.faction === 'EFSF' &&
  m.movementType !== 'naval' && (m.adaptability?.ground ?? 100) > 0 &&
  !Development.allows('PMC', m.prefabId, {}));
const lockedEntry = {unitId: lockedModel.prefabId, kitId: Object.keys(G.models).find(id => G.models[id] === lockedModel).split('__')[1]};
test('owned undeveloped units bypass research only, retain quantity, faction, cost and tag restrictions', () => {
  const settings = {...G.defaultRoomSettings(), costLimit:99999, unitCostLimit:99999};
  const rules = G.armyRestrictions(settings, {seat:0, characterFaction:'PMC', researched:{}, inventory:{[lockedEntry.unitId]:1}});
  assert.equal(G.restrictionReason(lockedModel, rules), null);
  assert.equal(G.planFormation([lockedEntry,lockedEntry],Infinity,rules).reasons[1], 'inventory');
  assert.equal(G.planFormation([lockedEntry],Infinity,{...rules,inventory:undefined}).deployable.length,1);
  assert.equal(G.restrictionReason(lockedModel,{...rules,inventory:{}}),'not_developed');
  assert.equal(G.restrictionReason(lockedModel,{...rules,characterFaction:'ZEON'}),'faction_mismatch');
  assert.equal(G.restrictionReason(lockedModel,{...rules,unitCostLimit:0}),'cost');
  assert.equal(G.restrictionReason(lockedModel,{...rules,bannedFactions:['EFSF']}),'not_allowed');
});
test('real WebSocket undeveloped inventory survives ready, assembly confirmation and spawning',async t=>{
 const app=createServer({host:'127.0.0.1',port:0}), address=await app.listen();
 const a=new Peer(`ws://127.0.0.1:${address.port}/ws`),b=new Peer(`ws://127.0.0.1:${address.port}/ws`);
 t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close()});
 const stock={[lockedEntry.unitId]:1},formation=[lockedEntry];
 await a.join('create','LOCKED',stock);await b.join('join','LOCKED',stock);
 let r=await a.action('configure_room',{...G.defaultRoomSettings(),costLimit:99999,unitCostLimit:99999});
 assert.equal(r.type,'state');
 r=await b.action('set_ready',{ready:true,formation,inventory:stock});assert.equal(r.type,'state');
 r=await a.action('start_game',{formation,inventory:stock});assert.equal(r.phase,'assembly');
 assert(r.assembly.players.every(p=>p.deployable.length===1));
 r=await a.action('confirm_formation',{formation,inventory:stock});assert.equal(r.type,'state');
 r=await b.action('confirm_formation',{formation,inventory:stock});assert.equal(r.phase,'deployment');
 assert.equal(app.rooms.get('LOCKED').game.units.filter(u=>G.modelOf(u).prefabId===lockedEntry.unitId).length,2);
});
test("empty formations cannot ready and assembly formations are locked", async (t) => {
  const app = createServer({host:"127.0.0.1",port:0});
  const address=await app.listen();
  const a=new Peer("ws://127.0.0.1:"+address.port+"/ws");
  const b=new Peer("ws://127.0.0.1:"+address.port+"/ws");
  t.after(async()=>{ a.ws.terminate();b.ws.terminate();await app.close(); });
  await a.join("create","EMPTYLOCK",{Type61:3});
  await b.join("join","EMPTYLOCK",{Type61:3});
  assert.equal(G.defaultRoomSettings().unitCostLimit,250);
  assert.equal((await b.action("update_formation",{formation:[]})).type,"state");
  assert.equal((await b.action("set_ready",{ready:true,formation:[]})).type,"error");
  assert.equal((await a.action("start_game",{formation:[]})).type,"error");
  assert.equal((await b.action("set_ready",{ready:true,formation:army(1)})).type,"state");
  assert.equal((await b.action("update_formation",{formation:[]})).type,"state");
  assert.equal(app.rooms.get("EMPTYLOCK").seats[1].ready,false);
  await b.action("set_ready",{ready:true,formation:army(1)});
  assert.equal((await a.action("start_game",{formation:army(1)})).phase,"assembly");
  assert.equal((await a.action("update_formation",{formation:army(2)})).type,"error");
  assert.equal((await a.action("confirm_formation",{formation:army(2)})).type,"error");
  assert.equal((await a.action("confirm_formation",{formation:[]})).type,"error");
  assert.equal((await a.action("confirm_formation")).type,"state");
  assert.equal((await b.action("confirm_formation")).phase,"deployment");
});
