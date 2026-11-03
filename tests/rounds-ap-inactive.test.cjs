const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Classes = require("../shared/weapon-classes.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
const entry = { unitId: "RGM_79", kitId: "machine_gun" };
function fixture() {
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = game.units;
  const base = G.models[a.model];
  G.models.round_edit = {
    ...base,
    weapons: base.weapons.map((w) => structuredClone(w)),
    skills: [],
    partsBreakable: false,
    hp: 1000000,
  };
  Object.assign(a, {
    model: "round_edit",
    x: 5,
    y: 5,
    hp: 1000000,
    en: 10000,
    actionPoints: 0,
    shield: 0,
  });
  Object.assign(b, {
    model: "round_edit",
    x: 6,
    y: 5,
    hp: 1000000,
    en: 10000,
    actionPoints: 0,
    shield: 0,
  });
  return { game, a, b, model: G.models.round_edit };
}
function battle(f, response = "defend") {
  const room = { game: f.game };
  let id = 0;
  const p = createAttackPlanner(G, () => String(++id));
  p.reset(room);
  p.plan(room, f.a, f.b, null, 0);
  p.prepare(room);
  p.choose(room, room.pending.id, response, [], f.a.id);
  return p.resolve(room);
}
test("non-gated melee can be used again within the same turn, gated melee remains once", () => {
  const f = fixture(),
    sword = f.model.weapons.find((w) => w.type === "melee" && !w.id.startsWith("Common_Push"));
  f.model.weapons = [sword];
  assert.equal(sword.maxUsesPerTurn, undefined);
  battle(f);
  assert(G.canUse(f.a, sword));
  f.a.acted = false;
  assert.equal(battle(f).length, 1);
  sword.pilotRequirements = [{ stat: "melee", operator: ">=", value: 0 }];
  sword.maxUsesPerTurn = 1;
  f.a.acted = false;
  battle(f);
  assert.equal(G.canUse(f.a, sword), false);
});
test("configured weapon rounds override the type default, including zero and melee", () => {
  const f = fixture(),
    mg = f.model.weapons[0];
  mg.attackRounds = 4;
  f.model.weapons = [mg];
  assert.equal(Classes.rounds(mg), 4);
  assert.equal(G.firePlan(f.game, f.a, f.b).weapons.length, 4);
  mg.attackRounds = 0;
  assert.equal(G.firePlan(f.game, f.a, f.b).weapons.length, 0);
  const melee = fixture(),
    sword = melee.model.weapons.find((w) => w.type === "melee" && !w.id.startsWith("Common_Push"));
  sword.attackRounds = 3;
  melee.model.weapons = [sword];
  assert.equal(battle(melee).length, 3);
});
test("carrier destruction replaces the AP penalty with one-turn rounded-down attack rounds", () => {
  const f = fixture();
  const carrierModel = Object.values(G.models).find((m) => m.prefabId === "PegasusClass");
  const carrier = {
    ...structuredClone(f.a),
    id: "carrier",
    model: carrierModel.prefabId + "__" + carrierModel.kitId,
    x: 9,
    y: 6,
    hp: 0,
  };
  f.game.units.push(carrier);
  f.a.embarked = { carrierId: carrier.id, hangarId: G.hangars.of(carrier)[0].id };
  f.a.actionPoints = 7;
  f.a.acted = false;
  const events = G.hangars.evacuate(f.game);
  assert(events.some((e) => e.unitId === f.a.id && e.escaped));
  assert.equal(f.a.forcedExitRound, f.game.round);
  assert.equal(f.a.actionPoints, 7);
  assert.equal(f.a.acted, false);
  for (const n of [0, 1, 2, 3, 4, 5]) {
    const w = { weaponClass: "machine_gun", attackRounds: n };
    assert.equal(G.attackRounds(f.game, f.a, w), Math.floor(n * 0.5));
  }
  G.hangars.evacuate(f.game);
  assert.equal(G.attackRounds(f.game, f.a, { attackRounds: 3 }), 1);
  f.game.round++;
  assert.equal(G.attackRounds(f.game, f.a, { attackRounds: 3 }), 3);
});
test("forced evacuation halves actual attack and counter rounds and can disable melee", () => {
  const f = fixture();
  f.a.forcedExitRound = f.b.forcedExitRound = f.game.round;
  const mg = f.model.weapons[0];
  mg.attackRounds = 3;
  f.model.weapons = [mg];
  const events = battle(f, "counter").flatMap((b) => b.events);
  assert.equal(events.filter((e) => e.from === f.a.id).length, 1);
  assert.equal(events.filter((e) => e.from === f.b.id).length, 1);
  assert.equal(f.a.actionPoints, 0);
  assert.equal(f.b.actionPoints, 0);
});

test("an evacuation penalty received during playback resolution cancels queued later rounds", () => {
  const f = fixture(),
    mg = f.model.weapons[0];
  mg.attackRounds = 3;
  f.model.weapons = [mg];
  const resolve = G.resolveProjectile;
  G.resolveProjectile = (...args) => {
    const events = resolve(...args);
    f.a.forcedExitRound = f.game.round;
    return events;
  };
  try {
    const battles = battle(f);
    assert.equal(battles.length, 1);
    assert.equal(f.a.en, 10000 - G.weaponStats(mg, f.a).en);
    assert.equal(battles[0].events[0].shotCount, mg.attack.shots.length);
  } finally {
    G.resolveProjectile = resolve;
  }
});
for (const type of [
  "smoke",
  "emp",
  "irradiation",
  "beam_diffusion",
  "minovsky",
  "flight",
  "overboost",
])
  test(`zero AP does not block or get spent by ${type}`, () => {
    const f = fixture(),
      source = Object.values(G.models)
        .flatMap((m) => m.skills || [])
        .find((s) => s.type === type);
    const skill = structuredClone(source);
    assert(skill, type);
    // Exercise the real skill branch on an otherwise ordinary healthy unit.
    f.model.skills = [skill];
    f.a.en = 100000;
    f.a.actionPoints = 0;
    const targets = G.skillTargets(f.game, f.a, skill.id);
    assert(targets.length, type);
    const target = targets.find((p) => p.x === f.b.x && p.y === f.b.y) || targets[0];
    G.useSkill(f.game, f.a, skill.id, target.x, target.y);
    assert.equal(f.a.actionPoints, 0);
    assert.equal(f.a.acted, type === "irradiation", type);
  });

test("melee replies stay once per attacker and round down to zero after forced evacuation", () => {
  const f = fixture(),
    sword = f.model.weapons.find((w) => w.type === "melee" && !w.id.startsWith("Common_Push"));
  sword.attackRounds = 4;
  f.model.weapons = [sword];
  f.b.forcedExitRound = f.game.round;
  assert.equal(G.attackRounds(f.game, f.b, sword), 2);
  assert.equal(G.attackRounds(f.game, f.b, sword, true), 0);
  const events = battle(f, "counter").flatMap((b) => b.events);
  assert.equal(events.filter((e) => e.from === f.a.id).length, 4);
  assert.equal(events.filter((e) => e.from === f.b.id).length, 0);
});
