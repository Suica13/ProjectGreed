const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  P = G.pilots;
const { createRoomEngine } = require("../shared/room-engine.js");
function fixture(t, mode = "regular") {
  let seq = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
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
      assert.equal(awards.length, 0);
      return;
    }
    assert.ok(assist);
    const xp = scenario.startsWith("saved")
      ? 0
      : Math.floor(G.modelOf(target).cost * 0.25 * (scenario === "quick" ? 0.1 : 1));
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
  assert.equal(killer.pilot.level, 2);
  assert.equal(killer.pilot.points, 75);
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
