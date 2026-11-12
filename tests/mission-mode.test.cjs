const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  M = require("../shared/mission-mode"),
  D = require("../shared/map-document");
const { createRoomEngine } = require("../shared/room-engine");
function fixture(t, cooperative = false) {
  let n = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "mission-" + ++n,
    randomToken: () => "token-" + ++n,
    randomSeed: () => 7319,
    aiDelayMs: 999999,
    send: (ws, s) => frames.set(ws, s),
  });
  t.after(() => engine.close());
  const host = { readyState: 1 },
    guest = { readyState: 1 };
  const profile = {
    characterFaction: "PMC",
    inventory: { ColumbusClass: 5 },
    licenses: { ColumbusClass: true },
  };
  engine.join(host, { mode: "create", room: "MISSION", roomMode: "mission", ...profile });
  const guests = cooperative ? [guest] : [];
  if (typeof cooperative === "number")
    while (guests.length < cooperative - 1) guests.push({ readyState: 1 });
  for (const ws of guests) engine.join(ws, { mode: "join", room: "MISSION", ...profile });
  const room = engine.rooms.get("MISSION");
  const act = (action, data = {}, ws = host) =>
    engine.action(ws, {
      id: "req-" + ++n,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...data,
    });
  const formation = [{ unitId: "ColumbusClass", kitId: "standard" }];
  for (const ws of guests) act("set_ready", { formation, ready: true }, ws);
  act("start_game", { formation });
  for (const ws of guests) act("confirm_formation", {}, ws);
  act("confirm_formation");
  for (const ws of guests) {
    G.aiDeployment(room.game, room.members.get(ws.memberId).seat);
    act("confirm_deployment", {}, ws);
  }
  G.aiDeployment(room.game, 0);
  act("confirm_deployment");
  const finishDialogue = () => {
    while (room.game.mission.dialogue) {
      const d = room.game.mission.dialogue;
      act("mission_dialogue_next", { dialogueId: d.id, lineIndex: d.index });
    }
  };
  return { engine, room, host, guest, guests, act, frames, finishDialogue };
}
test("cooperative mission loads fixed enemy roster, host guest ship, map technology and synchronized opening", (t) => {
  const f = fixture(t, true),
    { room, act, guest, frames } = f;
  assert.equal(room.settings.mode, "mission");
  assert.equal(room.settings.missionEra, "0079T2");
  assert.equal(room.settings.technologyLimit, 10000);
  assert.equal(room.settings.costLimit, 1200);
  assert.equal(room.settings.unitLimit, 12);
  assert.equal(G.getMap(room.settings.mapId).name, "三分钟十二台大魔");
  assert.equal(room.game.units.filter((u) => u.team === 1).length, 15);
  assert.equal(room.game.units.filter((u) => u.missionGroup === "dom").length, 12);
  assert.equal(room.game.units.filter((u) => u.missionGroup === "ships").length, 3);
  const wb = room.game.units.find((u) => u.missionActor === "whitebase");
  assert.equal(wb.ownerSeat, 0);
  assert(!room.battleRoster[wb.id]);
  assert(G.canControlUnit(room.settings, [...room.members.values()], 0, wb));
  assert(!G.canControlUnit(room.settings, [...room.members.values()], 2, wb));
  assert.equal(frames.get(guest).game.mission.dialogue.index, 0);
  const d = room.game.mission.dialogue;
  assert.throws(
    () => act("mission_dialogue_next", { dialogueId: d.id, lineIndex: 0 }, guest),
    /房主/,
  );
  assert.throws(() => act("end_turn"), /剧情/);
  f.finishDialogue();
  assert.equal(room.game.mission.dialogue, null);
  assert.equal(room.game.winner, null);
});

test("five-player task keeps formation, facing and enemy resource scaling through reinforcements and observers", (t) => {
  const f = fixture(t, 5),
    { room, engine } = f;
  assert.equal(room.game.mission.playerCount, 5);
  assert.equal(room.game.mission.enemyResourceScale, 2);
  assert.equal(room.seats.filter((p) => p && !p.bot).length, 5);
  const observer = { readyState: 1 };
  engine.join(observer, { mode: "join", room: room.code, characterFaction: "PMC" });
  assert.equal(room.members.get(observer.memberId).seat, null);
  assert.equal(room.game.mission.playerCount, 5);
  const wb = room.game.units.find((u) => u.missionActor === "whitebase");
  assert.equal(wb.angle, 90);
  assert(wb.x < 20);
  for (const u of room.game.units.filter((u) => u.missionActor && u.team === 1)) {
    const base = G.modelOf({ ...u, missionResourceScale: 1 }),
      scaled = G.modelOf(u);
    assert.equal(u.angle, 270);
    assert(u.x > 20);
    assert.equal(scaled.hp, base.hp * 2);
    assert.equal(scaled.en, base.en * 2);
    assert.equal(u.hp, scaled.hp);
    assert.equal(u.en, scaled.en);
    assert.deepEqual(scaled.weapons, base.weapons);
  }
  const doms = room.game.units.filter((u) => u.missionGroup === "dom"),
    squads = new Set(doms.map((u) => u.squadId));
  assert.equal(squads.size, 4);
  for (const id of squads)
    assert.equal(
      G.squadMembers(
        room.game,
        doms.find((u) => u.squadId === id),
      ).length,
      3,
    );
  f.finishDialogue();
  doms.slice(0, 6).forEach((u) => (u.hp = 0));
  engine.broadcast(room);
  const char = room.game.units.find((u) => u.missionActor === "char");
  assert.equal(G.modelOf(char).hp, G.modelOf({ ...char, missionResourceScale: 1 }).hp * 2);
  assert.equal(char.en, G.modelOf({ ...char, missionResourceScale: 1 }).en * 2);
});

test("mission win grants each PMC fixed stock and resources exactly once, with conditional extra reward and no loss rewards", (t) => {
  for (const outcome of ["base", "bonus", "defeat"]) {
    const f = fixture(t, true),
      { room, engine } = f;
    f.finishDialogue();
    assert.equal(room.economyAwards.filter((a) => a.kind === "result").length, 0);
    if (outcome === "bonus") {
      room.game.units
        .filter((u) => u.missionGroup === "dom")
        .slice(0, 6)
        .forEach((u) => (u.hp = 0));
      engine.broadcast(room);
      f.finishDialogue();
    } else room.game.round = 11;
    if (outcome === "defeat") room.game.units.find((u) => u.missionActor === "whitebase").hp = 0;
    else room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
    engine.broadcast(room);
    assert.equal(room.game.winner, outcome === "defeat" ? 1 : 0);
    const awards = room.economyAwards.filter((a) => a.kind === "result");
    assert.equal(awards.length, 2);
    for (const award of awards) {
      assert.equal(award.money, outcome === "defeat" ? 0 : outcome === "bonus" ? 4000 : 2000);
      assert.equal(award.supplies, outcome === "defeat" ? 0 : outcome === "bonus" ? 6000 : 3000);
      assert.deepEqual(
        award.stockGained.inventory,
        outcome === "defeat"
          ? {}
          : outcome === "bonus"
            ? { RX_77_2: 2, RX_78_2: 1 }
            : { RX_77_2: 2 },
      );
    }
    engine.broadcast(room);
    assert.equal(room.economyAwards.filter((a) => a.kind === "result").length, 2);
    assert.equal(room.techAwards.length, 0);
  }
});
test("six dom kills through round 10 spawn Lv3 rivals once, add Amuro protection and preserve dialogue order", (t) => {
  const f = fixture(t),
    { room, engine } = f;
  f.finishDialogue();
  room.game.round = 10;
  room.game.units
    .filter((u) => u.missionGroup === "dom")
    .slice(0, 6)
    .forEach((u) => (u.hp = 0));
  engine.broadcast(room);
  const actors = room.game.units.filter((u) => ["amuro", "char"].includes(u.missionActor));
  assert.equal(actors.length, 2);
  assert(actors.every((u) => u.pilot.level === 3));
  assert(room.game.mission.protect.includes("amuro"));
  assert.deepEqual(
    room.game.mission.dialogue.lines.map((l) => l.name),
    ["阿姆罗", "夏亚", "阿姆罗"],
  );
  f.finishDialogue();
  engine.broadcast(room);
  assert.equal(room.game.units.filter((u) => u.missionActor === "char").length, 1);
  actors.find((u) => u.missionActor === "amuro").hp = 0;
  engine.broadcast(room);
  assert.equal(room.game.winner, 1);
});
test("late kills skip extra event; enemy extermination wins and WhiteBase or PMC extinction loses", (t) => {
  for (const kind of ["late", "whitebase", "pmc"]) {
    const f = fixture(t),
      { room, engine } = f;
    f.finishDialogue();
    if (kind === "late") {
      room.game.round = 11;
      room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
    }
    if (kind === "whitebase") room.game.units.find((u) => u.missionActor === "whitebase").hp = 0;
    if (kind === "pmc")
      room.game.units.filter((u) => !u.missionActor && u.team === 0).forEach((u) => (u.hp = 0));
    engine.broadcast(room);
    assert.equal(room.game.winner, kind === "late" ? 0 : 1);
    assert(
      !room.economyAwards.some((a) => a.losses?.WhiteBase || a.stockLost?.inventory?.WhiteBase),
    );
    assert(!room.game.units.some((u) => u.missionActor === "char"));
  }
});
test("mission scripts roundtrip map exports and reject invalid actor references", () => {
  const map = G.getMap(M.defaultMapId),
    doc = D.importMap(map),
    out = D.compile(doc);
  assert.deepEqual(out.mission, map.mission);
  const invalid = structuredClone(doc);
  invalid.mission.events[0].actions[0].lines[0].actor = "missing";
  assert.throws(() => D.validate(invalid), /脚本/);
  assert.equal(
    require("../tools/import-map.cjs").importMap("assets/maps/missions/white_base.json", {
      checkOnly: true,
    }).id,
    "mission_white_base",
  );
});

test("automatic combat leaves mission victory to post-playback events, including the last enemy", (t) => {
  const f = fixture(t);
  f.finishDialogue();
  f.room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
  G.resolveAutomatic(f.room, [], () => "empty-combat");
  assert.equal(f.room.game.winner, null);
  f.engine.broadcast(f.room);
  assert(f.room.game.units.some((u) => u.missionActor === "char" && u.hp > 0));
  f.finishDialogue();
  assert.equal(f.room.game.winner, null);
  f.room.game.units.find((u) => u.missionActor === "char").hp = 0;
  f.engine.broadcast(f.room);
  assert.equal(f.room.game.winner, 0);
});

test("round-ten defeats still trigger if playback hands control to round eleven before evaluation", (t) => {
  const f = fixture(t);
  f.finishDialogue();
  f.room.game.round = 10;
  f.room.game.units
    .filter((u) => u.missionGroup === "dom")
    .slice(0, 6)
    .forEach((u) => (u.hp = 0));
  M.observe(f.room);
  f.room.game.round = 11;
  f.engine.broadcast(f.room);
  assert(f.room.game.units.some((u) => u.missionActor === "char"));
});

test("dialogue actions suspend later actions and resume in visual editor order", (t) => {
  const f = fixture(t);
  f.finishDialogue();
  const map = structuredClone(G.getMap(M.defaultMapId));
  map.id = "mission_order_test";
  map.mission.events.push({
    id: "ordered",
    name: "ordered",
    when: { type: "round", round: 1 },
    actions: [
      { type: "dialogue", lines: [map.mission.events[0].actions[0].lines[0]] },
      { type: "spawn", actors: ["amuro"] },
      { type: "dialogue", lines: [map.mission.events[1].actions[2].lines[0]] },
    ],
  });
  G.catalog.maps[map.id] = map;
  t.after(() => delete G.catalog.maps[map.id]);
  f.room.settings.mapId = map.id;
  f.engine.broadcast(f.room);
  assert(!f.room.game.units.some((u) => u.missionActor === "amuro"));
  const d = f.room.game.mission.dialogue;
  f.act("mission_dialogue_next", { dialogueId: d.id, lineIndex: 0 });
  assert(f.room.game.units.some((u) => u.missionActor === "amuro"));
  assert.equal(f.room.game.mission.dialogue.lines[0].actor, "amuro");
  f.finishDialogue();
  assert.equal(f.room.game.mission.continuation, null);
});

test("spectator hosts do not strand dialogue or ownership of story units", (t) => {
  const f = fixture(t, true),
    observer = { readyState: 1 };
  f.engine.join(observer, { mode: "join", room: "MISSION", characterFaction: "PMC" });
  assert.equal(f.room.members.get(observer.memberId).seat, null);
  f.room.hostId = observer.memberId;
  f.engine.broadcast(f.room);
  assert.equal(f.room.game.mission.commanderId, f.host.memberId);
  f.finishDialogue();
  assert.equal(f.room.game.mission.dialogue, null);
});

test("compound conditions, defeat triggers, chained events, recovery and notices execute once in order", (t) => {
  const f = fixture(t);
  f.finishDialogue();
  const map = structuredClone(G.getMap(M.defaultMapId));
  map.id = "mission_event_types";
  map.mission.events = [];
  delete map.mission.rewards;
  const wb = f.room.game.units.find((u) => u.missionActor === "whitebase"),
    max = G.modelOf(wb);
  wb.hp = Math.floor(max.hp * 0.4);
  wb.en = 0;
  map.mission.events.push(
    {
      id: "support",
      name: "support",
      when: {
        type: "all",
        conditions: [
          { type: "round", round: 2 },
          {
            type: "any",
            conditions: [
              { type: "actor_destroyed", actor: "dom-1" },
              { type: "actor_hp", actor: "whitebase", percent: 50 },
            ],
          },
        ],
      },
      actions: [
        { type: "recover", actors: ["whitebase"], hpPercent: 50, enPercent: 100 },
        { type: "unprotect", actors: ["whitebase"] },
        { type: "message", text: "Support arrived" },
      ],
    },
    {
      id: "followup",
      name: "followup",
      when: { type: "event_completed", event: "support" },
      actions: [
        { type: "protect", actors: ["whitebase"] },
        { type: "message", text: "Continue the mission" },
      ],
    },
  );
  // Select an actual roster ID rather than coupling the test to the generator's numbering.
  map.mission.events[0].when.conditions[1].conditions[0].actor = map.mission.actors.find(
    (a) => a.group === "dom",
  ).id;
  M.validate(map.mission, map, G);
  G.catalog.maps[map.id] = map;
  t.after(() => delete G.catalog.maps[map.id]);
  f.room.settings.mapId = map.id;
  f.engine.broadcast(f.room);
  assert(wb.hp < max.hp * 0.5);
  f.room.game.round = 2;
  f.engine.broadcast(f.room);
  assert.equal(wb.hp, Math.floor(max.hp * 0.4) + Math.round(max.hp * 0.5));
  assert.equal(wb.en, max.en);
  assert(f.room.game.mission.protect.includes("whitebase"));
  assert.equal(f.room.game.mission.notice, "Continue the mission");
  const hp = wb.hp;
  f.engine.broadcast(f.room);
  assert.equal(wb.hp, hp);
  map.mission.events.push({
    id: "destroyed",
    name: "destroyed",
    when: { type: "group_destroyed", group: "ships" },
    actions: [{ type: "message", text: "Ships destroyed" }],
  });
  f.room.game.units.filter((u) => u.missionGroup === "ships").forEach((u) => (u.hp = 0));
  f.engine.broadcast(f.room);
  assert.equal(f.room.game.mission.notice, "Ships destroyed");
});

test("event validation rejects unsafe recovery, broken references and excessive nesting with locations", () => {
  const map = structuredClone(G.getMap(M.defaultMapId)),
    m = map.mission;
  m.events[0].actions = [{ type: "recover", actors: ["whitebase"], hpPercent: 101, enPercent: 50 }];
  assert.throws(() => M.validate(m, map), /第 1 个动作/);
  m.events[0].actions = [];
  m.events[0].when = { type: "event_completed", event: "missing" };
  assert.throws(() => M.validate(m, map), /触发条件/);
  m.events[0].when = {
    type: "all",
    conditions: [{ type: "all", conditions: [{ type: "all", conditions: [{ type: "start" }] }] }],
  };
  assert.throws(() => M.validate(m, map), /触发条件/);
});
