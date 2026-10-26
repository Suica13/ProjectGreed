const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  { createRoomEngine } = require("../shared/room-engine.js");
function fixture(t, count = 2, unitCount = 1, options = {}) {
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
    ...options,
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
  assert.equal(a.en, G.modelOf(a).en);
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
  assert.equal(room.game.units.find((u) => u.id === "0-0").en, G.models.RGM_79__machine_gun.en);
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
  moveAndConfirm(act, 0, { unitId: "0-0", x: 3, y: 4, revision, round });
  moveAndConfirm(act, 2, { unitId: "2-0", x: 3, y: 5, revision, round });
  assert.equal(room.game.units.find((u) => u.id === "2-0").moved, true);
  assert.throws(() => act(2, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG" }));
  act(0, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG", revision, round });
  act(0, "cancel_attack", { unitId: "0-0" });
  assert.equal(room.plans.length, 0);
  act(0, "end_turn");
  assert.throws(() => act(0, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG" }));
  act(2, "end_turn");
  const stale = moveAndConfirm(act, 1, { unitId: "1-0", x: 5, y: 4, revision, round });
  assert.equal(stale.code, "STALE");
});

test("allied players retain independent movement previews and cancellation rights", (t) => {
  const { room, act } = fixture(t, 4),
    [a, enemy, ally] = room.game.units;
  room.game.tiles[4][3] = room.game.tiles[5][3] = "plain";
  act(0, "move", { unitId: a.id, x: 3, y: 4 });
  act(2, "move", { unitId: ally.id, x: 3, y: 5 });
  assert(a.pendingMove);
  assert(ally.pendingMove);
  act(0, "cancel_move", { unitId: a.id });
  assert.equal(a.pendingMove, undefined);
  assert(ally.pendingMove);
  act(2, "confirm_move", { unitId: ally.id });
  assert.deepEqual([ally.x, ally.y, ally.moved], [3, 5, true]);
  assert.deepEqual([a.x, a.y, a.moved], [2, 4, false]);
});

test("provisional movement reserves its original footprint and destination so cancellation always succeeds", (t) => {
  const { room, act } = fixture(t, 4),
    a = room.game.units.find((u) => u.id === "0-0"),
    ally = room.game.units.find((u) => u.id === "2-0");
  room.game.tiles[4][3] = "plain";
  act(0, "move", { unitId: a.id, x: 3, y: 4 });
  assert.throws(() => act(2, "move", { unitId: ally.id, x: 2, y: 4 }));
  assert.throws(() => act(2, "move", { unitId: ally.id, x: 3, y: 4 }));
  act(0, "cancel_move", { unitId: a.id });
  assert.deepEqual([a.x, a.y, a.moved], [2, 4, false]);
  assert.equal(a.pendingMove, undefined);
});

test("simultaneous move intents cannot overlap a cell, and waiting cancels a queued attack", (t) => {
  const { room, act } = fixture(t, 4),
    revision = room.revision,
    round = room.game.round;
  moveAndConfirm(act, 0, { unitId: "0-0", x: 3, y: 4, revision, round });
  assert.throws(() => moveAndConfirm(act, 2, { unitId: "2-0", x: 3, y: 4, revision, round }));
  assert.equal(G.canUndo(room.game, room.game.units[0]), false);
  act(0, "attack", { unitId: "0-0", targetId: "3-0", weaponId: "EF_90mmMG" });
  act(0, "wait", { unitId: "0-0" });
  assert.equal(room.plans.length, 0);
  assert.equal(room.game.units[0].plan, undefined);
  assert.equal(room.game.units[0].acted, true);
  const stale = moveAndConfirm(act, 2, {
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
  assert.throws(() => moveAndConfirm(act, 0, { unitId: a.id, x: 3, y: 4 }));
  const result = moveAndConfirm(act, 0, { unitId: a.id, x: 5, y: 4 });
  assert.equal(result.type, "state");
  assert.equal(a.x, 5);
  assert.equal(ally.x, 3);
  assert.equal(new Set(g.units.map((u) => u.x + "," + u.y)).size, g.units.length);
});

test("unit action logs identify faction, owner and unit for movement, plans, stances and results", (t) => {
  const { room, act } = fixture(t),
    [a, b] = room.game.units;
  a.customName = "先锋[A01]";
  room.seats[0].name = "Pilot01";
  room.seats[1].name = "Pilot02";
  room.game.tiles[4][3] = "plain";
  moveAndConfirm(act, 0, { unitId: a.id, x: 3, y: 4 });
  assert.equal(room.log[0], "[蓝方][Pilot01]先锋[A01](RGM-79 吉姆) 移动至D5。");
  assert.throws(() => act(0, "undo", { unitId: a.id }));
  b.x = a.x + 2;
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  assert.ok(room.log[0].startsWith("[蓝方][Pilot01]先锋[A01](RGM-79 吉姆) 计划使用"));
  act(0, "cancel_attack", { unitId: a.id });
  assert.equal(room.log[0], "[蓝方][Pilot01]先锋[A01](RGM-79 吉姆) 取消攻击计划。");
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(1, "respond", { response: "defend" });
  assert.ok(room.log.includes("[红方][Pilot02]吉姆(RGM-79 吉姆) 选择防御。"));
  assert.ok(
    room.log.some((line) =>
      line.startsWith(
        "[蓝方][Pilot01]先锋[A01](RGM-79 吉姆) 使用90mm机枪 → [红方][Pilot02]吉姆(RGM-79 吉姆)",
      ),
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

test("charged sniper opens at own turn start and playback returns to the same team action phase", (t) => {
  const { room, act } = fixture(t);
  const [a, b] = room.game.units;
  const [key, m] = Object.entries(G.models).find(([key, m]) => m.prefabId === "RGM_79_G_SP");
  a.model = key;
  a.en = m.en;
  b.x = a.x + 4;
  const skill = m.weapons.find((w) => w.special?.type === "snipe");
  room.game.tiles[b.y][b.x] = "plain";
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: skill.id });
  act(0, "end_turn");
  assert.equal(room.game.team, 1);
  assert.ok(a.snipeOrder);
  assert.equal(a.en, m.en);
  act(1, "end_turn");
  assert.equal(room.game.team, 0);
  assert.equal(room.game.round, 3);
  assert.equal(room.phase, "reaction");
  assert.equal(a.plan.charged, true);
  assert.equal(room.pending.attacker, a.id);
  assert.deepEqual(room.pending.counterOptions, []);
  act(1, "respond", { response: "defend" });
  assert.equal(room.phase, "playback");
  assert.equal(room.playback.resumeTurn, true);
  assert.equal(a.en, m.en - skill.en);
  const batchId = room.playback.id;
  act(0, "playback_ready", { batchId });
  act(1, "playback_ready", { batchId });
  assert.equal(room.phase, "idle");
  assert.equal(room.game.team, 0);
  assert.equal(room.game.round, 3);
  assert.equal(a.acted, true);
  assert.equal(room.turnDone[0], false);
});

test("ordered attack queue syncs AP reservations, rejects malformed packets and groups one response per attacker", (t) => {
  const { room, act } = fixture(t, 4);
  const a = room.game.units.find((u) => u.id === "0-0"),
    ally = room.game.units.find((u) => u.id === "2-0");
  a.model = "RX_78NT_1__kit_1";
  a.en = 950;
  const ids = ["EF_RX_78NT_1_BR", "Common_ArmMG", "Common_DoubleVulcan_MS"];
  assert.throws(() =>
    act(0, "attack", { unitId: a.id, targetId: "1-0", weaponIds: [ids[0], ids[0], ids[0]] }),
  );
  assert.equal(a.actionPoints, 5);
  const s = act(0, "attack", { unitId: a.id, targetId: "1-0", weaponIds: ids });
  assert.deepEqual(s.game.units.find((u) => u.id === a.id).plan.weapons, ids);
  assert.equal(a.actionPoints, 0);
  assert.equal(ally.actionPoints, 5);
  act(0, "cancel_attack", { unitId: a.id });
  assert.equal(a.actionPoints, 5);
  act(0, "attack", { unitId: a.id, targetId: "1-0", weaponIds: ids });
  act(0, "end_turn");
  act(2, "end_turn");
  assert.equal(room.phase, "reaction");
  assert.equal(room.pending.counterTargets.length, 1);
  assert.deepEqual(room.pending.counterTargets[0].weapons, ids);
  act(1, "respond", { response: "defend" });
  assert.equal(room.phase, "playback");
  assert.equal(room.combatBatch.length, 3);
  assert.deepEqual(
    room.combatBatch.map((b) => b.events[0].weapon),
    ids,
  );
});

test("deployment logs every occupied player's actual roster and total kit COST exactly once", (t) => {
  const { room, act } = fixture(t, 4, 2),
    summaries = room.log
      .flatMap((text) => text.split("\n"))
      .filter((line) => line.includes("部署编制："));
  assert.equal(summaries.length, 4);
  assert.equal(
    room.log.flatMap((text) => text.split("\n")).filter((line) => line.includes(" 编制：")).length,
    8,
  );
  for (const player of room.seats.filter(Boolean)) {
    const prefix = `[${G.seatTeam(player.seat) ? "红方" : "蓝方"}][${player.name}]`,
      units = room.game.units.filter((u) => G.ownerOf(u) === player.seat),
      cost = units.reduce((n, u) => n + G.modelOf(u).cost, 0);
    assert(summaries.includes(`${prefix}部署编制：2台 · 总计COST ${cost}。`));
    for (const u of units)
      assert(
        room.log.some(
          (line) =>
            line.includes(prefix + G.unitName(u) + "(") &&
            line.includes(" 编制：") &&
            line.includes("COST " + G.modelOf(u).cost),
        ),
      );
  }
  act(0, "sync");
  act(1, "sync");
  assert.equal(room.log.filter((line) => line.includes("部署编制：")).length, 4);
});

for (const ap of [0, 1, 2, 4])
  test(`AI timer uses only affordable attacks with ${ap} remaining AP`, async (t) => {
    const { engine, room } = fixture(t);
    const u = room.game.units.find((u) => u.team === 0);
    u.actionPoints = ap;
    u.moved = true;
    room.seats[0].bot = true;
    engine.broadcast(room);
    await new Promise((resolve) => setTimeout(resolve, 45));
    engine.close();
    assert(u.acted);
    assert(u.actionPoints >= 0);
    if (u.plan) {
      assert(u.plan.actionCost <= ap);
      assert(
        u.plan.weapons.every(
          (id) => G.actionCost(G.modelOf(u).weapons.find((w) => w.id === id)) <= ap,
        ),
      );
    } else assert.equal(ap, 0);
  });

test("disconnect hides player, reserves seat, and resumes within grace", async (t) => {
  const { engine, room, clients, frames } = fixture(t, 2, 1, { reconnectGraceMs: 100 });
  const member = room.seats[1],
    token = member.token;
  engine.disconnect(clients[1]);
  assert.equal(room.seats[1], member);
  assert(!frames.get(clients[0]).members.some((m) => m.id === member.id));
  assert.equal(frames.get(clients[0]).reservedSeats[0].seat, 1);
  const ws = { readyState: 1 };
  engine.join(ws, { mode: "resume", room: room.code, token });
  assert.equal(room.seats[1], member);
  assert.equal(member.ws, ws);
  assert.equal(frames.get(ws).reservedSeats.length, 0);
  await new Promise((r) => setTimeout(r, 130));
  assert.equal(room.seats[1], member);
});

test("expired disconnect frees seat and a replacement can take over", async (t) => {
  const { engine, room, clients } = fixture(t, 2, 1, { reconnectGraceMs: 20 });
  const member = room.seats[1];
  engine.disconnect(clients[1]);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(room.seats[1], null);
  assert(!room.members.has(member.id));
  assert.throws(() =>
    engine.join({ readyState: 1 }, { mode: "resume", room: room.code, token: member.token }),
  );
  const ws = { readyState: 1 };
  engine.join(ws, { mode: "join", room: room.code });
  engine.action(ws, {
    id: "takeover",
    revision: room.revision,
    round: room.game.round,
    action: "switch_seat",
    seat: 1,
  });
  assert.equal(ws.seat, 1);
});

test("all disconnected room survives grace then dissolves", async (t) => {
  const { engine, room, clients } = fixture(t, 2, 1, { reconnectGraceMs: 20 });
  clients.forEach((ws) => engine.disconnect(ws));
  assert(engine.rooms.has(room.code));
  await new Promise((r) => setTimeout(r, 45));
  assert(!engine.rooms.has(room.code));
});

test("shared allies resolve the same reaction in order and stale decisions cannot overwrite it", (t) => {
  const { room, act, frames, clients } = fixture(t, 4);
  room.settings.shareAlliedUnits = true;
  act(0, "attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_90mmMG" });
  act(2, "attack", { unitId: "2-0", targetId: "3-0", weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(2, "end_turn");
  const first = frames.get(clients[1]).pending.id;
  assert.equal(frames.get(clients[3]).pending.id, first);
  act(3, "respond", { reactionId: first, response: "defend" });
  const next = frames.get(clients[1]).pending.id;
  assert.notEqual(next, first);
  assert.equal(frames.get(clients[3]).pending.id, next);
  assert.equal(room.responses.length, 1);
  assert.equal(room.responses[0].response, "defend");
  assert.throws(() => act(1, "respond", { reactionId: first, response: "evade" }));
  assert.equal(room.responses.length, 1);
  assert.equal(room.responses[0].response, "defend");
  act(1, "respond", { reactionId: next, response: "evade" });
  assert.equal(room.phase, "playback");
});

test("explicit departure immediately frees a seat for AI without reconnect reservation", (t) => {
  const { engine, room, clients, act, frames } = fixture(t);
  room.started = false;
  room.phase = "waiting";
  clients[1].close = () => {};
  engine.leaveRoom(clients[1]);
  assert.equal(room.seats[1], null);
  assert.deepEqual(frames.get(clients[0]).reservedSeats, []);
  act(0, "add_ai", { seat: 1 });
  assert.equal(room.seats[1].bot, true);
});

test("expired reserved seat accepts AI in the waiting room", async (t) => {
  const { engine, room, clients, act } = fixture(t, 2, 1, { reconnectGraceMs: 20 });
  room.started = false;
  room.phase = "waiting";
  engine.disconnect(clients[1]);
  assert.throws(() => act(0, "add_ai", { seat: 1 }));
  await new Promise((r) => setTimeout(r, 45));
  act(0, "add_ai", { seat: 1 });
  assert.equal(room.seats[1].bot, true);
});

test("host can kick reserved seat immediately and invalidate reconnect without waiting for expiry", (t) => {
  const { engine, room, clients, act, frames } = fixture(t, 4);
  room.started = false;
  room.phase = "waiting";
  const member = room.seats[1],
    token = member.token;
  engine.disconnect(clients[1]);
  assert.equal(frames.get(clients[0]).reservedSeats[0].memberId, member.id);
  assert.throws(() => act(2, "kick_player", { memberId: member.id }));
  assert.equal(room.seats[1], member);
  act(0, "kick_player", { memberId: member.id });
  assert.equal(room.seats[1], null);
  assert.equal(frames.get(clients[0]).reservedSeats.length, 0);
  assert.throws(() => engine.join({ readyState: 1 }, { mode: "resume", room: room.code, token }));
  act(0, "add_ai", { seat: 1 });
  assert.equal(room.seats[1].bot, true);
});

test("active host can spectate and a newcomer takes over the existing army", (t) => {
  const { engine, room, clients, act, frames } = fixture(t);
  const originalArmy = JSON.stringify(room.game.units);
  const hostId = room.hostId;
  act(0, "switch_seat", { seat: null });
  assert.equal(clients[0].seat, null);
  assert.equal(room.seats[0], null);
  assert.equal(room.hostId, hostId);
  const newcomer = { readyState: 1 };
  engine.join(newcomer, { mode: "join", room: room.code });
  assert.equal(newcomer.seat, null);
  engine.action(newcomer, {
    id: "take-host-seat",
    revision: room.revision,
    action: "switch_seat",
    seat: 0,
  });
  assert.equal(newcomer.seat, 0);
  assert.equal(JSON.stringify(room.game.units), originalArmy);
  assert(frames.get(newcomer).connected.every(Boolean));
  engine.action(newcomer, {
    id: "takeover-plan",
    revision: room.revision,
    matchId: room.matchId,
    round: room.game.round,
    action: "attack",
    unitId: room.game.units[0].id,
    targetId: room.game.units[1].id,
    weaponId: "EF_90mmMG",
  });
  assert.equal(room.plans.length, 1);
});

test("fog logs hide unseen actions and rosters, report the last visible movement cell, and unlock on return", async (t) => {
  const { engine, room, act, frames } = fixture(t, 2, 1, { roomReturnMs: 10 });
  const [a, b] = room.game.units;
  const spectator = { readyState: 1 };
  engine.join(spectator, { mode: "join", room: room.code });
  assert.equal(spectator.seat, null);
  assert(!act(0, "sync").log.some((x) => x.startsWith("[红方]") && x.includes("部署编制")));
  assert(frames.get(spectator).log.some((x) => x.startsWith("[红方]") && x.includes("部署编制")));
  room.game.tiles = Array.from({ length: 40 }, () => Array(50).fill("plain"));
  Object.assign(a, { x: 2, y: 10 });
  Object.assign(b, { x: 12, y: 10, moved: false, acted: false, customName: "SecretEnemy" });
  room.game.team = 1;
  moveAndConfirm(act, 1, { unitId: b.id, x: 14, y: 10 });
  let blue = act(0, "sync");
  assert(blue.log.some((x) => x === "敌人从M11格失踪，朝向东方向。"));
  assert(!blue.log.some((x) => x.includes("SecretEnemy") || x.includes("O11")));
  assert.equal(blue.lastEvent, null);
  assert(!blue.game.units.some((u) => u.id === b.id));
  assert(frames.get(spectator).log.some((x) => x.includes("SecretEnemy") && x.includes("O11")));
  const before = blue.log.slice();
  act(1, "wait", { unitId: b.id });
  assert.deepEqual(act(0, "sync").log, before, "hidden waiting must not leak through LOG/export");
  assert(frames.get(spectator).log[0].includes("待机"));
  act(0, "return_room");
  await new Promise((r) => setTimeout(r, 30));
  blue = act(0, "sync");
  assert.equal(blue.started, false);
  assert.deepEqual(blue.log, room.teamLogs[0], "returning keeps the selected team history intact");
  assert.deepEqual(blue.logExport.options, ["global", "team:0", "team:1"]);
  const download = act(0, "download_log", { perspective: "global" });
  assert.deepEqual(download.log, room.log);
  assert(download.log.some((x) => x.includes("SecretEnemy") && x.includes("O11")));
});

test("entering vision strips the invisible portion of enemy movement", (t) => {
  const { room, act } = fixture(t);
  const [a, b] = room.game.units;
  room.game.tiles = Array.from({ length: 40 }, () => Array(50).fill("plain"));
  Object.assign(a, { x: 2, y: 10 });
  Object.assign(b, { x: 14, y: 10, moved: false, acted: false });
  room.game.team = 1;
  moveAndConfirm(act, 1, { unitId: b.id, x: 11, y: 10 });
  const blue = act(0, "sync");
  assert.equal(blue.lastEvent.type, "move");
  assert.deepEqual(blue.lastEvent.from, { x: 12, y: 10 });
  assert(blue.lastEvent.path.every((p) => p.x <= 12));
  assert.equal(blue.game.units.find((u) => u.id === b.id).origin, null);
});

test("radar contacts use the centre of a rectangular footprint and keep the 1.25 conversion", () => {
  const Sensor = require("../shared/unit-sensors.js");
  const api = Sensor.create({
    modelOf: (u) => ({ sensors: u.sensors }),
    onMap: (u) => u.hp > 0,
    cells: (u) =>
      Array.from({ length: u.w * u.h }, (_, i) => ({
        x: u.x + (i % u.w),
        y: u.y + Math.floor(i / u.w),
      })),
  });
  const a = {
    id: "a",
    team: 0,
    hp: 1,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    sensors: { sight: 2, radar: 20, antiDetection: 0 },
  };
  const b = {
    id: "b",
    team: 1,
    hp: 1,
    x: 6,
    y: 4,
    w: 2,
    h: 3,
    sensors: { sight: 1, radar: 1, antiDetection: 0 },
  };
  const game = {
    units: [a, b],
    round: 1,
    tiles: Array.from({ length: 20 }, () => Array(20).fill("plain")),
  };
  assert.deepEqual(api.view(game, 0).radarContacts, [{ x: 6.5, y: 5 }]);
  b.w = 3;
  b.h = 2;
  assert.deepEqual(api.view(game, 0).radarContacts, [{ x: 7, y: 4.5 }]);
  const gm = G.models.RGM_79__machine_gun.sensors;
  assert.equal(gm.sight, 10);
  assert.equal(gm.radar, 12.5);
});

test("recon skills are authoritative, deduplicated and synchronize only allied camera vision", (t) => {
  const { room, act } = fixture(t);
  const [a, b] = room.game.units;
  const model = Object.keys(G.models).find((k) => G.models[k].prefabId === "MS_06E");
  Object.assign(a, { model, en: G.models[model].en, x: 2, y: 10, actionPoints: 5 });
  Object.assign(b, { x: 25, y: 10 });
  room.game.tiles = Array.from({ length: 40 }, () => Array(70).fill("plain"));
  const en = a.en;
  const scan = { id: "scan-dedupe", unitId: a.id, skillId: "Common_DetectArea", x: 2, y: 10 };
  const first = act(0, "skill", scan);
  assert.equal(first.lastEvent.type, "skill");
  assert.equal(first.lastEvent.sound.file, "../../sounds/Detect_3.ogg");
  assert(first.game.intel.detectedIds.includes(b.id));
  assert(!first.game.units.some((u) => u.id === b.id));
  act(0, "skill", scan);
  assert.equal(a.en, en - 100);
  assert.equal(a.actionPoints, 4);
  assert.throws(() => act(1, "skill", { unitId: a.id, skillId: "Common_CameraGun", x: 25, y: 10 }));
  const camera = act(0, "skill", { unitId: a.id, skillId: "Common_CameraGun", x: 25, y: 10 });
  assert.equal(camera.lastEvent.type, "skill");
  assert(camera.game.units.some((u) => u.id === b.id));
  assert.equal(camera.game.visionAreas.length, 1);
  assert.equal(act(1, "sync").game.visionAreas.length, 0);
  assert.equal(a.en, en - 130);
});

test("playback visibility survives lethal resolution without revealing the other team's intel", (t) => {
  const { room, act, frames, clients } = fixture(t);
  const [a, b] = room.game.units;
  b.hp = 1;
  act(0, "attack", { unitId: a.id, targetId: b.id, weaponId: "EF_90mmMG" });
  act(0, "end_turn");
  act(1, "respond", { response: "defend" });
  assert.ok(b.hp <= 0, "fixture must remove the target from final sensor visibility");
  const state = frames.get(clients[0]);
  assert.equal(state.phase, "playback");
  assert.ok(!state.game.units.some((unit) => unit.id === b.id));
  assert.ok(state.combats[0].visibleActorIds.includes(b.id));
  assert.equal(state.combats[0].visibleBy, undefined);
});

test("log downloads enforce team access, unlock immediately on host return, and retain all histories in the lobby", async (t) => {
  const { room, act } = fixture(t, 2, 1, { roomReturnMs: 10 });
  room.log.unshift("global-only");
  room.teamLogs[0].unshift("blue-only");
  room.teamLogs[1].unshift("red-only");
  const revision = room.revision;
  assert.deepEqual(act(0, "sync").logExport.options, ["team:0"]);
  assert.deepEqual(act(0, "download_log", { perspective: "team:0" }).log, room.teamLogs[0]);
  for (const perspective of ["global", "team:1", "team:99", "team:0junk"])
    assert.throws(() => act(0, "download_log", { perspective }));
  assert.equal(room.revision, revision, "downloads do not change the battle revision");
  assert.throws(() => act(1, "return_room"));
  assert.equal(act(0, "sync").logExport.unlocked, false);
  const returning = act(0, "return_room");
  assert.equal(returning.logExport.unlocked, true);
  assert.deepEqual(act(1, "download_log", { perspective: "team:0" }).log, room.teamLogs[0]);
  assert.deepEqual(act(0, "download_log", { perspective: "global" }).log, room.log);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(room.started, false);
  assert.deepEqual(act(0, "download_log", { perspective: "team:1" }).log, room.teamLogs[1]);
  const previousMatch = room.matchId;
  room.matchId = "next-match";
  room.logsUnlocked = false;
  room.started = true;
  assert.throws(() => act(0, "download_log", { perspective: "global", matchId: previousMatch }));
  assert.throws(() => act(0, "download_log", { perspective: "global" }));
});

test("spectators switch map fog and LOG together without gaining unit control or changing player views", (t) => {
  const { engine, room, act, frames, clients } = fixture(t);
  const [a, b] = room.game.units;
  room.game.tiles = Array.from({ length: 40 }, () => Array(50).fill("plain"));
  Object.assign(a, { x: 2, y: 10 });
  Object.assign(b, { x: 35, y: 10 });
  room.teamLogs[0].unshift("blue-only");
  room.teamLogs[1].unshift("red-only");
  const spectator = { readyState: 1 };
  engine.join(spectator, { mode: "join", room: room.code });
  let serial = 0;
  const command = (action, fields = {}) => {
    engine.action(spectator, {
      id: "view-request-" + ++serial,
      revision: room.revision,
      matchId: room.matchId,
      action,
      ...fields,
    });
    return frames.get(spectator);
  };
  assert.equal(frames.get(spectator).viewTeam, null);
  assert.deepEqual(
    frames.get(spectator).game.units.map((u) => u.id),
    [a.id, b.id],
  );
  assert.throws(() => command("download_log", { perspective: "global" }));
  const revision = room.revision;
  let view = command("spectate", { team: 0 });
  assert.equal(view.viewTeam, 0);
  assert.equal(view.game.intel.team, 0);
  assert.deepEqual(
    view.game.units.map((u) => u.id),
    [a.id],
  );
  assert.deepEqual(view.log, room.teamLogs[0]);
  assert.deepEqual(command("download_log", { perspective: "team:0" }).log, room.teamLogs[0]);
  assert.throws(() => command("download_log", { perspective: "team:1" }));
  view = command("spectate", { team: 1 });
  assert.deepEqual(
    view.game.units.map((u) => u.id),
    [b.id],
  );
  assert.deepEqual(view.log, room.teamLogs[1]);
  assert.equal(view.you.seat, null);
  assert.throws(() => command("wait", { unitId: b.id }));
  assert.throws(() => act(0, "spectate", { team: 1 }));
  assert.throws(() => command("spectate", { team: 99 }));
  assert.throws(() => command("spectate", { team: "0" }));
  assert.equal(room.revision, revision);
  engine.broadcast(room);
  assert.equal(frames.get(spectator).viewTeam, 1, "preference survives later broadcasts");
  assert.equal(frames.get(clients[0]).viewTeam, 0);
  view = command("spectate", { team: null });
  assert.equal(view.game.intel, undefined);
  assert.deepEqual(view.log, room.log);
  room.phase = "finished";
  assert.deepEqual(command("download_log", { perspective: "global" }).log, room.log);
  assert.deepEqual(command("download_log", { perspective: "team:1" }).log, room.teamLogs[1]);
});

test("fog effects use a separate presentation feed without hidden health, orders or team log access", (t) => {
  const { room, act } = fixture(t, 4);
  room.game.tiles = Array.from({ length: 40 }, () => Array(50).fill("plain"));
  for (const u of room.game.units) Object.assign(u, { x: u.team ? 35 : 2, y: 5 + G.ownerOf(u) });
  const hidden = room.game.units.filter((u) => u.team === 1);
  hidden[0].hp = 12345;
  hidden[0].en = 6789;
  hidden[0].plan = { target: "secret-target" };
  room.combatBatch = [
    {
      id: "hidden-battle",
      matchId: room.matchId,
      a: hidden[0].id,
      b: hidden[1].id,
      actors: structuredClone(hidden),
      before: Object.fromEntries(hidden.map((u) => [u.id, u.hp])),
      events: [
        {
          from: hidden[0].id,
          to: hidden[1].id,
          before: 12345,
          after: 10,
          damage: 12335,
          hitChance: 77,
          strikes: [
            { executed: true, hit: true, before: 12345, after: 10, damage: 12335, hitChance: 77 },
          ],
        },
      ],
    },
  ];
  const state = act(0, "sync");
  assert.equal(state.combats.length, 0);
  assert.equal(state.effectCombats.length, 1);
  assert(!state.game.units.some((u) => u.id === hidden[0].id));
  const actor = state.effectActors.find((u) => u.id === hidden[0].id);
  assert.equal(actor.hp, 1);
  assert.equal(actor.en, 1);
  assert.equal(actor.plan, undefined);
  const battle = state.effectCombats[0];
  assert.deepEqual(battle.visibleActorIds, []);
  assert.equal(battle.events[0].before, 1);
  assert.equal(battle.events[0].damage, 0);
  assert.equal(battle.events[0].hitChance, undefined);
  assert.equal(battle.events[0].strikes[0].hitChance, undefined);
  assert.deepEqual(state.log, room.teamLogs[0]);
  assert.deepEqual(state.logExport.options, ["team:0"]);
});

test("records preserve public playback, synchronized barriers and turn navigation without takeover", async (t) => {
  const Records = require("../shared/match-records.js");
  const { room, act, frames, clients, engine } = fixture(t, 2, 1, {
    roomReturnMs: 1,
    aiDelayMs: 100000,
  });
  assert(room.record.frames.length > 0);
  assert.doesNotThrow(() => act(0, "record_export", { perspective: "team:0" }));
  assert(!JSON.stringify(room.record).includes('"seed":'));
  assert(!JSON.stringify(room.record).includes('"token":'));
  assert.throws(() => act(1, "replay_open"));
  assert.throws(() => act(0, "replay_open"));
  const [a] = room.game.units;
  const target = [...G.reachable(room.game, a).values()].find((c) => c.path.length);
  moveAndConfirm(act, 0, { unitId: a.id, x: target.x, y: target.y });
  const moved = room.record.frames.length - 1;
  const decoded = Records.view(room.record, moved, "global");
  assert.equal(decoded.game.units.find((u) => u.id === a.id).x, target.x);
  assert(!room.record.checkpoints.some((c) => c.frame === moved));
  act(0, "return_room");
  await new Promise((r) => setTimeout(r, 20));
  const full = room.record;
  assert(full.checkpoints.length > 0);
  assert.equal(Records.validate(G, full).frames.length, full.frames.length);
  const original = JSON.stringify(full),
    checkpoint = full.checkpoints[0],
    oldMatch = room.matchId;
  act(0, "replay_open");
  const replay = room.replay;
  assert.throws(() => act(1, "replay_control", { replayId: replay.id, playing: true }));
  act(0, "replay_control", { replayId: replay.id, playing: true });
  const token = replay.token,
    index = replay.index;
  assert.throws(() =>
    act(0, "replay_control", { replayId: replay.id, index: index + 1, speed: 3 }),
  );
  assert.equal(replay.index, index, "invalid speed cannot partially seek");
  act(0, "replay_ready", { replayId: replay.id, token });
  assert.equal(replay.index, index);
  act(1, "replay_ready", { replayId: replay.id, token });
  assert.equal(replay.index, index + 1);
  assert.throws(() => act(0, "replay_ready", { replayId: replay.id, token }));
  act(1, "replay_view", { perspective: "team:1" });
  engine.broadcast(room);
  assert.equal(frames.get(clients[1]).replay.perspective, "team:1");
  act(0, "replay_control", { replayId: replay.id, index: moved, playing: false });
  assert.throws(() =>
    act(0, "replay_fork", { replayId: replay.id, index: moved, assignments: [room.hostId, "ai"] }),
  );
  act(0, "replay_control", { replayId: replay.id, index: checkpoint.frame, playing: false });
  assert.throws(() =>
    act(0, "replay_fork", {
      replayId: replay.id,
      index: checkpoint.frame,
      assignments: [room.hostId, room.hostId],
    }),
  );
  assert.throws(() =>
    act(0, "replay_fork", {
      replayId: replay.id,
      index: checkpoint.frame,
      assignments: [room.hostId, "ai"],
    }),
  );
  assert.equal(room.matchId, oldMatch);
  assert.equal(room.replay, replay);
  assert.equal(room.started, false);
  assert.equal(JSON.stringify(full), original, "watching never mutates the original record");
});

test("record upload is chunked, validated, host-only and does not replace a live match", async (t) => {
  const { room, act } = fixture(t, 2, 1, { roomReturnMs: 1 });
  assert.throws(() => act(0, "record_upload_begin", { length: 100 }));
  act(0, "return_room");
  await new Promise((r) => setTimeout(r, 20));
  const raw = JSON.stringify(room.record);
  assert.throws(() => act(1, "record_upload_begin", { length: raw.length }));
  const upload = act(0, "record_upload_begin", { length: raw.length });
  assert.throws(() =>
    act(0, "record_upload_chunk", { uploadId: upload.uploadId, sequence: 1, text: "x" }),
  );
  for (let offset = 0, sequence = 0; offset < raw.length; offset += 20000, sequence++)
    act(0, "record_upload_chunk", {
      uploadId: upload.uploadId,
      sequence,
      text: raw.slice(offset, offset + 20000),
    });
  act(0, "record_upload_finish", { uploadId: upload.uploadId });
  act(0, "replay_open", { loaded: true });
  assert.equal(room.replay.record.id, room.record.id);
  assert.throws(() => act(0, "start_game"));
  act(0, "replay_close");
  assert.equal(room.replay, null);
});

test("replay rejects takeover without changing disconnected players or their reconnect seats", async (t) => {
  const { room, act, engine, clients } = fixture(t, 2, 1, { roomReturnMs: 1, aiDelayMs: 100000 });
  act(0, "return_room");
  await new Promise((r) => setTimeout(r, 20));
  act(0, "replay_open");
  const replay = room.replay,
    checkpoint = replay.record.checkpoints[0];
  act(0, "replay_control", { replayId: replay.id, index: checkpoint.frame });
  const guest = room.members.get(clients[1].memberId),
    token = guest.token;
  engine.disconnect(clients[1]);
  assert.throws(() =>
    act(0, "replay_fork", {
      replayId: replay.id,
      index: checkpoint.frame,
      assignments: [room.hostId, "ai"],
    }),
  );
  assert.equal(guest.seat, 1);
  assert.equal(room.replay, replay);
  const socket = { readyState: 1 };
  engine.join(socket, { mode: "resume", room: room.code, token });
  assert.equal(socket.seat, 1);
});

function moveAndConfirm(act, seat, fields) {
  const preview = act(seat, "move", fields);
  return preview.type === "error" ? preview : act(seat, "confirm_move", { unitId: fields.unitId });
}

for (const count of [4, 6])
  test(`${count} humans ending at the same revision advance once and clear every waiting flag`, (t) => {
    const { room, act, frames, clients } = fixture(t, count);
    for (let turn = 0; turn < 4; turn++) {
      const round = room.game.round,
        team = room.game.team,
        revision = room.revision;
      const seats = room.seats.filter((p) => G.seatTeam(p.seat) === team).map((p) => p.seat);
      for (const seat of seats) act(seat, "end_turn", { revision, round });
      assert.equal(room.game.round, round + 1);
      assert.equal(room.game.team, 1 - team);
      for (const client of clients) {
        const snapshot = frames.get(client);
        assert.equal(snapshot.game.round, round + 1);
        assert.ok(snapshot.turnDone.every((done) => !done));
        assert.equal(snapshot.phase, "idle");
      }
    }
  });
