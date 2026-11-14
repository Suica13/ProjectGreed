const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  { createRoomEngine } = require("../shared/room-engine");

test("sweep kill XP persists between nodes and is credited only on extraction", async (t) => {
  let serial = 0;
  const frames = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "xp-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 7319,
    aiDelayMs: 1,
    send: (_, m) => frames.push(m),
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "SWEEPXP",
    roomMode: "sweep",
    characterFaction: "PMC",
    licenses: { PegasusClass: true, Type61: true },
    inventory: { PegasusClass: 5, Type61: 5 },
  });
  const room = engine.rooms.get("SWEEPXP");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: "req-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  Object.assign(room.settings, { costLimit: 99999, unitCostLimit: 99999, fogMode: "disabled" });
  const pilot = G.pilots.createCustom("custom-sweep-xp", "Sweep");
  act("start_game", {
    formation: [
      { unitId: "PegasusClass", kitId: "standard" },
      {
        unitId: "Type61",
        kitId: "standard",
        customPilot: pilot,
        preload: { carrierIndex: 0, hangarId: G.models.PegasusClass__standard.hangars[0].id },
      },
    ],
  });
  act("confirm_formation");
  assert.equal(room.phase, "sweep_map", JSON.stringify(frames.filter((m) => m.type === "error")));
  act("sweep_select", { nodeId: "0:1" });
  act("sweep_confirm");
  assert.equal(room.phase, "deployment");
  G.aiDeployment(room.game, 0);
  act("confirm_deployment");
  const actor = room.game.units.find((u) => u.pilot?.id === pilot.id),
    target = room.game.units.find((u) => u.team === 1);
  room.game.tiles.forEach((row) => row.fill("plain"));
  delete actor.embarked;
  delete target.embarked;
  Object.assign(actor, { x: 4, y: 4 });
  Object.assign(target, { x: 6, y: 4, hp: 1, shield: 0 });
  // Fix the seed and ensure a legal hit; the server still resolves the attack.
  const model = G.modelOf(actor),
    original = G.models[actor.model];
  G.models[actor.model] = {
    ...model,
    weapons: model.weapons.map((w) => ({ ...w, hit: 10000, sourceHit: 10000 })),
  };
  t.after(() => {
    G.models[actor.model] = original;
  });
  assert(
    G.firePlan(room.game, actor, target).weapons.length,
    JSON.stringify({
      actor,
      target,
      phase: room.phase,
      team: room.game.team,
      environment: room.game.environment,
      weapons: model.weapons.map((w) => ({
        id: w.id,
        min: w.min,
        max: w.max,
        reason: G.attackReason?.(room.game, actor, target, w),
      })),
    }),
  );
  act("attack", { unitId: actor.id, targetId: target.id });
  act("end_turn");
  for (let i = 0; i < 60 && target.hp > 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(target.hp, 0, JSON.stringify(frames.filter((m) => m.type === "error")));
  const award = room.pilotAwards.find((a) => a.kind === "kill" && a.pilotId === pilot.id);
  assert(award && award.experiencePoints > 0);
  const xp = actor.pilot.experience;
  assert(xp > 0);
  if (room.playback) act("playback_ready", { batchId: room.playback.id });
  for (const u of room.game.units.filter((u) => u.team === 1)) u.hp = 0;
  room.game.winner = 0;
  room.phase = "finished";
  engine.broadcast(room);
  assert.equal(room.phase, "sweep_map");
  assert.equal(
    room.sweep.rosters[room.seats[0].id].find((e) => e.state.pilot?.id === pilot.id).state.pilot
      .experience,
    xp,
  );
  assert.equal(frames.filter((m) => m.type === "state").at(-1).rewardsSettled, false);
  const current = room.sweep.nodes.find(
    (n) => n.depth === room.sweep.depth && n.lane === room.sweep.lane,
  );
  const next = room.sweep.nodes.find((n) => n.id === current.next[0]);
  next.type = "battle";
  act("sweep_select", { nodeId: next.id });
  act("sweep_confirm");
  assert.equal(room.game.units.find((u) => u.pilot?.id === pilot.id).pilot.experience, xp);
  assert(room.pilotAwards.includes(award));
  for (const u of room.game.units.filter((u) => u.team === 1)) u.hp = 0;
  room.game.winner = 0;
  room.phase = "finished";
  engine.broadcast(room);
  act("sweep_extract");
  assert.equal(frames.filter((m) => m.type === "state").at(-1).rewardsSettled, true);
  const store = { pilots: [pilot], awards: [] };
  G.pilots.creditAwards(store, room.pilotAwards);
  assert.equal(store.pilots[0].experience, xp);
});
