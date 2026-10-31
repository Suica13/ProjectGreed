const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  P = G.pilots;
const { createRoomEngine } = require("../shared/room-engine.js");
function fixture(t, mode = "regular", experienceBonus = 1) {
  let seq = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    getRewardMultipliers: () => ({experience:experienceBonus,money:1,supplies:1,technology:1}),
    randomId: () => `id-${++seq}`,
    randomSeed: () => 1,
    randomToken: () => `token-${++seq}`,
    send: (ws, msg) => frames.set(ws, msg),
  });
  t.after(() => engine.close());
  const clients = [{ readyState: 1 }, { readyState: 1 }];
  clients.forEach((ws, i) =>
    engine.join(ws, { mode: i ? "join" : "create", room: "ASSIST", characterFaction: "PMC", inventory: { Type61: 10 } }),
  );
  const room = engine.rooms.get("ASSIST");
  function act(i, action, fields = {}) {
    engine.action(clients[i], {
      id: `req-${++seq}`,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      reactionId: frames.get(clients[i])?.pending?.id,
      action,
      ...fields,
    });
  }
  act(0, "configure_room", {
    ...G.defaultRoomSettings(),
    battleMode: mode,
    costLimit: 99999,
    unitCostLimit: 99999,
    fogMode: "disabled",
  });
  const tank = { unitId: "Type61", kitId: "standard" };
  const formations = [
    [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...tank,
        customPilot: P.createCustom(`custom-assist-${i}`, "Pilot" + i),
      })),
    ],
    [tank],
  ];
  clients.forEach((_, i) => act(i, "set_ready", { ready: true, formation: formations[i] }));
  act(0, "start_game", { formation: formations[0] });
  clients.forEach((_, i) => act(i, "confirm_formation"));
  clients.forEach((_, i) => act(i, "confirm_deployment"));
  room.game.tiles.forEach((row) => row.fill("plain"));
  room.game.seed = 1;
  const positions = [
    [2, 4],
    [2, 5],
    [3, 3],
    [3, 5],
    [4, 4],
  ];
  room.game.units.forEach((u, i) =>
    Object.assign(u, { x: positions[i][0], y: positions[i][1], shield: 0 }),
  );
  function resolve() {
    act(0, "end_turn");
    for (let i = 0; i < 8 && room.phase === "reaction"; i++)
      act(1, "respond", { response: "evade" });
  }
  return { engine, room, clients, frames, act, resolve };
}
test("actual hull hits accumulate before a different pilot kills the target in the same batch", (t) => {
  const f = fixture(t),
    target = f.room.game.units[4];
  for (const actor of f.room.game.units.slice(0, 4))
    f.act(0, "attack", { unitId: actor.id, targetId: target.id, weaponId: "EF_Type61_Cannon" });
  f.resolve();
  assert.equal(target.hp, 0);
  const awards = f.frames.get(f.clients[0]).pilotAwards;
  const assist = awards.find((a) => a.pilotId === "custom-assist-0" && a.kind === "assist");
  assert.ok(assist, JSON.stringify({ phase: f.room.phase, awards }));
  assert.equal(assist.experiencePoints, Math.floor(G.modelOf(target).cost * 0.25));
  assert.equal(f.room.game.units[0].pilot.record.kills, 0);
  assert.equal(awards.filter((a) => a.kind === "kill").length, 1);
  assert.equal(f.room.pilotDamage[target.id], undefined);
});
for (const scenario of [
  "threshold",
  "below",
  "dead",
  "embarked",
  "quick",
  "saved-regular",
  "saved-quick",
]) {
  test(`assist eligibility: ${scenario}`, (t) => {
    const f = fixture(t, scenario.includes("quick") ? "quick" : "regular");
    const [contributor, killer, , , target] = f.room.game.units;
    // A persisted contribution from an earlier attack; the finishing hit is resolved normally.
    f.room.pilotDamage = {
      [target.id]: {
        contributor: {
          seat: G.ownerOf(contributor),
          pilotId: contributor.pilot.id,
          damage: G.modelOf(target).hp * 0.25 - (scenario === "below" ? 1 : 0),
        },
      },
    };
    if (scenario === "dead") contributor.hp = 0;
    if (scenario === "embarked")
      contributor.embarked = { carrierId: f.room.game.units[2].id, hangarId: "Hangar_1" };
    const initialAwards = f.room.pilotAwards.length;
    if (scenario.startsWith("saved")) f.room.startedFromSave = true;
    target.hp = 1;
    f.act(0, "attack", { unitId: killer.id, targetId: target.id, weaponId: "EF_Type61_Cannon" });
    f.resolve();
    assert.equal(target.hp, 0);
    const awards = f.frames.get(f.clients[0]).pilotAwards;
    const assist = awards.find((a) => a.pilotId === contributor.pilot.id && a.kind === "assist");
    if (["dead", "below"].includes(scenario)) {
      assert.equal(assist, undefined);
      return;
    }
    if (scenario.startsWith("saved")) {
      assert.equal(assist, undefined);
      assert.equal(awards.length, initialAwards);
      assert.ok(awards.every(a => a.experiencePoints === 0));
      return;
    }
    assert.ok(assist);
    const xp = scenario.startsWith("saved")
      ? 0
      : Math.floor(G.modelOf(target).cost * 0.25 * (scenario === "quick" ? 0.25 : 1));
    assert.equal(assist.experiencePoints, xp);
    assert.equal(contributor.pilot.experience, xp);
    if (scenario === "embarked") assert.equal(assist.carrierId, contributor.embarked.carrierId);
    const store = {
      pilots: [P.createCustom(contributor.pilot.id, contributor.pilot.name)],
      awards: [],
    };
    P.creditAwards(store, awards);
    assert.equal(store.pilots[0].experience, xp);
    assert.equal(P.creditAwards(store, awards), false);
  });
}

test("authoritative level-up metadata and technology credits exist before the playback barrier", (t) => {
  const f = fixture(t),
    killer = f.room.game.units[0],
    target = f.room.game.units[4];
  killer.pilot.experience = 999;
  target.hp = 1;
  f.act(0, "attack", { unitId: killer.id, targetId: target.id, weaponId: "EF_Type61_Cannon" });
  f.resolve();
  const snapshot = f.frames.get(f.clients[0]);
  assert.equal(snapshot.phase, "playback");
  assert.equal(killer.pilot.level, 1);
  assert.equal(killer.pilot.points, 120);
  assert.equal(snapshot.pilotAwards.find((a) => a.kind === "kill").leveledUp, true);
  assert.ok(snapshot.techAwards[0].points > 0);
  assert.equal(snapshot.techAwards[0].round, f.room.game.round);
  assert.equal(snapshot.techAwards[0].team, f.room.game.team);
});

test("player damage combines ordinary pilots across units",t=>{
 const f=fixture(t),target=f.room.game.units[4];target.hp=100000;
 for(const actor of f.room.game.units.slice(0,4)){
  actor.pilot.custom=false;
  f.act(0,"attack",{unitId:actor.id,targetId:target.id,weaponId:"EF_Type61_Cannon"});
 }
 f.resolve();
 const total=100000-target.hp;assert(total>G.modelOf(target).hp*.25);
 assert.equal(f.room.playerDamage[target.id][f.room.seats[0].id].damage,total);
});


for (const mode of ["regular", "quick"]) for (const saved of [false,true]) for (const bonus of [1,2]) {
  test(`learning computer boosts kill and embarked assist experience: ${mode}, saved=${saved}, event=${bonus}`, t => {
    const f = fixture(t,mode,bonus);
    const [contributor,killer,,,target] = f.room.game.units;
    const [modelId,model] = Object.entries(G.models).find(([,m])=>m.prefabId === "RX_78_2");
    for (const actor of [contributor,killer]) Object.assign(actor,{model:modelId,en:model.en,hp:model.hp});
    contributor.embarked = {carrierId:f.room.game.units[2].id,hangarId:"Hangar_1"};
    f.room.pilotDamage = {[target.id]:{contributor:{seat:G.ownerOf(contributor),pilotId:contributor.pilot.id,
      damage:G.modelOf(target).hp * .25}}};
    const initialAwards = f.room.pilotAwards.length;
    f.room.startedFromSave = saved;
    target.hp = 1;
    // The native rifle hits with this deterministic seed; the assist pilot stays aboard.
    const weapon = model.weapons.find(w=>w.type !== "melee");
    f.act(0,"attack",{unitId:killer.id,targetId:target.id,weaponId:weapon.id});
    f.resolve();
    assert.equal(target.hp,0);
    const awards = f.frames.get(f.clients[0]).pilotAwards;
    if (saved) {
      assert.equal(awards.length,initialAwards);
      assert.equal(killer.pilot.experience,0);
      assert.equal(contributor.pilot.experience,0);
      return;
    }
    const speed = mode === "quick" ? .25 : 1;
    for (const [actor,kind,share] of [[killer,"kill",1],[contributor,"assist",.25]]) {
      const award = awards.find(a=>a.pilotId === actor.pilot.id && a.kind === kind);
      assert.ok(award,JSON.stringify(awards));
      const expected = Math.floor(G.modelOf(target).cost * share * speed * bonus * 1.25);
      assert.equal(award.experiencePoints,expected);
      assert.equal(actor.pilot.experience,expected);
      const store = {pilots:[P.createCustom(actor.pilot.id,actor.pilot.name)],awards:[]};
      P.creditAwards(store,awards);
      assert.equal(store.pilots[0].experience,expected,"saved personal progress must not apply the bonus twice");
      assert.equal(P.creditAwards(store,awards),false);
    }
  });
}

test("learning computer is attached to all native LPC hulls, including legacy core fighter", () => {
  const expected = new Set(["RX_78_1","FF_X7","RX_78_2","RX_77_2","RX_75","FF_X7Bst","RX_78NT_1_FA","RX_78_3","RX_78_2_ACE","RX_78_2_BPart"]);
  const actual = new Set();
  for (const m of Object.values(G.models)) {
    if (!m.pilotExperienceMultiplier) continue;
    actual.add(m.prefabId);
    assert.equal(m.pilotExperienceMultiplier,1.25);
    const mechanic = m.mechanics.find(m=>m.id === "LPC");
    assert.equal(mechanic.status,"adapted");
    assert.equal(mechanic.name,"学习型电脑：驾驶员经验获取×1.25");
  }
  assert.deepEqual(actual,expected);
});


for (const scenario of ["regular", "quick", "saved", "max"]) {
  test(
    "ACE authoritative XP follows native leveling and existing mode rules: " +
      scenario,
    (t) => {
      const f = fixture(t, scenario === "quick" ? "quick" : "regular");
      const [actor, , , , target] = f.room.game.units;
      const profile = P.catalog.aces.find((p) => p.price),
        original = P.createAce(profile.id);
      actor.pilot =
        scenario === "max" ? P.gainExperience(original, 1000000) : original;
      const before = structuredClone(actor.pilot);
      if (scenario === "saved") f.room.startedFromSave = true;
      target.hp = 1;
      f.act(0, "attack", {
        unitId: actor.id,
        targetId: target.id,
        weaponId: "EF_Type61_Cannon",
      });
      f.resolve();
      assert.equal(target.hp, 0);
      const award = f.frames
        .get(f.clients[0])
        .pilotAwards.find(
          (a) => a.pilotId === actor.pilot.id && a.kind === "kill",
        );
      if (scenario === "saved") {
        assert.equal(award, undefined);
        assert.deepEqual(actor.pilot, before);
        return;
      }
      assert(award);
      assert.equal(
        award.experiencePoints,
        scenario === "max"
          ? 0
          : Math.floor(
              G.modelOf(target).cost * (scenario === "quick" ? 0.25 : 1),
            ),
      );
      assert.equal(actor.pilot.level, before.level);
      assert.equal(actor.pilot.record.kills, 1);
      assert.deepEqual(actor.pilot.stats, before.stats);
    },
  );
}

for (const mode of ["regular", "quick", "saved"]) {
  test(
    "ACE death award preserves progress and follows loss policy: " + mode,
    (t) => {
      const f = fixture(t, mode === "quick" ? "quick" : "regular"),
        [killer, , , , target] = f.room.game.units;
      const source = P.catalog.aces.find((p) => p.price),
        before = P.gainExperience(
          P.createAce(source.id),
          source.experienceBase + 123,
        );
      target.pilot = structuredClone(before);
      target.hp = 1;
      if (mode === "saved") f.room.startedFromSave = true;
      f.act(0, "attack", {
        unitId: killer.id,
        targetId: target.id,
        weaponId: "EF_Type61_Cannon",
      });
      f.resolve();
      assert.equal(target.hp, 0);
      const award = f.frames
        .get(f.clients[1])
        .pilotAwards.find((a) => a.pilotId === before.id && a.kind === "loss");
      if (mode === "saved") {
        assert.equal(award, undefined);
        assert.deepEqual(target.pilot, before);
        return;
      }
      assert(award);
      assert.equal(award.requiresRecruitment, mode === "regular");
      assert.equal(target.pilot.needsRecruitment, mode === "regular");
      const store = { pilots: [before], awards: [] };
      P.creditAwards(store, [award]);
      assert.equal(store.pilots[0].needsRecruitment, mode === "regular");
      assert.equal(store.pilots[0].level, 1);
      assert.equal(store.pilots[0].experience, 123);
      assert.equal(store.pilots[0].record.losses, 1);
    },
  );
}
