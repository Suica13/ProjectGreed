const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const { createRoomEngine } = require("../shared/room-engine");

function fixture(t, mode) {
  let serial = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => `xp-${++serial}`,
    randomToken: () => `token-${++serial}`,
    randomSeed: () => 1,
    aiDelayMs: 1,
    send: (ws, value) => frames.set(ws, value),
  });
  t.after(() => engine.close());
  const host = { readyState: 1 },
    guest = { readyState: 1 };
  const profile = {
    characterFaction: "PMC",
    licenses: { Medea: true, ColumbusClass: true },
    inventory: { Medea: 10, ColumbusClass: 10 },
  };
  engine.join(host, { ...profile, mode: "create", room: "ROUNDXP", roomMode: mode });
  if (mode !== "mission") engine.join(guest, { ...profile, mode: "join", room: "ROUNDXP" });
  const room = engine.rooms.get("ROUNDXP");
  const act = (ws, action, fields = {}) =>
    engine.action(ws, {
      id: `req-${++serial}`,
      revision: room.revision,
      round: room.game.round,
      matchId: room.matchId,
      phase: room.phase,
      reactionId: frames.get(ws)?.pending?.id,
      action,
      ...fields,
    });
  const pilot = G.pilots.createCustom("custom-round-xp", "Round XP");
  const unitId = mode === "mission" ? "ColumbusClass" : "Medea";
  const formation = [{ unitId, kitId: "standard", customPilot: pilot }];
  if (mode !== "mission")
    act(guest, "set_ready", { ready: true, formation: [{ unitId, kitId: "standard" }] });
  act(host, "start_game", { formation });
  act(host, "confirm_formation");
  if (mode !== "mission") act(guest, "confirm_formation");
  const seat = room.members.get(host.memberId).seat;
  G.aiDeployment(room.game, seat);
  act(host, "confirm_deployment");
  if (mode !== "mission") {
    G.aiDeployment(room.game, room.members.get(guest.memberId).seat);
    act(guest, "confirm_deployment");
  }
  while (room.game.mission?.dialogue) {
    const d = room.game.mission.dialogue;
    act(host, "mission_dialogue_next", { dialogueId: d.id, lineIndex: d.index });
  }
  const original = G.models.Type61__standard;
  G.models.Type61__standard = {
    ...original,
    weapons: original.weapons.map((w) => ({ ...w, hitScale: 1e6 })),
  };
  t.after(() => {
    G.models.Type61__standard = original;
  });
  const actor = room.game.units.find((u) => u.pilot?.id === pilot.id);
  const target = room.game.units.find((u) => u.team === 1 && !u.facility);
  for (const u of [actor, target]) {
    u.model = "Type61__standard";
    u.hp = G.modelOf(u).hp;
    u.en = G.modelOf(u).en;
    u.shield = 0;
    delete u.embarked;
  }
  Object.assign(actor, { x: 4, y: 4, moved: false, acted: false });
  Object.assign(target, { x: 6, y: 4, hp: 1 });
  room.game.tiles.forEach((row) => row.fill("plain"));
  room.game.seed = 1;
  return { engine, room, host, guest, frames, act, actor, target, pilot };
}

for (const mode of ["quick", "battlefield", "mission"])
  test(`XP is authoritative in the current turn before settlement: ${mode}`, async (t) => {
    const f = fixture(t, mode),
      { room, actor, target, pilot } = f;
    target.pilot = G.pilots.createCustom("custom-round-casualty", "Casualty");
    for (let i = 0; i < room.seats.length; i++)
      if (room.seats[i]?.bot && G.seatTeam(i) === 0) room.turnDone[i] = true;
    f.act(f.host, "attack", { unitId: actor.id, targetId: target.id });
    f.act(f.host, "end_turn");
    room.game.seed = 1;
    for (let i = 0; i < 80 && target.hp > 0; i++) {
      if (mode !== "mission" && f.frames.get(f.guest)?.pending)
        f.act(f.guest, "respond", { response: "defend" });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      target.hp,
      0,
      JSON.stringify({ phase: room.phase, log: f.frames.get(f.host)?.log?.slice(0, 4) }),
    );
    const snapshot = f.frames.get(f.host),
      award = snapshot.pilotAwards.find((a) => a.kind === "kill" && a.pilotId === pilot.id);
    assert.equal(target.pilot.needsRecruitment, true, "casualty requires recovery in " + mode);
    for (const loss of snapshot.pilotAwards.filter(a=>a.kind==="loss"&&a.pilotId===target.pilot.id))
      assert.equal(loss.requiresRecruitment,true);
    assert(award && award.experiencePoints > 0, JSON.stringify(snapshot.pilotAwards));
    assert.equal(
      award.experiencePoints,
      G.pilots.combatExperience(
        G.modelOf(actor).cost,
        G.modelOf(target).cost,
        mode === "quick" ? 0.1 : 1,
      ),
    );
    assert.equal(snapshot.rewardsSettled, false);
    assert.equal(actor.pilot.experience, award.experiencePoints);
    const store = { pilots: [pilot], awards: [] };
    assert(G.pilots.creditAwards(store, snapshot.pilotAwards, { settled: false }));
    assert.equal(store.pilots[0].experience, actor.pilot.experience);
    assert.equal(G.pilots.creditAwards(store, snapshot.pilotAwards, { settled: true }), false);
    if (mode === "battlefield") {
      const reserve = room.game.battlefield.reserves.find((r) => r.template.pilot?.id === pilot.id);
      assert.equal(reserve.template.pilot.experience, actor.pilot.experience);
    }
  });

test("immediate XP deduplicates receipts while casualties and campaign/script crews remain isolated", () => {
  const pilot = G.pilots.createCustom("custom-ledger-xp", "Ledger");
  const store = { pilots: [pilot], awards: [] };
  const kill = {
    id: "xp-kill",
    pilotId: pilot.id,
    kind: "kill",
    points: 200,
    experiencePoints: 100,
  };
  const loss = { id: "xp-loss", pilotId: pilot.id, kind: "loss", points: 200, experiencePoints: 0 };
  const transient = { ...kill, id: "campaign-kill", persistent: false };
  G.pilots.creditAwards(store, [kill, loss, transient], { settled: false });
  assert.equal(store.pilots[0].experience, 100);
  assert.equal(store.pilots[0].record.losses, 0);
  const reloaded = JSON.parse(JSON.stringify(store));
  G.pilots.creditAwards(reloaded, [kill, loss, transient], { settled: true });
  assert.equal(reloaded.pilots[0].experience, 100);
  assert.equal(reloaded.pilots[0].record.losses, 1);
  assert.equal(G.pilots.creditAwards(reloaded, [kill, loss, transient], { settled: true }), false);
});
