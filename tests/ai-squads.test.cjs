const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");

function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles.forEach((row) => row.fill("plain"));
  const source = game.units[0],
    enemy = game.units[1];
  const own = [0, 1, 2, 3].map((i) => ({
    ...structuredClone(source),
    id: "gather-" + i,
    x: 5 + i,
    y: 5,
    moved: false,
    acted: false,
  }));
  Object.assign(enemy, { x: 30, y: 10 });
  game.units = [...own, enemy];
  return { game, own, enemy };
}

test("AI joins the same chassis before a closer different type, using normal movement", () => {
  const { game, own } = fixture();
  const tank = Object.entries(G.models).find(([, m]) => m.prefabId === "Type61")[0];
  own[1].model = tank;
  const choice = G.aiSquadChoice(game, own[0]);
  assert.ok(choice);
  assert.equal(choice.x, own[2].x);
  G.move(game, own[0], choice.x, choice.y);
  assert.equal(G.squadMembers(game, own[2]).length, 2);
  const third = G.aiSquadChoice(game, own[3]);
  assert.ok(third);
  G.move(game, own[3], third.x, third.y);
  assert.equal(G.squadMembers(game, own[2]).length, 3);
  assert.equal(G.aiSquadChoice(game, own[1]), null);
});

test("AI fights rather than assembling when it already has a legal firing opportunity", () => {
  const { game, own, enemy } = fixture();
  Object.assign(enemy, { x: 5, y: 7 });
  assert.ok(G.automaticQueue(game, own[0], enemy).length);
  assert.equal(G.aiSquadChoice(game, own[0]), null);
});

test("gathering respects controller, compatibility and idle state without mutating candidates", () => {
  const { game, own } = fixture();
  own[1].ownerSeat = 2;
  own[2].acted = true;
  own[3].flying = true;
  const before = structuredClone(game.units);
  assert.equal(G.aiSquadChoice(game, own[0]), null);
  assert.deepEqual(game.units, before);
});

test("assembled AI squads use the common whole-squad movement on the next turn", () => {
  const { game, own } = fixture();
  game.units = [own[0], own[1]];
  const choice = G.aiSquadChoice(game, own[0]);
  G.move(game, own[0], choice.x, choice.y);
  own.forEach((u) => {
    u.moved = false;
    u.acted = false;
  });
  G.move(game, own[1], 8, 5);
  assert.ok(game.units.every((u) => u.x === 8 && u.y === 5 && u.moved));
});

test("room AI assembles three units and completes its turn without repeated member commands", async (t) => {
  const { createRoomEngine } = require("../shared/room-engine.js");
  let sequence = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "sq-" + ++sequence,
    randomToken: () => "token-" + ++sequence,
    randomSeed: () => 1,
    aiDelayMs: 10,
    randomAIMoveDelay: () => 0,
    send: () => {},
  });
  t.after(() => engine.close());
  const clients = [{ readyState: 1 }, { readyState: 1 }];
  engine.join(clients[0], {
    mode: "create",
    room: "SQUAD",
    characterFaction: "PMC",
    licenses: { RGM_79: true },
  });
  engine.join(clients[1], {
    mode: "join",
    room: "SQUAD",
    characterFaction: "PMC",
    licenses: { RGM_79: true },
  });
  const room = engine.rooms.get("SQUAD");
  const act = (seat, action, fields = {}) =>
    engine.action(clients[seat], {
      id: "act-" + ++sequence,
      revision: room.revision,
      round: room.game?.round,
      action,
      ...fields,
    });
  const formation = Array.from({ length: 3 }, () => ({ unitId: "RGM_79", kitId: "machine_gun" }));
  for (const seat of [0, 1]) act(seat, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  for (const seat of [0, 1]) act(seat, "confirm_formation");
  act(0, "confirm_deployment");
  room.seats[0].bot = true;
  act(1, "confirm_deployment");
  room.turnNotBefore = 0;
  room.game.tiles.forEach((row) => row.fill("plain"));
  const allies = room.game.units.filter((u) => u.team === 0);
  allies.forEach((u, i) => Object.assign(u, { x: 5 + i, y: 5 }));
  room.game.units
    .filter((u) => u.team === 1)
    .forEach((u, i) => Object.assign(u, { x: 30 + i, y: 10 }));
  const deadline = Date.now() + 5000;
  while (room.game.team === 0 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(G.squadMembers(room.game, allies[0]).length, 3);
  assert.equal(room.game.team, 1, "gathering must not stall the turn");
});
