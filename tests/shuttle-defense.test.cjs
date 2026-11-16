const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const G = require("../shared/rules"),
  M = require("../shared/mission-mode"),
  P = require("../shared/pilots");
const map = G.getMap("mission_shuttle_defense");
const T = require("../shared/ai-tactics");
function fixture() {
  const settings = M.settings(G, map.id),
    host = { id: "host", seat: 0, ws: { readyState: 1 } };
  const formations = Array(10).fill(null);
  formations[0] = [{ unitId: "Medea", kitId: "standard" }];
  const room = {
    settings,
    hostId: host.id,
    members: new Map([[host.id, host]]),
    seats: [host],
    missionAllySeat: 10,
    started: true,
    phase: "idle",
    game: G.create(false, 7319, formations, false, settings),
  };
  M.initialize(room, G);
  const logs = [];
  const poll = () => {
    for (let i = 0; i < 100; i++) {
      M.poll(room, G, (text) => logs.push(text));
      assert.equal(room.game.mission.error, null);
      const d = room.game.mission.dialogue;
      if (!d) return;
      M.advance(room, G, d.id, d.index, (text) => logs.push(text));
    }
    throw Error("Dialogue loop");
  };
  const round = (n) => {
    room.game.round = n;
    poll();
  };
  return { room, poll, round, logs };
}
test("mission names use era and story category with faction suffix", () => {
  assert.deepEqual(
    [
      "mission_white_base",
      "mission_no_fool",
      "mission_bunker_coastal",
      "mission_sleepless_raid",
      "mission_burning_city",
    ].map((id) => G.getMap(id).name),
    [
      "[0079][剧情]相逢在宇宙-EFSF",
      "[0079][原创]绝不上当-EFSF",
      "[0079][原创]人口过剩-EFSF",
      "[0079][原创]彻夜难眠-ZEON",
      "[0087][原创]燃烧的新都市-AEUG",
    ],
  );
});
test("shuttle defense imports three native layers, original hull and 0087T1 scenario restrictions", () => {
  const f = fixture();
  f.poll();
  const shuttles = f.room.game.units.filter((u) => u.missionGroup === "shuttles");
  assert.equal(f.room.settings.costLimit, 6000);
  assert.equal(f.room.settings.missionEra, "UC_0087_T1");
  assert.equal(shuttles.length, 3);
  assert(
    shuttles.every((u) => G.modelOf(u).hp === 300000 && G.cells(u).length === 25 && !G.canEvade(u)),
  );
  assert.equal(G.catalog.prefabs.find((p) => p.id === "Mission_SpaceShuttle").layers.length, 3);
  assert.equal(G.models.Mission_SpaceShuttle__standard.formOnly, true);
  assert.equal(f.room.game.units.filter((u) => u.missionGroup === "guards").length, 12);
  assert(map.tiles.some((row) => row.includes("water")));
  assert.equal(M.objectives(f.room.game, G).failure.at(-1).total, 3);
});
test("two-front waves fill SFS slots, evolve on turn nine, and bring full Garuda plus scripted elite pilots", () => {
  const f = fixture();
  f.poll();
  for (const round of [3, 6, 9, 12, 15, 18, 20, 21, 24, 27, 30, 33]) {
    const before = f.room.game.units.length;
    f.round(round);
    for (const u of f.room.game.units.filter(
      (u) => u.team === 1 && u.model === "BaseJabber__standard" && u.hp > 0,
    ))
      assert.equal(G.hangars.cargo(f.room.game, u).length, 2);
    if (round === 3) {
      assert.equal(f.room.game.units.filter((u) => u.missionGroup === "raiders").length, 36);
      assert.equal(f.room.game.units.filter((u) => u.model.startsWith("RMS_108__")).length, 0);
    }
    if (round === 9) {
      assert(f.room.game.units.some((u) => u.model.startsWith("RMS_108__")));
      assert(f.room.game.units.some((u) => u.model === "NRX_044_MA__standard"));
    }
    if (round === 15) {
      const carrier = f.room.game.units.find((u) => u.missionActor === "garuda");
      assert.equal(G.hangars.cargo(f.room.game, carrier).length, 12);
      assert(
        G.hangars
          .of(carrier)
          .every((h) => G.hangars.used(f.room.game, carrier, h.id) === h.capacity),
      );
    }
    if (round === 20) {
      const elites = f.room.game.units.filter((u) => u.missionGroup === "ace-force");
      assert.equal(elites.length, 3);
      assert.equal(
        elites.find((u) => u.missionActor === "enhanced-gaplant").pilot.genericGrade,
        "enhanced",
      );
      assert(
        elites
          .filter((u) => u.missionActor !== "enhanced-gaplant")
          .every((u) => u.pilot.genericGrade === "ace"),
      );
    }
    // Isolate reinforcement correctness and avoid exhausting the map without a combat simulation.
    for (const u of f.room.game.units.filter((u) => u.team === 1)) u.hp = 0;
    assert.equal(f.room.game.winner, null);
  }
  const kits = new Set(
    f.room.game.units.filter((u) => u.model.startsWith("RMS_106__")).map((u) => u.model),
  );
  assert(kits.size >= 3);
  assert.equal(f.room.game.units.length, map.mission.actors.length + 1);
});
for (const survivors of [0, 1, 2, 3])
  test(`35-turn reward and failure priority with ${survivors} shuttles`, () => {
    const f = fixture();
    f.poll();
    for (const [i, u] of f.room.game.units.filter((u) => u.missionGroup === "shuttles").entries())
      if (i >= survivors) u.hp = 0;
    f.round(34);
    assert.equal(f.room.game.winner, survivors ? null : 1);
    if (survivors) f.round(35);
    assert.equal(f.room.game.winner, survivors ? 0 : 1);
    const reward = M.reward(f.room, G);
    assert.equal(reward.money, [0, 7500, 10000, 12500][survivors]);
    assert.equal(reward.supplies, [0, 10000, 15000, 17500][survivors]);
    assert.equal(reward.inventory.MSA_003, survivors ? (survivors === 3 ? 12 : 9) : undefined);
    assert.equal(reward.inventory.RMS_099, survivors ? 3 : undefined);
    assert.equal(reward.inventory.MSN_100, survivors === 3 ? 1 : undefined);
    if (survivors >= 2) {
      assert.equal(reward.inventory.RX_178_AEUG, 1);
      assert.equal(reward.inventory.MSK_008, 1);
    }
  });
test("all 0087 ACEs have native art, skills, prices and matching technology unlocks", () => {
  const profiles = P.catalog.aces.filter((p) => p.era === "0087");
  assert.equal(profiles.length, 14);
  assert.equal(P.catalog.aces.length, 54);
  const tree = require("../shared/development-tree.json");
  for (const p of profiles) {
    assert(fs.existsSync(p.icon), p.id);
    assert(p.price && p.price.money > 0 && p.price.supplies > 0, p.id);
    assert(
      p.skills.every((s) => s.implemented),
      p.id,
    );
    assert(p.costBase >= 200 && p.costBase <= 300 && p.costBase % 25 === 0);
    assert(p.unlockTech.length, p.id);
    for (const id of p.unlockTech)
      assert(
        tree[p.faction].some((node) => node.id === id && node.unlocks.includes(p.id)),
        p.id,
      );
  }
});
test("enemy flight groups advance toward surviving shuttles instead of unrelated deployment areas", () => {
  const f = fixture();
  f.round(3);
  f.room.game.team = 1;
  const AI = require("../shared/ai-tactics");
  const left = f.room.game.units.find((u) => u.missionActor === "wave-3-coast-0");
  const decision = AI.forUnit(G, f.room.game, left, AI.decide(G, f.room.game, left));
  assert.equal(decision.goal.missionGroup, "shuttles");
  const choice = G.aiChoice(f.room.game, left);
  assert(choice);
  assert(choice.x > left.x);
});
test("communications dialogue portraits use ordinary soldiers in all current missions", () => {
  for (const m of Object.values(G.catalog.maps).filter((m) => m.mission))
    for (const e of m.mission.events)
      for (const a of e.actions)
        if (a.type === "dialogue")
          for (const line of a.lines)
            if (/通[信讯]员/.test(line.name)) {
              assert(line.portrait && !line.portrait.includes("Officer"), m.id);
              assert(fs.existsSync(line.portrait));
            }
});

test("cooperative defense grants each player the surviving shuttle tier once after dialogue finishes", (t) => {
  const { createRoomEngine } = require("../shared/room-engine");
  let n = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => `shuttle-${++n}`,
    randomToken: () => `token-${++n}`,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: () => {},
  });
  t.after(() => engine.close());
  const compact = structuredClone(map);
  compact.id = "mission_shuttle_reward_test";
  compact.mission.events = compact.mission.events.filter((e) =>
    ["opening", "survivors-2", "survivors-3", "launch"].includes(e.id),
  );
  G.catalog.maps[compact.id] = compact;
  t.after(() => delete G.catalog.maps[compact.id]);
  const host = { readyState: 1 },
    guest = { readyState: 1 },
    profile = { characterFaction: "PMC", licenses: { Medea: true }, inventory: { Medea: 5 } };
  engine.join(host, { mode: "create", room: "SHUTTLE", roomMode: "mission", ...profile });
  const room = engine.rooms.get("SHUTTLE");
  const act = (action, fields = {}, ws = host) =>
    engine.action(ws, {
      id: `request-${++n}`,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  act("configure_room", { mapId: compact.id, costLimit: 6000, unitLimit: 18 });
  engine.join(guest, { mode: "join", room: "SHUTTLE", ...profile });
  const formation = [{ unitId: "Medea", kitId: "standard" }];
  act("set_ready", { ready: true, formation }, guest);
  act("start_game", { formation });
  act("confirm_formation", {}, guest);
  act("confirm_formation");
  G.aiDeployment(room.game, 2);
  act("confirm_deployment", {}, guest);
  G.aiDeployment(room.game, 0);
  act("confirm_deployment");
  const finish = () => {
    for (let i = 0; room.game.mission.dialogue; i++) {
      assert(i < 100);
      const d = room.game.mission.dialogue;
      act("mission_dialogue_next", { dialogueId: d.id, lineIndex: d.index });
    }
    assert.equal(room.game.mission.error, null);
  };
  finish();
  room.game.round = 35;
  engine.broadcast(room);
  assert.equal(room.game.winner, null);
  finish();
  assert.equal(room.game.winner, 0);
  const awards = room.economyAwards.filter((a) => a.kind === "result");
  assert.equal(awards.length, 2);
  for (const award of awards) {
    assert.equal(award.money, 15625);
    assert.equal(award.supplies, 21875);
    assert.equal(award.stockGained.inventory.MSN_100, 1);
  }
  assert.equal(
    room.techAwards.reduce((sum, a) => sum + a.points, 0),
    3750,
  );
  engine.broadcast(room);
  assert.equal(room.economyAwards.filter((a) => a.kind === "result").length, 2);
});

test("shuttle raiders advance in three-platform formations with shared goals and full cargo", () => {
  const f = fixture();
  f.poll();
  f.round(3);
  const game = f.room.game;
  assert(!game.units.some((u) => u.model === "DodaiKai__standard"));
  const platforms = game.units.filter((u) => u.model === "BaseJabber__standard");
  assert.equal(platforms.length, 12);
  const groups = new Map();
  for (const u of platforms) {
    assert(u.missionAttackGroup);
    if (!groups.has(u.missionAttackGroup)) groups.set(u.missionAttackGroup, []);
    groups.get(u.missionAttackGroup).push(u);
    const cargo = G.hangars.cargo(game, u);
    assert.equal(cargo.length, 2);
    assert(cargo.every((p) => p.missionAttackGroup === u.missionAttackGroup));
  }
  assert.equal(groups.size, 4);
  for (const members of groups.values()) {
    assert.equal(members.length, 3);
    assert(Math.max(...members.map((u) => u.x)) - Math.min(...members.map((u) => u.x)) <= 2);
    assert(Math.max(...members.map((u) => u.y)) - Math.min(...members.map((u) => u.y)) <= 3);
    const decision = T.decide(G, game, members[0]);
    const goals = members.map((u) => T.forUnit(G, game, u, decision));
    assert(goals.every((g) => g.goal.id === goals[0].goal.id && g.state === "advance"));
    goals[0].goal.hp = 0;
    const retargeted = members.map((u) => T.forUnit(G, game, u, decision));
    assert(retargeted.every((g) => g.goal.hp > 0 && g.goal.id === retargeted[0].goal.id));
    goals[0].goal.hp = G.modelOf(goals[0].goal).hp;
  }
  const byId = new Map(map.mission.actors.map((a) => [a.id, a]));
  for (let round = 3; round <= 33; round += 3)
    for (const side of ["coast", "plain"]) {
      const count = round >= 9 ? 7 : 6;
      const sizes = new Map();
      for (let i = 0; i < count; i++) {
        const p = byId.get(`wave-${round}-${side}-${i}`);
        assert.equal(p.unitId, "BaseJabber");
        sizes.set(p.attackGroup, (sizes.get(p.attackGroup) || 0) + 1);
      }
      assert.deepEqual([...sizes.values()], count === 6 ? [3, 3] : [3, 3, 1]);
    }
});
