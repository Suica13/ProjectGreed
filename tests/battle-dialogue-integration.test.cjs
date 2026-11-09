const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  { createRoomEngine } = require("../shared/room-engine.js");
function setup(formations) {
  let seq = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => String(++seq),
    randomToken: () => String(++seq),
    send: (ws, m) => {
      frames.set(ws, m);
    },
    randomSeed: () => 3,
  });
  const host = { readyState: 1 },
    guest = { readyState: 1 };
  engine.join(host, {
    mode: "create",
    room: "DIALOGUE",
    characterFaction: "PMC",
  });
  engine.join(guest, {
    mode: "join",
    room: "DIALOGUE",
    characterFaction: "PMC",
  });
  const room = engine.rooms.get("DIALOGUE");
  room.game = G.create(false, 3, formations, false, {
    fogMode: "disabled",
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  room.game.tiles.forEach((row) => row.fill("plain"));
  room.game.deployment = null;
  room.started = true;
  room.phase = "idle";
  room.matchId = "dialogue-test";
  room.settings.mode = "quick";
  room.settings.pilotDialogue = true;
  const act = (ws, action, fields = {}) => {
    engine.action(ws, {
      id: "act-" + ++seq,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      action,
      ...fields,
    });
    const m = frames.get(ws);
    assert.notEqual(m?.type, "error", m?.message);
    return m;
  };
  return { engine, room, host, guest, act, frames };
}
const tank = { unitId: "Type61", kitId: "standard" };
test("authoritative kills and defeats include numbered vehicles and nearby ally interactions once", () => {
  const f = setup([
    [tank, tank],
    [tank, tank],
  ]);
  try {
    const [a, ally, b, enemyAlly] = f.room.game.units;
    for (const [u, x] of [
      [a, 5],
      [ally, 4],
      [b, 8],
      [enemyAlly, 9],
    ]) {
      u.x = x;
      u.y = 5;
      delete u.squadId;
      delete u.squadSlot;
      u.pilot.name = "Pilot " + u.id;
    }
    b.hp = 1;
    b.shield = 0;
    const weapon = G.modelOf(a).weapons.find((w) => w.type !== "melee");
    f.act(f.host, "attack", {
      unitId: a.id,
      targetId: b.id,
      weaponIds: [weapon.id],
      single: true,
    });
    f.act(f.host, "end_turn");
    while (f.room.reactions?.length) {
      const p = f.room.reactions.find(
        (p) =>
          G.ownerOf(f.room.game.units.find((u) => u.id === p.target)) === 1,
      );
      assert(p);
      f.act(f.guest, "respond", { reactionId: p.id, response: "defend" });
    }
    if (f.room.reactionReviewId)
      f.act(f.guest, "confirm_responses", {
        reviewId: f.room.reactionReviewId,
      });
    assert.equal(b.hp, 0);
    const events = f.room.dialogueEvents || [];
    assert(events.length > 0);
    assert(events.every(e=>e.defeatUnitId===b.id));
    assert.equal(new Set(events.map(e => e.position.x + "," + e.position.y)).size, events.length);
    assert(events.every(e => ({kill:a, defeat:b, allyKill:ally, allyLoss:enemyAlly})[e.event]?.id === e.speakerId));
    assert(
      f.room.log.some(
        (line) => line.includes("[战场对话]") && line.includes("[No.1]"),
      ),
    );
    assert(events.every((e) => e.unitName?.includes("[No.") && e.position));
  } finally {
    f.engine.close();
  }
});
test("a squad launch logs every passenger but only one transport exchange", () => {
  const f = setup([
    [{ unitId: "Medea", kitId: "standard" }, tank, tank],
    [tank],
  ]);
  try {
    const [carrier, a, b, enemy] = f.room.game.units;
    Object.assign(carrier, { x: 12, y: 6 });
    Object.assign(enemy, { x: 30, y: 6 });
    for (const u of [a, b]) {
      u.embarked = {
        carrierId: carrier.id,
        hangarId: "Hangar_1",
        boardRound: 0,
      };
      u.acted = false;
      u.moved = false;
    }
    G.hangars.sync(f.room.game);
    const point = G.hangars.launchSquadCells(f.room.game, [a, b])[0];
    assert(point);
    f.act(f.host, "launch", {
      unitId: a.id,
      unitIds: [a.id, b.id],
      x: point.x,
      y: point.y,
    });
    f.act(f.host, "confirm_move", { unitId: a.id });
    assert(!a.embarked && !b.embarked);
    assert.equal(G.squadMembers(f.room.game, a).length, 2);
    const events = (f.room.dialogueEvents || []).filter((e) => e.transport);
    assert(events.filter((e) => e.speakerId === carrier.id).length <= 1);
    assert(events.length <= 2);
    assert.equal(
      f.room.log.filter((line) => line.includes("出击至")).length,
      2,
    );
  } finally {
    f.engine.close();
  }
});
