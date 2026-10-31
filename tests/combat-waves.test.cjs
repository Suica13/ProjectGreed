const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
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
test("all attackers alternate per-unit weapon waves with defenders, retaining long counter tails and one counter budget", () => {
  const f = fixture();
  try {
    const { room, planner, a, ally, b, gun } = f;
    planner.plan(room, a, b, [gun, gun, gun], 0);
    planner.plan(room, ally, b, [gun], 0);
    const [request] = planner.prepare(room);
    planner.chooseBatch(
      room,
      request.id,
      [a.id, ally.id, a.id, a.id, a.id].map((targetId) => ({ targetId, weaponIds: [gun.id] })),
    );
    const en = b.en,
      ap = a.actionPoints;
    const battles = planner.resolve(room);
    assert.deepEqual(
      battles.map((b) => [b.combatWave, b.combatStage]),
      [
        [0, "attack"],
        [0, "attack"],
        [0, "counter"],
        [1, "attack"],
        [1, "counter"],
        [2, "attack"],
        [2, "counter"],
        [3, "counter"],
        [4, "counter"],
      ],
    );
    assert.equal(b.counterCount, 1);
    assert.equal(b.en, en - 5 * G.weaponStats(gun, b).en);
    assert.equal(a.actionPoints, ap);
    assert.deepEqual(
      battles.filter((b) => b.combatStage === "counter").map((b) => b.b),
      [a.id, ally.id, a.id, a.id, a.id],
    );
  } finally {
    f.close();
  }
});
test("a counter killing the attacker suppresses its later waves without spending their EN", () => {
  const f = fixture();
  try {
    const { room, game, planner, a, ally, b, gun } = f;
    const harmless = {
      ...gun,
      id: "harmless",
      damageComponents: { shell: 0 },
      attack: {
        ...gun.attack,
        strikes: [{ ...gun.attack.strikes[0], damageComponents: { shell: 0 } }],
      },
    };
    const lethal = {
      ...gun,
      id: "lethal",
      attack: {
        ...gun.attack,
        strikes: Array.from({ length: 10 }, () => ({
          ...gun.attack.strikes[0],
          damageComponents: { shell: 10000 },
        })),
      },
    };
    G.models.wave_test = { ...G.models.wave_test, weapons: [harmless, lethal] };
    a.hp = 1;
    planner.plan(room, a, b, [harmless, harmless], 0);
    const [request] = planner.prepare(room);
    planner.choose(room, request.id, "counter", [lethal.id], a.id);
    const en = a.en;
    const battles = planner.resolve(room);
    assert.equal(a.hp, 0);
    assert.equal(a.en, en - G.weaponStats(harmless, a).en);
    assert.deepEqual(
      battles.map((b) => b.combatStage),
      ["attack", "counter"],
    );
    assert.equal(ally.hp, 1000000);
    assert.equal(game.winner, null);
  } finally {
    f.close();
  }
});
test("stun applies one non-stacking 25 percent AP loss next own turn, then clears", () => {
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
    assert.equal(b.actionPoints, 3);
    assert.equal(b.apPenaltyNextTurn, undefined);
    G.end(game);
    G.end(game);
    assert.equal(b.actionPoints, 5);
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
    assert.equal(b.actionPoints, 6);
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
  Object.assign(b, { x: 14, y: 10, hp: 1000000 });
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
  assert.equal(battles[0].combatWave, 0);
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
    Object.assign(b, { x: 14, y: 10 });
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
    b.x = movement === "outside" ? 25 : 15;
    if (movement === "destroyed") b.hp = 0;
    G.end(game);
    planner.resumeCharges(room);
    assert.equal(room.plans.length, movement === "inside" ? 1 : 0);
    if (movement === "inside") {
      assert.deepEqual(room.plans[0].aimCell, { x: 15, y: 10 });
      const [request] = planner.prepare(room);
      assert(request);
      planner.choose(room, request.id, "evade");
      assert.equal(planner.resolve(room).length, 1);
      assert.equal(a.en, en - G.weaponStats(w, a).en);
    } else assert.equal(a.en, en);
  });

test("repeated blast counters keep distinct launches across waves and charge EN once per blast",()=>{
 const f=fixture();try{
  const {room,planner,a,ally,b,gun}=f;
  const blast={...gun,id:"counter-blast",special:{type:"blast",radius:1,shape:"cross"}};
  G.models.wave_test={...G.models.wave_test,weapons:[gun,blast]};ally.x=a.x+1;
  planner.plan(room,a,b,[gun],0);const [request]=planner.prepare(room);
  planner.choose(room,request.id,"counter",[blast.id,blast.id,blast.id],a.id);
  const en=b.en;const battles=planner.resolve(room).filter(b=>b.combatStage==="counter");
  assert.equal(battles.length,3);assert(battles.every(b=>b.events.length===2));
  assert.equal(new Set(battles.flatMap(b=>b.events.map(e=>e.blastId))).size,3);
  assert.equal(b.en,en-3*G.weaponStats(blast,b).en);assert.equal(b.counterCount,1);
 }finally{f.close();}
});

for (const counter of [false,true]) test(`gated blast resolves every victim and spends one turn use, counter=${counter}`,()=>{
 const f=fixture();try{
  const {room,planner,a,ally,b,other,gun}=f;
  const blast={...gun,id:"gated-blast",pilotRequirements:[{stat:"accuracy",operator:">=",value:0}],special:{type:"blast",radius:1,shape:"cross"}};
  G.models.wave_test={...G.models.wave_test,weapons:[gun,blast]};
  const actor=counter?b:a;
  if(counter) {ally.x=a.x+1;planner.plan(room,a,b,[gun],0);}
  else {other.x=b.x+1;planner.plan(room,a,b,[blast],0);}
  for(const request of planner.prepare(room))
   planner.choose(room,request.id,counter?"counter":"evade",counter?[blast.id]:[],a.id);
  const events=planner.resolve(room).flatMap(b=>b.events).filter(e=>e.weapon===blast.id);
  assert.equal(events.length,2);
  assert.equal(actor.pilotWeaponTurnUses[blast.id],1);
  assert.equal(G.canUse(actor,blast),false);
 }finally{f.close();}
});
