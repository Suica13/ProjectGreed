const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { createRoomEngine } = require("../shared/room-engine.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");

for (const state of ["waited", "attack-skill", "planned", "ready"])
  test(`AI attacks with a ${state} squad member without losing actions or plans`, async (t) => {
    let sequence = 0;
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const engine = createRoomEngine({
      rules: G,
      randomId: () => "mixed-" + ++sequence,
      randomToken: () => "token-" + ++sequence,
      randomSeed: () => 1,
      aiDelayMs: 1,
      randomAIMoveDelay: () => 0,
      send: () => {},
    });
    t.after(() => engine.close());
    const clients = [{ readyState: 1 }, { readyState: 1 }];
    engine.join(clients[0], { mode: "create", room: "MIXED", characterFaction: "PMC" });
    engine.join(clients[1], { mode: "join", room: "MIXED", characterFaction: "PMC" });
    const room = engine.rooms.get("MIXED");
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    room.game = G.create(false, 1, [[entry, entry, entry], [entry, entry]], false, {
      fogMode: "disabled",
    });
    room.game.tiles.forEach(row => row.fill("plain"));
    Object.assign(room, {
      started: true, matchId: "mixed-actions", phase: "idle",
      activeSeats: [true, true], turnDone: [false, false], turnNotBefore: 0,
      plans: [], planSequence: 0, responses: [], reactions: [], pending: null,
    });
    const allies = room.game.units.filter(u => u.team === 0);
    const enemies = room.game.units.filter(u => u.team === 1);
    allies.forEach((u, i) => Object.assign(u, {
      x: 5, y: 5, squadId: "mixed-squad", squadSlot: i,
      moved: true, acted: false, en: 10000,
    }));
    enemies.forEach((u, i) => Object.assign(u, { x: 6 + i, y: 5, hp: 100000 }));
    const reserved = allies[0];
    if (state === "planned") {
      const planner = createAttackPlanner(G);
      planner.plan(room, reserved, enemies[1], [], 0, "melee", true);
    } else if (state !== "ready") {
      reserved.acted = true;
      if (state === "attack-skill") reserved.attackSkillRound = room.game.round;
    }
    const oldPlan = structuredClone(reserved.plan);
    const oldOrders = structuredClone(room.plans);
    // An ordinary whole-squad request must still reject an unavailable member.
    if (state === "waited" || state === "attack-skill") {
      const before = structuredClone(room.game.units);
      assert.throws(() => createAttackPlanner(G).plan(room, allies[1], enemies[0], [], 0),
        /小队中存在已行动单位/);
      assert.deepEqual(room.game.units, before);
      assert.equal(room.plans.length, 0);
    }
    room.seats[0].bot = true;
    engine.broadcast(room);
    const deadline = Date.now() + 4000;
    while (!allies.slice(1).every(u => u.plan) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(errors, [], "AI must not reject an attack and fall back to waiting");
    assert.ok(allies.slice(1).every(u => u.plan), "remaining members must both attack");
    if (state === "ready") {
      assert.ok(allies.every(u => u.plan && u.squadOrder), "ready squads still plan together");
    } else {
      assert.equal(reserved.acted, true);
      assert.deepEqual(reserved.plan, oldPlan);
      assert.deepEqual(room.plans.filter(p => p.attacker === reserved.id), oldOrders);
      assert.ok(allies.slice(1).every(u => !u.squadOrder));
      if (state === "attack-skill")
        assert.equal(reserved.attackSkillRound, room.game.round);
    }
  });

for (const fallback of [false, true])
  test(`AI ${fallback ? "failure fallback" : "ordinary wait"} preserves a squadmate's locked attack skill`, async (t) => {
    let sequence = 0;
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const engine = createRoomEngine({
      rules: G,
      randomId: () => "locked-" + ++sequence,
      randomToken: () => "token-" + ++sequence,
      randomSeed: () => 1,
      aiDelayMs: 1,
      randomAIMoveDelay: () => 0,
      send: () => {},
    });
    t.after(() => engine.close());
    const clients = [{ readyState: 1 }, { readyState: 1 }];
    engine.join(clients[0], { mode: "create", room: "LOCKED", characterFaction: "PMC" });
    engine.join(clients[1], { mode: "join", room: "LOCKED", characterFaction: "PMC" });
    const room = engine.rooms.get("LOCKED");
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    room.game = G.create(false, 1, [[entry, entry], [entry]], false, {fogMode:"disabled"});
    room.game.tiles.forEach(row => row.fill("plain"));
    Object.assign(room, {started:true,matchId:"locked-actions",phase:"idle",activeSeats:[true,true],
      turnDone:[false,false],turnNotBefore:0,plans:[],planSequence:0,responses:[],reactions:[],pending:null});
    const [locked, ready, enemy] = room.game.units;
    for (const [index,unit] of [locked,ready].entries()) Object.assign(unit,{
      x:5,y:5,squadId:"locked-squad",squadSlot:index,moved:true,acted:false,en:10000});
    Object.assign(enemy,{x:fallback?6:25,y:5,hp:100000});
    const weapon=G.modelOf(locked).weapons[0];
    const intent={attacker:locked.id,target:enemy.id,weapon:weapon.id,weapons:[weapon.id],seat:0,order:1};
    room.plans=[intent];
    Object.assign(locked,{acted:true,attackSkillRound:room.game.round,plan:{target:enemy.id,weapon:weapon.id,weapons:[weapon.id]}});
    const originalPlan=structuredClone(locked.plan), originalOrders=structuredClone(room.plans);
    let rejected=0;
    if(fallback) {
      const original=G.firePlan;
      t.mock.method(G,"firePlan",(...args)=>{
        if(args[1]?.id===ready.id && !rejected++) throw Error("injected attack validation failure");
        return original(...args);
      });
    }
    room.seats[0].bot=true;
    engine.broadcast(room);
    const deadline=Date.now()+2500;
    while(!ready.acted && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(ready.acted,true,"AI must finish the idle member rather than retry forever");
    assert.equal(ready.plan,undefined);
    assert.deepEqual(locked.plan,originalPlan);
    assert.deepEqual(room.plans,originalOrders);
    assert.equal(locked.attackSkillRound,room.game.round);
    assert.equal(errors.filter(args=>args[0]==="AI fallback failed").length,0);
    assert.equal(errors.filter(args=>args[0]==="AI action failed").length,fallback?1:0);
  });
