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
  constructor(url) {
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
  result = await a.action("start_game", { formation: army(1), inventory: {} });
  assert.equal(result.phase, "assembly");
  await a.action("confirm_formation", { inventory: {} });
  result = await b.action("confirm_formation", { inventory: { Type61: 1 } });
  assert.equal(result.phase, "deployment");
  const game = app.rooms.get("ZERO").game;
  assert.equal(game.units.filter((u) => u.ownerSeat === 0).length, 0);
  assert.equal(game.units.filter((u) => u.ownerSeat === 1).length, 1);
  assert.equal(game.deployment[0], true);
});
