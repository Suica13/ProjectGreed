const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const { createAttackPlanner } = require("../shared/attack-plans");
function fixture() {
  const game = G.create(
    false,
    1,
    [[{ unitId: "RGM_79", kitId: "machine_gun" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
    false,
    { fogMode: "disabled" },
  );
  game.tiles.forEach((row) => row.fill("plain"));
  const base = G.modelOf(game.units[0]),
    original = base.weapons[0];
  const make = (id, ap, damage, en = 1) => ({
    ...original,
    id,
    sourceName: id,
    weaponClass: "other",
    category: "other",
    type: "shell",
    actionCost: ap,
    attackRounds: undefined,
    en,
    min: 1,
    max: 6,
    hit: 10000,
    sourceHit: 10000,
    requiredParts: [],
    pilotRequirements: [],
    pairedChannels: undefined,
    nativeTiming: undefined,
    maxUses: undefined,
    special: undefined,
    damage,
    damagePerShot: damage,
    damageComponents: { shell: damage },
    attack: {
      ...original.attack,
      shots: [0],
      duration: 0.2,
      muzzleIndices: [0],
      muzzleShotIndices: [0],
      strikes: [
        {
          ...original.attack.strikes[0],
          at: 0,
          shotIndex: 0,
          hitIndex: 0,
          requiredParts: [],
          accuracy: 10000,
          moduleId: undefined,
          channelId: undefined,
          firingArc: undefined,
          damageComponents: { shell: damage },
        },
      ],
    },
  });
  G.models.ap_test = {
    ...base,
    weapons: [make("expensive", 6, 9000), make("efficient", 5, 8000)],
    hp: 1000000,
    en: 10000,
    actionPoints: 10,
    counterLimit: 1,
    partsBreakable: false,
    modules: [],
    skills: [],
    shield: { ...base.shield, hp: 0 },
  };
  const [a, b] = game.units;
  game.units.forEach((u, i) =>
    Object.assign(u, {
      model: "ap_test",
      x: 5 + i * 2,
      y: 5,
      hp: 1000000,
      en: 10000,
      shield: 0,
      actionPoints: 10,
      brokenParts: {},
      moduleHp: undefined,
    }),
  );
  const room = { game, matchId: "ap-test" };
  let sequence = 0;
  const planner = createAttackPlanner(G, () => String(++sequence));
  planner.reset(room);
  return { game, a, b, room, planner, make, model: G.models.ap_test };
}

function finish(f, response = "defend") {
  const requests = f.planner.prepare(f.room);
  for (const request of requests)
    if (f.room.reactions.some((r) => r.id === request.id))
      f.planner.choose(f.room, request.id, response, [], f.a.id);
  return f.planner.resolve(f.room);
}
test("all usable one-round weapons fire regardless of AP or expected damage", () => {
  const f = fixture();
  f.a.actionPoints = 0;
  const before = JSON.stringify(f.game);
  const plan = G.firePlan(f.game, f.a, f.b);
  assert.deepEqual(
    plan.weapons.map((w) => w.id),
    ["expensive", "efficient"],
  );
  assert.equal(plan.ap, 0);
  assert.equal(plan.en, 2);
  assert.equal(JSON.stringify(f.game), before);
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const battles = finish(f);
  assert.deepEqual(
    battles.map((b) => b.events[0].weapon),
    ["expensive", "efficient"],
  );
  assert.equal(f.a.actionPoints, 0);
  assert.equal(f.a.en, 9998);
});
test("sequential EN availability skips unaffordable weapons and keeps later affordable ones", () => {
  const f = fixture();
  f.a.en = 7;
  f.model.weapons = [f.make("a", 50, 1000, 5), f.make("b", 50, 1000, 4), f.make("c", 50, 1000, 2)];
  assert.deepEqual(
    G.firePlan(f.game, f.a, f.b).weapons.map((w) => w.id),
    ["a", "c"],
  );
  f.planner.plan(f.room, f.a, f.b, null, 0);
  assert.equal(finish(f).length, 2);
  assert.equal(f.a.en, 0);
});
test("manual attack and counter weapon selection are rejected atomically", () => {
  const f = fixture();
  assert.throws(
    () =>
      f.planner.plan(f.room, f.a, f.b, null, 0, "shooting", true, [
        { unitId: f.a.id, weapons: ["efficient"] },
      ]),
    /不支持/,
  );
  assert.equal(f.room.plans.length, 0);
  assert.equal(f.a.actionPoints, 10);
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const [request] = f.planner.prepare(f.room);
  assert.throws(
    () =>
      f.planner.choose(f.room, request.id, "counter", [], f.a.id, [
        { unitId: f.b.id, response: "counter", weaponIds: ["efficient"] },
      ]),
    /不支持/,
  );
  assert.equal(f.room.responses.length, 0);
});
test("range, ammunition, pilot requirements and broken parts still constrain automatic fire", () => {
  const f = fixture();
  const far = f.make("far", 1, 1000);
  far.max = 1;
  const gate = f.make("gate", 1, 1000);
  gate.pilotRequirements = [{ stat: "melee", operator: ">=", value: 99999 }];
  const ammo = f.make("ammo", 1, 1000);
  ammo.maxUses = 1;
  f.a.weaponUses = { ammo: 1 };
  const broken = f.make("broken", 1, 1000);
  broken.requiredParts = ["rightArm"];
  f.model.partsBreakable = true;
  f.a.brokenParts = { rightArm: true };
  f.model.weapons = [far, gate, ammo, broken, f.make("valid", 100, 1000)];
  assert.deepEqual(
    G.firePlan(f.game, f.a, f.b).weapons.map((w) => w.id),
    ["valid"],
  );
});
test("native multi-bullet volley fires fully once and spends EN once without AP", () => {
  const f = fixture(),
    gun = f.make("burst", 99, 1000, 10);
  f.model.weapons = [gun];
  gun.attack.shots = [0, 0.1];
  gun.attack.muzzleIndices = [0, 0];
  gun.attack.muzzleShotIndices = [0, 1];
  gun.attack.strikes.push({ ...gun.attack.strikes[0], at: 0.1, shotIndex: 1 });
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const battles = finish(f);
  assert.equal(battles.length, 1);
  assert.equal(battles[0].events[0].strikes.length, 2);
  assert.equal(f.a.en, 9990);
  assert.equal(f.a.actionPoints, 10);
});
test("a lethal first weapon cancels later attacks and counterfire", () => {
  const f = fixture();
  f.b.hp = 1;
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const events = finish(f, "counter").flatMap((b) => b.events);
  assert.equal(events.length, 1);
  assert.equal(f.a.en, 9999);
  assert.equal(f.b.en, 10000);
});
test("counterfire works with zero attack and counter AP and does not spend either", () => {
  const f = fixture();
  f.b.actionPoints = 0;
  f.b.counterActionPoints = 0;
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const events = finish(f, "counter").flatMap((b) => b.events);
  assert.deepEqual(
    events.filter((e) => e.from === f.b.id).map((e) => e.weapon),
    ["expensive", "efficient"],
  );
  assert.equal(f.b.actionPoints, 0);
  assert.equal(f.b.counterActionPoints, 0);
});
test("all ranged fire precedes melee; every melee weapon attacks once, with one approach", () => {
  const f = fixture();
  f.b.x = f.a.x + 1;
  const sword = {
    ...f.make("sword", 99, 1000),
    type: "melee",
    weaponClass: "melee",
    projectile: null,
  };
  f.model.weapons = [sword, f.make("gun", 99, 1000), { ...sword, id: "second" }];
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const battles = finish(f, "counter");
  assert.deepEqual(
    battles.map((b) => [b.events[0].from, b.events[0].weapon]),
    [
      [f.a.id, "gun"],
      [f.b.id, "gun"],
      [f.a.id, "sword"],
      [f.b.id, "sword"],
      [f.a.id, "second"],
    ],
  );
  const melee = battles.filter((b) => b.meleeExchange);
  assert.equal(new Set(melee.map((b) => b.meleeExchange.id)).size, 1);
  assert(melee[0].meleeExchange.end > melee.at(-1).events[0].impactAt);
  assert.equal(f.a.weaponTurnUses?.sword, undefined);
  assert.equal(f.a.weaponTurnUses?.second, undefined);
  assert.equal(f.a.actionPoints, 10);
  assert(G.firePlan(f.game, f.a, f.b).weapons.some((w) => w.type === "melee"));
});
test("a defender does not initiate melee against a shooting-only attacker", () => {
  const f = fixture();
  f.b.x = f.a.x + 1;
  f.model.weapons = [
    f.make("gun", 1, 1000),
    { ...f.make("sword", 1, 1000), type: "melee", projectile: null },
  ];
  f.planner.plan(f.room, f.a, f.b, null, 0, "shooting");
  assert(finish(f, "counter").every((b) => b.events[0].type !== "melee"));
});
test("defender replies once to each melee attacker even with no AP", () => {
  const f = fixture();
  f.b.x = f.a.x + 1;
  f.b.counterActionPoints = 0;
  f.model.weapons = [
    { ...f.make("sword", 99, 1000), type: "melee", weaponClass: "melee", projectile: null },
  ];
  const members = [
    f.a,
    ...[1, 2].map((i) => ({ ...structuredClone(f.a), id: "member-" + i, squadSlot: i })),
  ];
  members.forEach((u) => (u.squadId = "attackers"));
  f.game.units.push(...members.slice(1));
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const battles = finish(f, "counter");
  assert.equal(battles.filter((b) => b.events[0].from === f.b.id).length, 3);
  assert.equal(f.b.en, 9997);
  const pairs = battles.filter((b) => b.events[0].from !== f.b.id).map((b) => b.meleeExchange);
  for (let i = 1; i < pairs.length; i++) assert(pairs[i].start >= pairs[i - 1].end);
});
test("compiled melee requirements retain the 125 gate and leave fallback ram exempt", () => {
  const single = G.models.RGM_79__machine_gun.weapons.filter((w) => w.type === "melee");
  assert(!single.find((w) => w.id === "EF_BeamSaber_A").pilotRequirements?.length);
  assert(
    Object.values(G.models).some((m) =>
      m.weapons.some((w) =>
        w.pilotRequirements?.some((r) => r.stat === "melee" && r.value === 125),
      ),
    ),
  );
});
test("sniper still locks for the next own turn, without an attack AP charge", () => {
  const f = fixture(),
    gun = f.make("sniper", 99, 1000);
  gun.special = { type: "snipe", baseWeapon: "ordinary" };
  gun.slot = "skill";
  f.model.weapons = [gun];
  f.planner.plan(f.room, f.a, f.b, [gun], 0);
  assert.equal(f.planner.prepare(f.room).length, 0);
  assert.equal(f.a.snipeOrder.readyRound, f.game.round + 2);
  assert.equal(f.a.actionPoints, 10);
});

test("the original cadence table is shared by preview and resolution, with per-round EN", () => {
  const Classes = require("../shared/weapon-classes.js");
  const table = {
    beam_rifle: 2,
    beam_gun: 3,
    beam_spray: 3,
    rifle: 2,
    machine_gun: 2,
    bazooka: 2,
    beam_bazooka: 2,
    cannon: 2,
    missile: 1,
    panzerfaust: 1,
    grenade: 1,
  };
  for (const [kind, count] of Object.entries(table)) {
    const f = fixture(),
      gun = f.make("test-" + kind, 99, 1000, 7);
    gun.weaponClass = kind;
    f.model.weapons = [gun];
    f.a.actionPoints = 0;
    assert.equal(Classes.rounds(gun), count, kind);
    assert.equal(G.firePlan(f.game, f.a, f.b).weapons.length, count, kind);
    f.planner.plan(f.room, f.a, f.b, null, 0);
    const battles = finish(f);
    assert.equal(battles.length, count, kind);
    assert.equal(f.a.en, 10000 - 7 * count, kind);
    assert.equal(f.a.actionPoints, 0, kind);
  }
});
test("cadence exceptions limit wrists, head vulcans and pilot-gated weapons to one round", () => {
  const C = require("../shared/weapon-classes.js");
  assert.equal(C.rounds({ id: "Common_ArmBR_L", weaponClass: "beam_gun", type: "beam" }), 1);
  assert.equal(
    C.rounds({ id: "Common_DoubleVulcan_MS", weaponClass: "small_vulcan", type: "shell" }),
    1,
  );
  assert.equal(
    C.rounds({
      weaponClass: "beam_rifle",
      pilotRequirements: [{ stat: "melee", operator: ">=", value: 125 }],
    }),
    1,
  );
  const f = fixture(),
    gun = f.make("limited-mg", 99, 1000, 10);
  gun.weaponClass = "machine_gun";
  f.model.weapons = [gun];
  f.a.en = 15;
  assert.equal(G.firePlan(f.game, f.a, f.b).weapons.length, 1);
  f.planner.plan(f.room, f.a, f.b, null, 0);
  assert.equal(finish(f).length, 1);
  assert.equal(f.a.en, 5);
});
test("ranged rounds alternate between attacker and defender and stop before melee", () => {
  const f = fixture();
  f.b.x = f.a.x + 1;
  const mg = { ...f.make("mg", 99, 1000), weaponClass: "machine_gun" };
  const sword = {
    ...f.make("sword", 99, 1000),
    weaponClass: "melee",
    type: "melee",
    projectile: null,
  };
  f.model.weapons = [sword, mg];
  f.planner.plan(f.room, f.a, f.b, null, 0);
  const events = finish(f, "counter").map((b) => b.events[0]);
  assert.deepEqual(
    events.map((e) => [e.from, e.weapon]),
    [
      [f.a.id, "mg"],
      [f.b.id, "mg"],
      [f.a.id, "mg"],
      [f.b.id, "mg"],
      [f.a.id, "sword"],
      [f.b.id, "sword"],
    ],
  );
});
