const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");

function fixture(count = 7) {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles.forEach((row) => row.fill("plain"));
  const source = game.units[0],
    enemy = game.units[1];
  const allies = Array.from({ length: count }, (_, i) => ({
    ...structuredClone(source),
    id: "squad-test-" + i,
    x: 5 + (i % 4),
    y: 5 + Math.floor(i / 4),
    hp: 100000,
    en: 10000,
    shield: 0,
    moved: false,
    acted: false,
    actionPoints: 0,
  }));
  Object.assign(enemy, { x: 6, y: 8, hp: 100000, en: 10000, shield: 0 });
  game.units = [...allies, enemy];
  return { game, allies, enemy };
}
function stack(game, units, x = 5, y = 5, id = "test-squad") {
  units.forEach((unit, index) => Object.assign(unit, { x, y, squadId: id, squadSlot: index }));
}

test("counter selection accepts any incoming squad member and rejects uninvolved enemies", () => {
  const { game, allies, enemy } = fixture(4);
  stack(game, allies.slice(0, 3));
  Object.assign(enemy, { x: 5, y: 6 });
  const room = { game, matchId: "counter-target" };
  let sequence = 0;
  const planner = createAttackPlanner(G, () => "counter-" + ++sequence);
  planner.reset(room);
  planner.plan(room, allies[0], enemy, null, G.ownerOf(allies[0]), "melee", true);
  const request = planner.prepare(room)[0];
  assert.equal(
    request.attacks.some((attack) => attack.attacker === allies[2].id),
    false,
  );
  assert.throws(() => planner.choose(room, request.id, "counter", [], allies[3].id));
  planner.choose(room, request.id, "counter", [], allies[2].id);
  assert.equal(room.responses[0].counterTargetId, allies[2].id);
  assert.ok(room.responses[0].counterIds.length);
});

test("walking onto a friendly cell forms a squad; six capacity points is the capacity, enemy/other controllers cannot join", () => {
  const { game, allies } = fixture();
  G.move(game, allies[1], 5, 5);
  assert.equal(G.squadMembers(game, allies[0]).length, 2);
  assert.equal(allies[1].moved, true);
  stack(game, allies.slice(0, 3));
  assert.equal(G.reachable(game, allies[3], null, true).has(G.key(5, 5)), false);
  allies[2].hp = 0;
  assert.equal(G.reachable(game, allies[3], null, true).has(G.key(5, 5)), true);
  allies[0].ownerSeat = 2;
  assert.equal(G.squadJoinTarget(game, allies[3], 5, 5), null);
});

test("squad preview/cancel does not move units or reveal new cells; confirmation moves every member", () => {
  const { game, allies } = fixture(3);
  stack(game, allies);
  G.previewMove(game, allies[0], 6, 5);
  assert.deepEqual(
    allies.map((u) => [u.x, u.y]),
    [
      [5, 5],
      [5, 5],
      [5, 5],
    ],
  );
  assert.deepEqual(
    allies[0].pendingMove.squadIds,
    allies.map((u) => u.id),
  );
  G.cancelMove(game, allies[0]);
  assert.ok(allies.every((u) => !u.pendingMove && !u.moved));
  G.previewMove(game, allies[0], 6, 5);
  G.confirmMove(game, allies[0]);
  assert.ok(allies.every((u) => u.x === 6 && u.y === 5 && u.moved && !u.pendingMove));
});

test("single-unit movement leaves others in place and cancels membership only on confirmation", () => {
  const { game, allies } = fixture(3);
  stack(game, allies);
  G.previewMove(game, allies[1], 6, 5, 0, true);
  G.cancelMove(game, allies[1]);
  assert.equal(G.squadMembers(game, allies[0]).length, 3);
  G.previewMove(game, allies[1], 6, 5, 0, true);
  G.confirmMove(game, allies[1]);
  assert.equal(allies[1].squadId, undefined);
  assert.equal(allies[0].x, 5);
  assert.equal(allies[1].x, 6);
  assert.equal(allies[2].x, 5);
});

test("a blocked or spent member rejects the entire squad movement without partial state changes", () => {
  const { game, allies } = fixture(3);
  stack(game, allies);
  allies[2].acted = true;
  const before = structuredClone(game);
  assert.throws(() => G.move(game, allies[0], 6, 5));
  assert.deepEqual(game, before);
});

test("squad movement is the intersection of each member's terrain and movement allowance", () => {
  const { game, allies } = fixture(2);
  stack(game, allies);
  G.models.squad_slow_test = { ...G.models[allies[1].model], move: 1 };
  allies[1].model = "squad_slow_test";
  assert.equal(G.reachable(game, allies[0], null, true).has(G.key(7, 5)), true);
  assert.equal(G.reachable(game, allies[0]).has(G.key(7, 5)), false);
  assert.equal(G.reachable(game, allies[0]).has(G.key(6, 5)), true);
});

test("squad attack assigns all members; one stance handles the defending squad without duplicating incoming fire", () => {
  const { game, allies, enemy } = fixture(3);
  stack(game, allies);
  const defenders = [
    enemy,
    ...Array.from({ length: 2 }, (_, i) => ({ ...structuredClone(enemy), id: "defender-" + i })),
  ];
  stack(game, defenders, 5, 6, "defending-squad");
  game.units.push(...defenders.slice(1));
  let sequence = 0;
  const room = { game },
    planner = createAttackPlanner(G, () => "r-" + ++sequence);
  planner.reset(room);
  planner.plan(room, allies[0], enemy, null, 0);
  assert.equal(room.plans.length, 3);
  assert.ok(allies.every((u) => u.acted && u.plan));
  const requests = planner.prepare(room);
  assert.equal(requests.length, 3);
  const incoming = requests.reduce(
    (sum, request) => sum + (request.supportOnly ? 0 : request.attacks.length),
    0,
  );
  assert.equal(incoming, 3);
  planner.choose(room, requests[0].id, "counter", [], requests[0].attacker);
  assert.equal(room.reactions.length, 0);
  assert.equal(room.responses.length, 3);
  const battles = planner.resolve(room);
  assert.ok(battles.some((battle) => battle.combatStage === "counter"));
});

test("all triangle members can melee without being blocked by formation", () => {
  const { game, allies, enemy } = fixture(3);
  stack(game, allies);
  Object.assign(enemy, { x: 5, y: 6 });
  const melee = G.modelOf(allies[0]).weapons.find((weapon) => weapon.type === "melee");
  assert.ok(allies.every((unit) => G.canAttack(game, unit, enemy, melee)));
  const offsets = allies.map((unit) => G.squadOffset(game, unit, 0));
  assert.ok(offsets.every((offset) => offset.scale === 1));
  assert.equal(new Set(offsets.map((offset) => offset.x)).size, 3);
  assert.ok(Math.max(...offsets.map((o) => o.y)) - Math.min(...offsets.map((o) => o.y)) < 0.3);
  assert.equal(G.squadPromote, undefined);
});

test("ranged battle excludes melee and ram from the entire squad", () => {
  const { game, allies, enemy } = fixture(3);
  stack(game, allies);
  Object.assign(enemy, { x: 5, y: 6 });
  const room = { game },
    planner = createAttackPlanner(G, () => "r");
  planner.reset(room);
  planner.plan(room, allies[0], enemy, null, 0, "shooting");
  for (const order of room.plans)
    assert.ok(
      order.weapons.every(
        (id) => G.modelOf(allies[0]).weapons.find((w) => w.id === id).type !== "melee",
      ),
    );
});

test("boarding one squad member detaches it and never consumes the other members", () => {
  const { game, allies } = fixture(2);
  stack(game, allies, 6, 5);
  const carrier = {
    ...structuredClone(allies[0]),
    id: "carrier",
    x: 7,
    y: 5,
    model: Object.keys(G.models).find((id) => id.startsWith("PegasusClass__")),
  };
  delete carrier.squadId;
  delete carrier.squadSlot;
  game.units.push(carrier);
  assert.equal(G.squadEligible(carrier), false);
  const slot = G.hangars.of(carrier)[0];
  assert.equal(G.hangars.canEmbark(game, allies[0], carrier, slot.id), true);
  G.hangars.embark(game, allies[0], carrier, slot.id);
  assert.equal(allies[0].squadId, undefined);
  assert.equal(allies[0].embarked.carrierId, carrier.id);
  assert.equal(allies[1].embarked, undefined);
  assert.equal(G.squadMembers(game, allies[1]).length, 1);
});

test("hangar launch may join a friendly squad only on confirmation and still respects six slots", () => {
  const { game, allies } = fixture(3);
  stack(game, allies, 6, 5);
  const carrier = {
    ...structuredClone(allies[0]),
    id: "launch-carrier",
    x: 7,
    y: 5,
    model: Object.keys(G.models).find((id) => id.startsWith("PegasusClass__")),
  };
  delete carrier.squadId;
  delete carrier.squadSlot;
  game.units.push(carrier);
  const passenger = allies[0],
    slot = G.hangars.of(carrier)[0];
  G.hangars.embark(game, passenger, carrier, slot.id);
  Object.assign(passenger, { acted: false, moved: false });
  passenger.embarked.boardRound = game.round - 2;
  assert.ok(G.hangars.launchCells(game, passenger).some((cell) => cell.x === 6 && cell.y === 5));
  G.hangars.previewLaunch(game, passenger, 6, 5);
  assert.equal(passenger.squadId, undefined);
  assert.equal(passenger.embarked.carrierId, carrier.id);
  G.cancelMove(game, passenger);
  assert.equal(G.squadMembers(game, allies[1]).length, 2);
  const extra = [0].map((index) => ({
    ...structuredClone(allies[1]),
    id: "full-slot-" + index,
    squadSlot: index,
  }));
  game.units.push(...extra);
  assert.equal(
    G.hangars.launchCells(game, passenger).some((cell) => cell.x === 6 && cell.y === 5),
    false,
  );
  game.units = game.units.filter((unit) => !extra.includes(unit));
  G.hangars.previewLaunch(game, passenger, 6, 5);
  G.confirmMove(game, passenger);
  assert.equal(passenger.embarked, undefined);
  assert.equal(G.squadMembers(game, passenger).length, 3);
  assert.equal(G.squadOffset(game, passenger).scale, 1);
  assert.equal(G.mapCellPixels, 160);
});

function exchangeFixture(melee = false) {
  const { game, allies, enemy } = fixture(3);
  const native = G.modelOf(allies[0]);
  const original = native.weapons.find((w) => (w.type === "melee") === melee);
  const weapon = {
    ...structuredClone(original),
    id: "squad-exchange",
    weaponClass: melee ? "melee" : "machine_gun",
    en: 0,
    min: 1,
    max: 3,
    hit: 0,
    pilotRequirements: [],
    requiredParts: [],
    pairedChannels: undefined,
    maxUses: undefined,
    special: undefined,
    attack: {
      ...original.attack,
      shots: [0],
      duration: 0.25,
      muzzleIndices: [0],
      muzzleShotIndices: [0],
      strikes: [
        {
          ...original.attack.strikes[0],
          shotIndex: 0,
          hitIndex: 0,
          at: 0,
          accuracy: 0,
          requiredParts: [],
          moduleId: undefined,
          firingArc: undefined,
        },
      ],
    },
  };
  G.models.squad_exchange_test = {
    ...native,
    weapons: [weapon],
    skills: [],
    partsBreakable: false,
  };
  const defenders = [
    enemy,
    ...[1, 2].map((index) => ({ ...structuredClone(enemy), id: "squad-enemy-" + index })),
  ];
  game.units.push(...defenders.slice(1));
  stack(game, allies, 5, 5, "squad-attack");
  stack(game, defenders, 5, 6, "squad-defense");
  game.units.forEach((u) => Object.assign(u, { model: "squad_exchange_test", hp: 100000000 }));
  let sequence = 0;
  const room = { game },
    planner = createAttackPlanner(G, () => "exchange-" + ++sequence);
  planner.reset(room);
  return { game, allies, defenders, room, planner };
}

test("a squad attack targets the whole squad and randomly selects living targets using authoritative seeded RNG", () => {
  function run() {
    const f = exchangeFixture();
    f.planner.plan(f.room, f.allies[0], f.defenders[2], null, 0, "shooting");
    assert.ok(
      f.room.plans.every(
        (order) => order.target === f.defenders[2].id && order.targetSquad.length === 3,
      ),
    );
    const [request] = f.planner.prepare(f.room);
    f.planner.choose(f.room, request.id, "defend");
    return f.planner.resolve(f.room).map((battle) => battle.b);
  }
  const targets = run();
  assert.ok(new Set(targets).size > 1);
  assert.deepEqual(run(), targets);
});

test("melee matches columns first; completed pairs return before unmatched members approach", () => {
  const f = exchangeFixture(true);
  f.defenders.slice(1, 3).forEach((unit) => {
    unit.hp = 0;
  });
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "defend");
  const battles = f.planner.resolve(f.room);
  const pairs = [...new Set(battles.map((battle) => battle.meleeExchange))].sort(
    (a, b) => a.start - b.start,
  );
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].attacker, f.allies[0].id);
  assert.equal(pairs[0].defender, f.defenders[0].id);
  const finish = (pair) =>
    Math.max(
      ...battles
        .filter((battle) => battle.meleeExchange === pair)
        .flatMap((battle) => battle.events.map((event) => event.impactAt)),
    );
  assert.ok(pairs[1].start > finish(pairs[0]));
  assert.ok(pairs[2].start > finish(pairs[1]));
  assert.ok(pairs[0].end <= pairs[1].start);
  assert.ok(pairs[1].end <= pairs[2].start);
  assert.ok(pairs.every((pair) => pair.yieldAt === undefined && !pair.holdForSquad));
});

test("members without a usable weapon still commit the squad action; cancellation restores the whole squad", () => {
  const f = exchangeFixture(true);
  const rear = f.allies[2];
  G.models.squad_unarmed_test = { ...G.modelOf(rear), weapons: [] };
  rear.model = "squad_unarmed_test";
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  assert.equal(rear.plan, undefined);
  assert.equal(rear.acted, true);
  f.planner.cancel(f.room, f.allies[0]);
  assert.ok(f.allies.every((unit) => !unit.acted && !unit.squadOrder && !unit.plan));
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  f.planner.prepare(f.room);
  f.planner.choose(f.room, f.room.pending.id, "defend");
  f.planner.resolve(f.room);
  assert.ok(f.allies.every((unit) => unit.acted && !unit.squadOrder));
});

test("only the engaged defender counters in melee, once per approaching enemy", () => {
  const f = exchangeFixture(true);
  f.defenders.slice(1).forEach((unit) => {
    unit.hp = 0;
  });
  const weapon = G.models.squad_exchange_test.weapons[0];
  weapon.en = 10;
  f.defenders[0].en = 30;
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "counter");
  const battles = f.planner.resolve(f.room);
  const replies = battles.filter((battle) => battle.combatStage === "counter");
  assert.equal(replies.length, 3);
  assert.ok(replies.every((battle) => battle.a === f.defenders[0].id));
  assert.deepEqual(
    new Set(replies.map((battle) => battle.b)),
    new Set(f.allies.map((unit) => unit.id)),
  );
  assert.equal(f.defenders[0].en, 0);
  for (const reply of replies) {
    const attack = battles.find((battle) => battle.a === reply.b && battle.b === reply.a);
    assert.ok(attack);
    assert.ok(reply.timelineStart > attack.timelineStart);
    assert.equal(reply.meleeExchange, attack.meleeExchange);
  }
});

test("unengaged melee defenders stay in place instead of attacking other squadmates", () => {
  const f = exchangeFixture(true);
  G.models.squad_unarmed_test = { ...G.models.squad_exchange_test, weapons: [] };
  f.allies.slice(1).forEach((unit) => {
    unit.model = "squad_unarmed_test";
  });
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "counter");
  const battles = f.planner.resolve(f.room);
  assert.equal(battles.length, 2);
  assert.equal(battles[0].a, f.allies[0].id);
  assert.equal(battles[1].a, f.defenders[0].id);
  assert.equal(battles[1].b, f.allies[0].id);
});

test("a defender's melee cannot pursue after ranged fire when nobody approaches", () => {
  const f = exchangeFixture(true);
  const native = G.models.squad_exchange_test.weapons[0];
  G.models.squad_ranged_only = {
    ...G.models.squad_exchange_test,
    weapons: [{ ...native, type: "shell", weaponClass: "machine_gun" }],
  };
  f.allies.forEach((unit) => {
    unit.model = "squad_ranged_only";
  });
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "counter");
  const battles = f.planner.resolve(f.room);
  assert.ok(battles.length);
  assert.ok(battles.every((battle) => battle.combatStage === "attack" && !battle.meleeExchange));
});

test("melee replies stop when EN is exhausted across successive attackers", () => {
  const f = exchangeFixture(true);
  f.defenders.slice(1).forEach((unit) => {
    unit.hp = 0;
  });
  G.models.squad_exchange_test.weapons[0].en = 10;
  f.defenders[0].en = 20;
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "counter");
  const battles = f.planner.resolve(f.room);
  assert.equal(battles.filter((battle) => battle.combatStage === "counter").length, 2);
  assert.equal(battles.filter((battle) => battle.combatStage === "attack").length, 3);
  assert.equal(f.defenders[0].en, 0);
});

test("ranged counterfire still includes unselected squadmates", () => {
  const f = exchangeFixture();
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0, "shooting");
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "counter");
  const battles = f.planner.resolve(f.room);
  assert.deepEqual(
    new Set(battles.filter((battle) => battle.combatStage === "counter").map((battle) => battle.a)),
    new Set(f.defenders.map((unit) => unit.id)),
  );
  assert.ok(battles.every((battle) => !battle.meleeExchange));
});

test("individual attack and cancellation affect only the selected member", () => {
  const f = exchangeFixture();
  f.planner.plan(f.room, f.allies[1], f.defenders[0], null, 0, "shooting", true);
  assert.deepEqual(
    f.room.plans.map((order) => order.attacker),
    [f.allies[1].id],
  );
  assert.equal(f.allies[0].acted, false);
  assert.equal(f.allies[2].acted, false);
  f.planner.plan(f.room, f.allies[2], f.defenders[0], null, 0, "shooting", true);
  f.planner.cancel(f.room, f.allies[1], null, true);
  assert.deepEqual(
    f.room.plans.map((order) => order.attacker),
    [f.allies[2].id],
  );
  assert.equal(f.allies[1].acted, false);
  assert.equal(f.allies[2].acted, true);
});

test("whole-squad attacks face all members toward the target, including unarmed members", () => {
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]) {
    const f = exchangeFixture();
    f.defenders.forEach((unit) => Object.assign(unit, { x: 5 + dx, y: 5 + dy }));
    G.models.squad_unarmed_test = { ...G.models.squad_exchange_test, weapons: [] };
    f.allies[2].model = "squad_unarmed_test";
    f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0);
    assert.ok(f.allies.every((unit) => unit.angle === f.allies[0].angle));
    const offsets = f.allies.map((unit) => G.squadOffset(f.game, unit));
    const projection = offsets.map((offset) => offset.x * dx + offset.y * dy);
    assert.ok(projection[1]>projection[0] && projection[1]>projection[2]);
  }
});

test("individual wait leaves squadmates ready", () => {
  const { game, allies } = fixture(3);
  stack(game, allies);
  G.wait(game, allies[1], true);
  assert.deepEqual(
    allies.map((unit) => unit.acted),
    [false, true, false],
  );
});

test("squad reactions accept individual stances and reject outsiders atomically", () => {
  const f = exchangeFixture();
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0, "shooting");
  const [request] = f.planner.prepare(f.room);
  const before = structuredClone(f.room);
  assert.throws(
    () =>
      f.planner.choose(f.room, request.id, "counter", [], request.attacker, [
        { unitId: f.allies[0].id, response: "evade" },
      ]),
    /无效的小队应战方案/,
  );
  assert.deepEqual(f.room, before);
  f.planner.choose(f.room, request.id, "counter", [], request.attacker, [
    { unitId: f.defenders[1].id, response: "defend" },
    { unitId: f.defenders[2].id, response: "evade" },
  ]);
  assert.equal(f.room.reactions.length, 0);
  assert.deepEqual(
    new Map(f.room.responses.map((choice) => [choice.intent.target, choice.response])),
    new Map([
      [f.defenders[0].id, "counter"],
      [f.defenders[1].id, "defend"],
      [f.defenders[2].id, "evade"],
    ]),
  );
  const battles = f.planner.resolve(f.room);
  assert.deepEqual(
    new Set(battles.filter((battle) => battle.combatStage === "counter").map((battle) => battle.a)),
    new Set([f.defenders[0].id]),
  );
});

function boardingFixture(capacity = 6) {
  const { game, allies } = fixture(3);
  stack(game, allies, 6, 5);
  const nativeId = Object.keys(G.models).find((id) => id.startsWith("PegasusClass__"));
  const id = "squad-boarding-carrier-" + capacity;
  G.models[id] = { ...G.models[nativeId], hangars: [{ ...G.models[nativeId].hangars[0], capacity }] };
  const carrier = { ...structuredClone(allies[0]), id: "carrier", model: id, x: 7, y: 5 };
  delete carrier.squadId;
  delete carrier.squadSlot;
  game.units.push(carrier);
  return { game, allies, carrier, slot: G.hangars.of(carrier)[0] };
}
test("whole-squad boarding reserves capacity atomically and permits explicit single boarding", () => {
  const { game, allies, carrier, slot } = boardingFixture(2);
  const before = structuredClone(game.units);
  assert.equal(G.hangars.boardingPlan(game, allies, carrier, slot.id), null);
  assert.throws(() => G.hangars.embarkSquad(game, allies[0], carrier, slot.id));
  assert.deepEqual(game.units, before);
  assert.equal(G.reachable(game, allies[0]).has(G.key(carrier.x, carrier.y)), false);
  G.hangars.embarkSquad(game, allies[0], carrier, slot.id, true);
  assert.equal(G.hangars.cargo(game, carrier).length, 1);
  assert.equal(G.squadMembers(game, allies[1]).length, 2);
});
test("squad boarding preview can cancel and confirmation boards all three without partial moves", () => {
  const { game, allies, carrier } = boardingFixture();
  const before = structuredClone(game.units);
  G.previewMove(game, allies[0], carrier.x, carrier.y);
  assert.ok(allies[0].pendingMove.boarding);
  G.cancelMove(game, allies[0]);
  assert.deepEqual(game.units, before);
  G.previewMove(game, allies[0], carrier.x, carrier.y);
  G.confirmMove(game, allies[0]);
  assert.equal(G.hangars.cargo(game, carrier).length, 3);
  assert.ok(allies.every((u) => u.acted && u.moved && !u.squadId));
});
test("capacity changes during squad preview reject the entire confirmation", () => {
  const { game, allies, carrier, slot } = boardingFixture(6);
  G.previewMove(game, allies[0], carrier.x, carrier.y);
  const extra = { ...structuredClone(allies[1]), id: "extra" };
  delete extra.squadId;
  game.units.push(extra);
  G.hangars.embark(game, extra, carrier, slot.id);
  const before = structuredClone(game.units);
  assert.throws(() => G.confirmMove(game, allies[0]));
  assert.deepEqual(game.units, before);
});
test("AI recovery boards its squad and does not split it to fit a nearly full carrier", () => {
  for (const capacity of [2, 6]) {
    const { game, allies, carrier } = boardingFixture(capacity);
    allies.forEach((u) => u.en = 0);
    const order = G.hangars.recoveryOrder(game, allies[0]);
    if (capacity === 2) assert.equal(order, null);
    else {
      assert.equal(order.action, "embark");
      G.hangars.embarkSquad(game, allies[0], carrier, order.fields.hangarId);
      assert.equal(G.hangars.cargo(game, carrier).length, 3);
    }
  }
});

test("squad movement distributes passengers across compatible hangars without exceeding either capacity", () => {
  const { game, allies, carrier, slot } = boardingFixture(6);
  const native = G.models[carrier.model];
  G.models[carrier.model] = { ...native, hangars: [
    { ...slot, id: "first", capacity: 2 }, { ...slot, id: "second", capacity: 4 },
  ] };
  try {
    G.move(game, allies[0], carrier.x, carrier.y);
    assert.equal(G.hangars.cargo(game, carrier).length, 3);
    assert.equal(G.hangars.used(game, carrier, "first"), 2);
    assert.equal(G.hangars.used(game, carrier, "second"), 4);
  } finally { G.models[carrier.model] = native; }
});

for (const targetIndex of [0, 1]) test(`counter target includes both enemy squads even when they target defender member ${targetIndex}`, () => {
  const f = exchangeFixture();
  const second = f.allies.map((u, index) => ({ ...structuredClone(u), id: "second-" + index,
    squadId: "second-squad", x: 6, y: 6 }));
  f.game.units.push(...second);
  f.planner.plan(f.room, f.allies[0], f.defenders[0], null, 0, "shooting");
  f.planner.plan(f.room, second[0], f.defenders[targetIndex], null, 0, "shooting");
  f.planner.prepare(f.room);
  assert.equal(f.room.reactions.length, 3);
  const options = G.counterTargetEntries(f.game, f.room.pending);
  assert.ok(options.some((entry) => entry.attacker === second[0].id));
  assert.ok(options.some((entry) => entry.attacker === f.allies[0].id));
  f.planner.choose(f.room, f.room.pending.id, "counter", [], second[0].id);
  assert.equal(f.room.reactions.length, 0);
  const battles = f.planner.resolve(f.room);
  for (const defender of f.defenders) {
    const replies = battles.filter((b) => b.combatStage === "counter" && b.a === defender.id);
    assert.ok(replies.length);
    assert.ok(replies.every((b) => second.some((u) => u.id === b.b)));
  }
});
