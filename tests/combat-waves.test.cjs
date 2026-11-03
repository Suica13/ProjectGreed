const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const Classes = require("../shared/weapon-classes.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
function fixture() {
  const e = { unitId: "Type61", kitId: "standard" };
  const game = G.create(
    false,
    2,
    [
      [e, e],
      [e, e],
    ],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  game.fogMode = "disabled";
  game.tiles.forEach((r) => r.fill("plain"));
  const base = G.modelOf(game.units[0]);
  const native = base.weapons.find((w) => w.slot !== "skill");
  const gun = {
    ...native,
    id: "wave-gun",
    min: 1,
    max: 10,
    en: 1,
    actionCost: 1,
    hit: 1000,
    requiredParts: [],
    damageComponents: { shell: 25 },
    damage: 25,
    damagePerShot: 25,
    attack: {
      ...native.attack,
      strikes: [
        {
          ...native.attack.strikes[0],
          moduleId: undefined,
          requiredParts: [],
          damageComponents: { shell: 25 },
        },
      ],
    },
  };
  G.models.wave_test = {
    ...base,
    actionPoints: 8,
    weapons: [gun],
    skills: [],
    hp: 1000000,
    partsBreakable: false,
    shield: { ...base.shield, hp: 0 },
  };
  game.units.forEach((u, i) =>
    Object.assign(u, {
      model: "wave_test",
      x: 10 + i * 2,
      y: 10,
      hp: 1000000,
      en: 10000,
      shield: 0,
      actionPoints: 8,
      pilot: { stats: G.pilots.baseStats() },
    }),
  );
  let id = 0;
  const planner = createAttackPlanner(G, () => "wave-" + ++id);
  const room = { game, matchId: "waves" };
  planner.reset(room);
  return {
    game,
    room,
    planner,
    a: game.units[0],
    ally: game.units[1],
    b: game.units[2],
    other: game.units[3],
    gun,
    close: () => delete G.models.wave_test,
  };
}
test("automatic attackers and counters alternate volleys on the launch/impact timeline", () => {
  const f = fixture();
  try {
    const { room, planner, a, ally, b, gun } = f;
    planner.plan(room, a, b, null, 0);
    planner.plan(room, ally, b, null, 0);
    const [request] = planner.prepare(room);
    planner.chooseBatch(room, request.id, [{ targetId: a.id }]);
    const energy = b.en,
      battles = planner.resolve(room),
      events = battles.flatMap((b) => b.events);
    const count = Classes.rounds(gun);
    assert.equal(battles.length, count * 3);
    assert.equal(b.counterCount, 1);
    assert.equal(b.en, energy - count * G.weaponStats(gun, b).en);
    assert(battles.every((b) => b.crossfire));
    assert(
      Math.min(...events.filter((e) => e.from === b.id).map((e) => e.fireAt)) >
        Math.max(
          ...events.filter((e) => e.from === a.id && e.timelineStart === 0).map((e) => e.impactAt),
        ),
    );
    assert(battles.filter((b) => b.combatStage === "counter").every((b) => b.b === a.id));
    const readyAt = Math.max(.25, G.weaponStats(gun,a).attack.duration / (G.catalog.presentation.animationSpeed || 1),
      ...events.filter(e=>e.timelineStart===0).map(e=>e.impactAt));
    const replyAt = Math.min(...battles.filter(b=>b.combatStage==="counter").map(b=>b.timelineStart));
    assert(replyAt-readyAt <= .081, "No half-second padding between ranged stages: " + (replyAt-readyAt));
  } finally {
    f.close();
  }
});

test("stun retains one non-stacking penalty flag but inactive AP budgets stay unchanged", () => {
  const f = fixture();
  try {
    const { game, a, b, gun } = f;
    const stun = { ...gun, onHitAPLoss: 0.25 };
    G.models.wave_test = { ...G.models.wave_test, actionPoints: 5, weapons: [stun] };
    for (let i = 0; i < 2; i++) {
      a.acted = false;
      G.fight(game, a, b, stun, "defend", null, false);
    }
    assert.equal(b.apPenaltyNextTurn, 0.25);
    G.end(game);
    assert.equal(b.actionPoints, G.actionBudget(b));
    assert.equal(b.apPenaltyNextTurn, undefined);
    G.end(game);
    G.end(game);
    assert.equal(b.actionPoints, G.actionBudget(b));
  } finally {
    f.close();
  }
});
test("EMP uses the same percentage flag as stun weapons", () => {
  const f = fixture();
  try {
    const { game, a, b } = f;
    const model = Object.values(G.models).find((m) => m.skills?.some((s) => s.type === "emp"));
    a.model = Object.keys(G.models).find((id) => G.models[id] === model);
    a.en = model.en;
    a.actionPoints = 8;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 13, y: 10 });
    const skill = model.skills.find((s) => s.type === "emp");
    G.useSkill(game, a, skill.id, a.x, a.y);
    assert.equal(b.apPenaltyNextTurn, 0.25);
    G.end(game);
    assert.equal(b.actionPoints, G.actionBudget(b));
  } finally {
    f.close();
  }
});

test("sniper locks this turn and fires automatically only at the beginning of the next own turn", () => {
  const id = "RGM_79_G_SP",
    m = Object.values(G.models).find((m) => m.prefabId === id);
  const game = G.create(
    false,
    2,
    [[{ unitId: id, kitId: m.kitId }], [{ unitId: "Type61", kitId: "standard" }]],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  game.tiles.forEach((r) => r.fill("plain"));
  game.fogMode = "disabled";
  const [a, b] = game.units;
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 16, y: 10, hp: 1000000 });
  const weapon = G.modelOf(a).weapons.find((w) => w.special?.type === "snipe");
  const planner = createAttackPlanner(G, () => "snipe-id"),
    room = { game, matchId: "snipe" };
  planner.reset(room);
  const en = a.en;
  planner.plan(room, a, b, weapon, 0);
  assert.equal(planner.prepare(room).length, 0);
  assert.equal(planner.resolve(room).length, 0);
  assert(a.snipeOrder);
  assert.equal(a.en, en);
  G.end(game);
  planner.resumeCharges(room);
  assert.equal(game.team, 1);
  assert.equal(room.plans.length, 0);
  assert.equal(a.en, en);
  G.end(game);
  assert.equal(game.team, 0);
  planner.resumeCharges(room);
  assert.equal(room.plans.length, 1);
  const [request] = planner.prepare(room);
  planner.choose(room, request.id, "evade");
  const battles = planner.resolve(room);
  assert.equal(battles.length, 1);
  assert.equal(battles[0].crossfire, true);
  assert.equal(a.en, en - G.weaponStats(weapon, a).en);
  assert.equal(a.snipeOrder, undefined);
});

for (const movement of ["inside", "outside", "destroyed"])
  test("sniper follows a locked moving unit and cancels invalid shots: " + movement, () => {
    const m = Object.values(G.models).find((m) => m.prefabId === "RGM_79_G_SP");
    const entry = { unitId: "Type61", kitId: "standard" };
    const game = G.create(
      false,
      2,
      [[{ unitId: m.prefabId, kitId: m.kitId }], [entry, entry]],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    game.fogMode = "disabled";
    const [a, b, other] = game.units;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 16, y: 10 });
    Object.assign(other, { x: 30, y: 20 });
    const w = G.modelOf(a).weapons.find((w) => w.special?.type === "snipe");
    const planner = createAttackPlanner(G, () => "snipe-move"),
      room = { game };
    planner.reset(room);
    planner.plan(room, a, b, w, 0);
    planner.prepare(room);
    planner.resolve(room);
    const en = a.en;
    G.end(game);
    b.x = movement === "outside" ? 25 : 17;
    if (movement === "destroyed") b.hp = 0;
    G.end(game);
    planner.resumeCharges(room);
    assert.equal(room.plans.length, movement === "inside" ? 1 : 0);
    if (movement === "inside") {
      assert.deepEqual(room.plans[0].aimCell, { x: 17, y: 10 });
      const [request] = planner.prepare(room);
      assert(request);
      planner.choose(room, request.id, "evade");
      assert.equal(planner.resolve(room).length, 1);
      assert.equal(a.en, en - G.weaponStats(w, a).en);
    } else assert.equal(a.en, en);
  });

test("automatic blast counters charge EN once per volley regardless of victim count", () => {
  const f = fixture();
  try {
    const { room, planner, a, ally, b, gun } = f;
    const blast = {
      ...gun,
      id: "counter-blast",
      special: { type: "blast", radius: 1, shape: "cross" },
    };
    G.models.wave_test = { ...G.models.wave_test, weapons: [gun, blast] };
    ally.x = a.x + 1;
    planner.plan(room, a, b, null, 0);
    const [request] = planner.prepare(room);
    planner.choose(room, request.id, "counter", [], a.id);
    const en = b.en;
    const battles = planner.resolve(room).filter((b) => b.combatStage === "counter");
    const events = battles.flatMap((b) => b.events).filter((e) => e.weapon === blast.id);
    assert.equal(events.length, Classes.rounds(blast) * 2);
    assert.equal(
      b.en,
      en -
        Classes.rounds(gun) * G.weaponStats(gun, b).en -
        Classes.rounds(blast) * G.weaponStats(blast, b).en,
    );
    assert.equal(b.counterCount, 1);
  } finally {
    f.close();
  }
});

for (const counter of [false, true])
  test(`gated blast resolves every victim and spends one turn use, counter=${counter}`, () => {
    const f = fixture();
    try {
      const { room, planner, a, ally, b, other, gun } = f;
      const blast = {
        ...gun,
        id: "gated-blast",
        pilotRequirements: [{ stat: "accuracy", operator: ">=", value: 0 }],
        special: { type: "blast", radius: 1, shape: "cross" },
      };
      G.models.wave_test = { ...G.models.wave_test, weapons: [gun, blast] };
      const actor = counter ? b : a;
      if (counter) {
        ally.x = a.x + 1;
        planner.plan(room, a, b, [gun], 0);
      } else {
        other.x = b.x + 1;
        planner.plan(room, a, b, [blast], 0);
      }
      for (const request of planner.prepare(room))
        planner.choose(
          room,
          request.id,
          counter ? "counter" : "evade",
          counter ? [blast.id] : [],
          a.id,
        );
      const events = planner
        .resolve(room)
        .flatMap((b) => b.events)
        .filter((e) => e.weapon === blast.id && e.from === actor.id);
      assert.equal(events.length, 2);
      assert.equal(actor.pilotWeaponTurnUses[blast.id], 1);
      assert.equal(G.canUse(actor, blast), false);
    } finally {
      f.close();
    }
  });
