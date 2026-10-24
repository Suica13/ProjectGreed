const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  { createRoomEngine } = require("../shared/room-engine.js");
function fixture(t, count = 2, unitCount = 1) {
  let seq = 0;
  const frames = new Map(),
    errors = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id-" + ++seq,
    randomSeed: () => 1,
    randomToken: () => "token-" + ++seq,
    send: (ws, m) => {
      frames.set(ws, m);
      if (m.type === "error") errors.set(ws, m);
    },
    aiDelayMs: 10,
  });
  t.after(() => engine.close());
  const clients = Array.from({ length: count }, () => ({ readyState: 1 }));
  engine.join(clients[0], { mode: "create", room: "PLAN" });
  const room = engine.rooms.get("PLAN");
  const act = (seat, action, fields = {}) => {
    errors.delete(clients[seat]);
    engine.action(clients[seat], {
      id: "req-" + ++seq,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      reactionId: frames.get(clients[seat])?.pending?.id,
      action,
      ...fields,
    });
    return errors.get(clients[seat]) || frames.get(clients[seat]);
  };
  if (count > 2)
    act(0, "configure_room", {
      ...G.defaultRoomSettings(),
      mapId: count > 4 ? "frontline_3v3" : "crossroads_2v2",
    });
  for (const ws of clients.slice(1)) engine.join(ws, { mode: "join", room: "PLAN" });
  const formation = Array.from({ length: unitCount }, () => ({
    unitId: "RGM_79",
    kitId: "machine_gun",
  }));
  for (let seat = 0; seat < count; seat++) act(seat, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  for (let seat = 0; seat < count; seat++) act(seat, "confirm_formation");
  for (let seat = 0; seat < count; seat++) act(seat, "confirm_deployment");
  for (const u of room.game.units) {
    Object.assign(u, {
      x: u.team ? 4 : 2,
      y: 4 + Math.floor(G.ownerOf(u) / 2),
      hp: 100000,
      shield: 0,
    });
    room.game.tiles[u.y][u.x] = "plain";
  }
  return { engine, room, clients, act, frames };
}
test("room authority accepts an attack plan without opening a reaction or damaging its target", (t) => {
  const { room, act } = fixture(t);
  const [a, b] = room.game.units,
    seed = room.game.seed;
  const state = act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  assert.equal(state.phase, "idle");
  assert.equal(room.pending, null);
  assert.equal(state.plans.length, 1);
  assert.equal(a.en, 100);
  assert.equal(b.hp, 100000);
  assert.equal(room.game.seed, seed);
});
module.exports = { fixture };

test("only all allied players finishing their plans opens parallel owner responses", (t) => {
  const { room, act } = fixture(t, 4);
  act(0, "attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_90mmMG" });
  act(2, "attack", { unitId: "2-0", targetId: "3-0", weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  assert.equal(room.phase, "idle");
  assert.equal(room.pending, null);
  act(2, "end_turn");
  assert.equal(room.phase, "reaction");
  assert.equal(room.pending.attacker, "0-0");
  assert.equal(room.game.team, 0);
  assert.equal(room.plans.length, 0);
  assert.equal(room.reactions.length, 2);
});

test("responses publish a batch and all players must finish playback before team handoff", (t) => {
  const { room, act } = fixture(t, 4);
  act(0, "attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_90mmMG" });
  act(2, "attack", { unitId: "2-0", targetId: "3-0", weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(2, "end_turn");
  const first = room.pending.id;
  assert.throws(() => act(3, "respond", { response: "defend", reactionId: first }));
  act(1, "respond", { response: "defend" });
  assert.equal(room.combats.length, 0);
  assert.equal(room.responses.length, 1);
  assert.equal(room.game.units.find((u) => u.id === "0-0").en, 100);
  assert.equal(room.game.units.find((u) => u.id === "1-0").hp, 100000);
  assert.equal(room.phase, "reaction");
  assert.equal(room.pending.target, "3-0");
  assert.throws(() => act(3, "respond", { response: "defend", reactionId: first }));
  act(3, "respond", { response: "evade" });
  assert.equal(room.combats.length, 2);
  assert.equal(act(0, "sync").combats.length, 2, "snapshots include every result of this batch");
  assert.equal(room.game.team, 0);
  assert.equal(room.phase, "playback");
  const batchId = room.playback.id;
  for (const seat of [0, 1, 2]) {
    act(seat, "playback_ready", { batchId });
    assert.equal(room.game.team, 0);
  }
  act(3, "playback_ready", { batchId });
  assert.equal(room.game.team, 1);
  assert.equal(room.phase, "idle");
  assert.equal(room.pending, null);
  assert.equal(room.battle, null);
});

test("allies can submit against the same revision; occupancy and turn identity remain authoritative", (t) => {
  const { room, act } = fixture(t, 4),
    revision = room.revision,
    round = room.game.round;
  act(0, "move", { unitId: "0-0", x: 3, y: 4, revision, round });
  act(2, "move", { unitId: "2-0", x: 3, y: 5, revision, round });
  assert.equal(room.game.units.find((u) => u.id === "2-0").moved, true);
  assert.throws(() => act(2, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG" }));
  act(0, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG", revision, round });
  act(0, "cancel_attack", { unitId: "0-0" });
  assert.equal(room.plans.length, 0);
  act(0, "end_turn");
  assert.throws(() => act(0, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG" }));
  act(2, "end_turn");
  const stale = act(1, "move", { unitId: "1-0", x: 5, y: 4, revision, round });
  assert.equal(stale.code, "STALE");
});

test("allied players retain independent movement undo rights", (t) => {
  const { room, act } = fixture(t, 4),
    g = room.game,
    a = g.units.find((u) => u.id === "0-0"),
    ally = g.units.find((u) => u.id === "2-0");
  g.tiles[4][3] = g.tiles[5][3] = "plain";
  act(0, "move", { unitId: a.id, x: 3, y: 4 });
  act(2, "move", { unitId: ally.id, x: 3, y: 5 });
  assert.equal(G.canUndo(g, a), true, "another player's move does not commit this player's move");
  assert.equal(G.canUndo(g, ally), true);
  act(0, "undo", { unitId: a.id });
  assert.deepEqual([a.x, a.y, a.moved], [2, 4, false]);
  assert.equal(G.canUndo(g, ally), true, "another player's undo also leaves undo rights intact");
  act(2, "undo", { unitId: ally.id });
  assert.deepEqual([ally.x, ally.y, ally.moved], [2, 5, false]);
});

test("an allied unit occupying the origin temporarily blocks undo without discarding it", (t) => {
  const { room, act } = fixture(t, 4),
    g = room.game,
    a = g.units.find((u) => u.id === "0-0"),
    ally = g.units.find((u) => u.id === "2-0");
  g.tiles[4][3] = "plain";
  act(0, "move", { unitId: a.id, x: 3, y: 4 });
  act(2, "move", { unitId: ally.id, x: 2, y: 4 });
  assert.ok(a.origin, "the allied move preserves the original position");
  assert.equal(G.canUndo(g, a), false);
  assert.throws(() => act(0, "undo", { unitId: a.id }));
  assert.deepEqual([a.x, a.y], [3, 4], "failed undo cannot overlap the allied unit");
  act(2, "undo", { unitId: ally.id });
  assert.equal(G.canUndo(g, a), true, "undo becomes available again after the origin is vacated");
  act(0, "undo", { unitId: a.id });
  assert.deepEqual([a.x, a.y, a.moved], [2, 4, false]);
});

test("simultaneous move intents cannot overlap a cell, and waiting cancels a queued attack", (t) => {
  const { room, act } = fixture(t, 4),
    revision = room.revision,
    round = room.game.round;
  act(0, "move", { unitId: "0-0", x: 3, y: 4, revision, round });
  assert.throws(() => act(2, "move", { unitId: "2-0", x: 3, y: 4, revision, round }));
  assert.equal(G.canUndo(room.game, room.game.units[0]), true);
  act(0, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG" });
  act(0, "wait", { unitId: "0-0" });
  assert.equal(room.plans.length, 0);
  assert.equal(room.game.units[0].plan, undefined);
  assert.equal(room.game.units[0].acted, true);
  const stale = act(2, "move", {
    unitId: "2-0",
    x: 3,
    y: 5,
    revision,
    round,
    matchId: "older-match",
  });
  assert.equal(stale.code, "STALE");
});

function startPlayback(act) {
  act(0, "attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(1, "respond", { response: "defend" });
}
test("playback rejects stale batches, duplicate completion never changes HP, and a disconnected viewer must resume", (t) => {
  const { room, engine, clients, act } = fixture(t);
  startPlayback(act);
  const batchId = room.playback.id,
    revision = room.revision;
  const hp = room.game.units.map((u) => u.hp);
  assert.throws(() => act(0, "playback_ready", { batchId: "old" }));
  assert.throws(() => act(0, "playback_ready", { batchId, matchId: "old" }));
  act(0, "playback_ready", { batchId, revision });
  act(0, "playback_ready", { batchId, revision });
  assert.equal(room.playback.ready.length, 1);
  const member = room.members.get(clients[1].memberId),
    token = member.token;
  engine.disconnect(clients[1]);
  assert.equal(room.phase, "playback");
  assert.equal(room.game.team, 0);
  const resumed = { readyState: 1 };
  engine.join(resumed, { mode: "resume", room: "PLAN", token });
  assert.equal(room.playback.ready.includes(resumed.memberId), false);
  engine.action(resumed, {
    id: "resume-ready",
    action: "playback_ready",
    batchId,
    matchId: room.matchId,
    revision,
  });
  assert.equal(room.phase, "idle");
  assert.equal(room.game.team, 1);
  assert.deepEqual(
    room.game.units.map((u) => u.hp),
    hp,
  );
});
test("spectators present at batch start also complete playback; new spectators cannot confirm for anyone else", (t) => {
  const { room, engine, act } = fixture(t);
  const observer = { readyState: 1 };
  engine.join(observer, { mode: "join", room: "PLAN" });
  startPlayback(act);
  const batchId = room.playback.id;
  act(0, "playback_ready", { batchId });
  act(1, "playback_ready", { batchId });
  assert.equal(room.phase, "playback");
  const late = { readyState: 1 };
  engine.join(late, { mode: "join", room: "PLAN" });
  assert.throws(() =>
    engine.action(late, {
      id: "late-ready",
      action: "playback_ready",
      batchId,
      matchId: room.matchId,
      revision: room.revision,
    }),
  );
  engine.action(observer, {
    id: "observer-ready",
    action: "playback_ready",
    batchId,
    matchId: room.matchId,
    revision: room.revision,
  });
  assert.equal(room.game.team, 1);
});
test("victory and the return countdown wait for the last viewer to finish", (t) => {
  const { room, act } = fixture(t);
  room.game.units.find((u) => u.id === "1-0").hp = 1;
  room.game.seed = 0;
  startPlayback(act);
  assert.equal(room.game.winner, 0);
  assert.equal(room.phase, "playback");
  assert.equal(room.returnAt, null);
  const batchId = room.playback.id;
  act(0, "playback_ready", { batchId });
  assert.equal(room.returnAt, null);
  act(1, "playback_ready", { batchId });
  assert.equal(room.phase, "finished");
  assert.ok(room.returnAt > Date.now());
});

test("room snapshots preserve the planned handheld weapon through refresh and cancellation", (t) => {
  const { room, act } = fixture(t),
    [a, b] = room.game.units,
    melee = G.modelOf(a).weapons.find((w) => w.type === "melee");
  b.x = a.x + 1;
  b.y = a.y;
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: melee.id });
  const snapshot = act(0, "sync");
  assert.equal(snapshot.game.units.find((u) => u.id === a.id).heldWeapon, melee.id);
  act(0, "cancel_attack", { unitId: a.id });
  assert.equal(act(1, "sync").game.units.find((u) => u.id === a.id).heldWeapon, melee.id);
});

test("room authority accepts paths through allied players while rejecting occupied endpoints", (t) => {
  const { room, act } = fixture(t, 4),
    g = room.game,
    a = g.units.find((u) => u.id === "0-0"),
    ally = g.units.find((u) => u.id === "2-0");
  g.tiles = Array.from({ length: G.mapHeight(g) }, () => Array(G.mapWidth(g)).fill("rock"));
  for (let x = 2; x <= 6; x++) g.tiles[4][x] = "plain";
  Object.assign(a, { x: 2, y: 4 });
  Object.assign(ally, { x: 3, y: 4 });
  for (const enemy of g.units.filter((u) => u.team === 1)) enemy.x = 20;
  assert.throws(() => act(0, "move", { unitId: a.id, x: 3, y: 4 }));
  const result = act(0, "move", { unitId: a.id, x: 5, y: 4 });
  assert.equal(result.type, "state");
  assert.equal(a.x, 5);
  assert.equal(ally.x, 3);
  assert.equal(new Set(g.units.map((u) => u.x + "," + u.y)).size, g.units.length);
});

test("unit action logs identify faction, owner and unit for movement, plans, stances and results", (t) => {
  const { room, act } = fixture(t),
    [a, b] = room.game.units;
  room.seats[0].name = "Pilot01";
  room.seats[1].name = "Pilot02";
  room.game.tiles[4][3] = "plain";
  act(0, "move", { unitId: a.id, x: 3, y: 4 });
  assert.equal(room.log[0], "[蓝方][Pilot01]吉姆 移动至D5。");
  act(0, "undo", { unitId: a.id });
  assert.equal(room.log[0], "[蓝方][Pilot01]吉姆 撤销移动。");
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  assert.match(room.log[0], /^\[蓝方\]\[Pilot01\]吉姆 计划使用/);
  act(0, "cancel_attack", { unitId: a.id });
  assert.equal(room.log[0], "[蓝方][Pilot01]吉姆 取消攻击计划。");
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(1, "respond", { response: "defend" });
  assert.ok(room.log.includes("[红方][Pilot02]吉姆 选择防御。"));
  assert.ok(
    room.log.some((line) =>
      line.startsWith("[蓝方][Pilot01]吉姆 使用90mm机枪 → [红方][Pilot02]吉姆"),
    ),
  );
});

test("three defending players confirm independently at the same revision; results retain attack order", (t) => {
  const { room, act, clients, frames } = fixture(t, 6);
  for (const seat of [0, 2, 4])
    act(seat, "attack", { unitId: seat + "-0", targetId: seat + 1 + "-0", weaponId: "EF_90mmMG" });
  for (const seat of [0, 2, 4]) act(seat, "end_turn");
  const revision = room.revision,
    before = JSON.stringify(room.game),
    requests = [1, 3, 5].map((seat) => frames.get(clients[seat]).pending);
  assert.deepEqual(
    requests.map((r) => r.target),
    ["1-0", "3-0", "5-0"],
  );
  assert.equal(new Set(requests.map((r) => r.id)).size, 3);
  assert.throws(() =>
    act(5, "respond", { response: "evade", reactionId: requests[0].id, revision }),
  );
  act(5, "respond", {
    response: "evade",
    reactionId: requests[2].id,
    revision,
    id: "parallel-choice",
  });
  assert.equal(
    JSON.stringify(room.game),
    before,
    "no damage, energy or RNG before the last choice",
  );
  act(5, "respond", {
    response: "evade",
    reactionId: requests[2].id,
    revision,
    id: "parallel-choice",
  });
  assert.equal(room.responses.length, 1, "a duplicate request never reserves twice");
  assert.throws(() => act(5, "respond", { response: "evade", reactionId: requests[2].id }));
  act(3, "respond", { response: "defend", reactionId: requests[1].id, revision });
  assert.equal(room.phase, "reaction");
  assert.equal(room.combats.length, 0);
  assert.equal(
    frames.get(clients[1]).pending.id,
    requests[0].id,
    "another player's confirmation preserves this request",
  );
  act(1, "respond", { response: "defend", reactionId: requests[0].id, revision });
  assert.equal(room.phase, "playback");
  assert.deepEqual(
    room.combatBatch.map((battle) => battle.a),
    ["0-0", "2-0", "4-0"],
  );
  assert.equal(room.reactions.length, 0);
});

test("one owner receives consecutive unit decisions while a teammate keeps their independent request", (t) => {
  const { room, act, clients, frames } = fixture(t, 4, 2);
  for (const u of room.game.units) {
    u.x = u.team ? 4 : 2;
    u.y = 4 + Math.floor(G.ownerOf(u) / 2) * 4 + Number(u.id.split("-")[1]);
    room.game.tiles[u.y][u.x] = "plain";
  }
  for (const [from, to] of [
    ["0-0", "1-0"],
    ["0-1", "1-1"],
    ["2-0", "3-0"],
  ])
    act(G.ownerOf(room.game.units.find((u) => u.id === from)), "attack", {
      unitId: from,
      targetId: to,
      weaponId: "EF_90mmMG",
    });
  act(0, "end_turn");
  act(2, "end_turn");
  const teammate = frames.get(clients[3]).pending.id,
    later = room.reactions.find((r) => r.target === "1-1");
  assert.throws(() => act(1, "respond", { response: "defend", reactionId: later.id }));
  act(1, "respond", { response: "defend" });
  assert.equal(frames.get(clients[1]).pending.target, "1-1");
  assert.equal(frames.get(clients[3]).pending.id, teammate);
  act(1, "respond", { response: "evade" });
  assert.equal(room.phase, "reaction");
  assert.equal(room.combats.length, 0);
  act(3, "respond", { response: "defend" });
  assert.equal(room.phase, "playback");
  assert.equal(room.combats.length, 3);
});

test("an allied AI answers its own pending request without waiting for the first human response", async (t) => {
  const { room, act } = fixture(t, 4);
  room.seats[3].bot = true;
  for (const seat of [0, 2])
    act(seat, "attack", { unitId: seat + "-0", targetId: seat + 1 + "-0", weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(2, "end_turn");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(room.phase, "reaction");
  assert.equal(room.pending.target, "1-0");
  assert.equal(room.responses.length, 1);
  assert.equal(room.responses[0].intent.target, "3-0");
  assert.equal(room.combats.length, 0);
  act(1, "respond", { response: "defend" });
  assert.equal(room.phase, "playback");
});

test("reconnect restores a player's own unfinished decision while preserving a teammate's confirmation", (t) => {
  const { room, act, clients, frames, engine } = fixture(t, 4);
  for (const seat of [0, 2])
    act(seat, "attack", { unitId: seat + "-0", targetId: seat + 1 + "-0", weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(2, "end_turn");
  const request = frames.get(clients[3]).pending.id;
  act(1, "respond", { response: "defend" });
  const token = room.members.get(clients[3].memberId).token;
  engine.disconnect(clients[3]);
  const resumed = { readyState: 1 };
  engine.join(resumed, { mode: "resume", room: "PLAN", token });
  assert.equal(frames.get(resumed).pending.id, request);
  assert.equal(frames.get(resumed).pending.target, "3-0");
  assert.equal(room.responses.length, 1);
  engine.action(resumed, {
    id: "resumed-response",
    action: "respond",
    response: "evade",
    reactionId: request,
    revision: room.revision,
    round: room.game.round,
    matchId: room.matchId,
  });
  assert.equal(room.phase, "playback");
  assert.equal(room.combats.length, 2);
});
