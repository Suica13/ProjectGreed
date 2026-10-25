const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  { createAttackPlanner } = require("../shared/attack-plans.js");
function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [
    [entry, entry],
    [entry, entry],
  ]);
  game.units.forEach((u, i) =>
    Object.assign(u, { x: i < 2 ? 2 : 4, y: (i % 2) + 3, hp: 100000, shield: 0 }),
  );
  for (const u of game.units) game.tiles[u.y][u.x] = "plain";
  let sequence = 0;
  const planner = createAttackPlanner(G, () => String(++sequence));
  const room = { game, matchId: "match" };
  planner.reset(room);
  return {
    room,
    planner,
    a: game.units[0],
    ally: game.units[1],
    b: game.units[2],
    other: game.units[3],
    weapon: G.models[game.units[0].model].weapons[0],
  };
}
test("attack planning reserves actions without spending energy, drawing randomness or dealing damage; cancellation is reversible", () => {
  const { room, planner, a, b, weapon } = fixture(),
    before = [a.en, b.hp, room.game.seed];
  planner.plan(room, a, b, weapon, 0);
  assert.deepEqual([a.en, b.hp, room.game.seed], before);
  assert.equal(a.acted, true);
  assert.equal(room.pending, null);
  planner.plan(room, a, b, weapon, 0);
  assert.equal(room.plans.length, 1);
  planner.cancel(room, a);
  assert.equal(a.acted, false);
  assert.equal(a.plan, undefined);
  assert.equal(room.plans.length, 0);
});
test("responses execute in planned order, independently of local playback, and reject duplicate or stale choices", () => {
  const { room, planner, a, ally, b, other, weapon } = fixture();
  planner.plan(room, a, b, weapon, 0);
  planner.plan(room, ally, other, weapon, 0);
  const first = planner.next(room);
  assert.equal(first.attacker, a.id);
  assert.throws(() => planner.respond(room, "stale", "defend"));
  assert.equal(room.combats.length, 0);
  const battle = planner.respond(room, first.id, "defend");
  assert.ok(battle.events.length);
  assert.equal(a.en, G.modelOf(a).en - weapon.en);
  assert.equal(room.combats.length, 1);
  assert.throws(() => planner.respond(room, first.id, "defend"));
  const second = planner.next(room);
  assert.equal(second.attacker, ally.id);
  assert.notEqual(second.id, first.id);
  planner.respond(room, second.id, "evade");
  assert.equal(room.combats.length, 2);
  assert.equal(planner.next(room), null);
  assert.equal(room.game.team, 0, "only the room engine advances teams");
});
test("dead or invalid targets are skipped without charging resources or substituting another target", () => {
  const { room, planner, a, ally, b, other, weapon } = fixture();
  planner.plan(room, a, b, weapon, 0);
  planner.plan(room, ally, other, weapon, 0);
  b.hp = 0;
  const next = planner.next(room);
  assert.equal(next.attacker, ally.id);
  assert.equal(a.en, G.modelOf(a).en);
  assert.equal(a.plan, undefined);
  other.x = 20;
  assert.throws(() => planner.respond(room, next.id, "defend"));
  assert.equal(ally.en, G.modelOf(ally).en);
  assert.equal(ally.acted, true);
});

test("canceling a plan restores the option to undo a move until another unit moves", () => {
  const { room, planner, a, b, ally, weapon } = fixture();
  G.move(room.game, a, 2, 2);
  planner.plan(room, a, b, weapon, 0);
  planner.cancel(room, a);
  assert.equal(G.canUndo(room.game, a), true);
  G.move(room.game, ally, 1, 4);
  assert.equal(G.canUndo(room.game, a), false);
});

test("one response covers focused fire and explicitly selects which attacker is countered", () => {
  const { room, planner, a, ally, b, other, weapon } = fixture();
  planner.plan(room, a, b, weapon, 0);
  planner.plan(room, ally, b, weapon, 0);
  const seed = room.game.seed,
    pending = planner.next(room);
  assert.equal(pending.attacks.length, 2);
  assert.throws(() => planner.resolve(room), /未完成/);
  assert.throws(() => planner.choose(room, pending.id, "counter", weapon.id, other.id), /反击目标/);
  planner.choose(room, pending.id, "counter", weapon.id, ally.id);
  assert.equal(room.combats.length, 0);
  assert.equal(a.en, G.modelOf(a).en);
  assert.equal(b.en, G.modelOf(b).en);
  assert.equal(b.hp, 100000);
  assert.equal(room.game.seed, seed);
  assert.equal(planner.next(room), null);
  const battles = planner.resolve(room);
  assert.deepEqual(
    battles.map((b) => b.a),
    [a.id, ally.id],
  );
  assert.equal(battles[0].events.length, 1);
  assert.equal(battles[1].events.length, 2);
  assert.equal(battles[1].events[1].from, b.id);
  assert.equal(battles[1].events[1].to, ally.id);
  assert.equal(b.counterCount, 1);
});

test("a target destroyed by an earlier result cancels later planned attacks without charging their EN", () => {
  const { room, planner, a, ally, b, weapon } = fixture();
  b.hp = 1;
  room.game.seed = 0;
  planner.plan(room, a, b, weapon, 0);
  planner.plan(room, ally, b, weapon, 0);
  planner.choose(room, planner.next(room).id, "defend");
  planner.next(room);
  const battles = planner.resolve(room);
  assert.equal(b.hp, 0);
  assert.equal(battles.length, 1);
  assert.equal(ally.en, G.modelOf(ally).en);
  assert.equal(ally.plan, undefined);
});

for (const response of ["defend", "evade"])
  test(`focused fire uses one ${response} choice for every incoming attack`, () => {
    const { room, planner, a, ally, b, weapon } = fixture();
    planner.plan(room, a, b, weapon, 0);
    planner.plan(room, ally, b, weapon, 0);
    const pending = planner.next(room);
    assert.equal(pending.attacks.length, 2);
    planner.choose(room, pending.id, response);
    assert.equal(planner.next(room), null);
    const battles = planner.resolve(room);
    assert.equal(battles.length, 2);
    assert.deepEqual(
      battles.map((b) => b.events.length),
      [1, 1],
    );
    assert.deepEqual(
      battles.map((b) => b.events[0].response),
      [response, response],
    );
    assert.equal(b.counterCount || 0, 0);
  });

test("planned weapons persist in snapshots and cancellation; built-in weapons preserve the held weapon", () => {
  const { room, planner, a, b, weapon } = fixture();
  b.x = a.x + 1;
  b.y = a.y;
  const melee = G.modelOf(a).weapons.find((w) => w.type === "melee"),
    builtIn = G.modelOf(a).weapons.find((w) => w.changeHeldWeapon === false);
  assert.ok(melee);
  assert.ok(builtIn);
  planner.plan(room, a, b, melee, 0);
  assert.equal(a.heldWeapon, melee.id);
  assert.equal(JSON.parse(JSON.stringify(room.game)).units[0].heldWeapon, melee.id);
  b.x = a.x + builtIn.min;
  planner.plan(room, a, b, builtIn, 0);
  assert.equal(a.heldWeapon, melee.id, "head vulcans do not replace the held weapon");
  planner.cancel(room, a);
  assert.equal(
    a.heldWeapon,
    melee.id,
    "canceling an attack does not reset the displayed equipment",
  );
  b.x = a.x + weapon.min;
  planner.plan(room, a, b, weapon, 0);
  assert.equal(a.heldWeapon, weapon.id, "a new handheld weapon replaces the previous display");
});

test("a defender killed by the primary volley never emits a counter or spends counter energy", () => {
  const { room, planner, a, b, weapon } = fixture();
  b.hp = 1;
  b.shield = 0;
  room.game.seed = 1;
  const energy = b.en;
  planner.plan(room, a, b, weapon, 0);
  const pending = planner.next(room);
  planner.choose(room, pending.id, "counter", weapon.id, a.id);
  const battles = planner.resolve(room);
  assert.equal(b.hp, 0);
  assert.equal(b.en, energy);
  assert.equal(b.counterCount, 0);
  assert.equal(battles.length, 1);
  assert.equal(battles[0].events.length, 1);
  assert.ok(battles[0].events.every((event) => event.from !== b.id));
});
