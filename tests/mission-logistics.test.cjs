const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  D = require("../shared/development"),
  E = require("../shared/economy"),
  S = require("../shared/contract-mode"),
  R = require("../shared/battle-economy");
const { createRoomEngine } = require("../shared/room-engine");
const carrier = { unitId: "Medea", kitId: "standard" },
  tank = {
    unitId: "Type61",
    kitId: "standard",
    preload: { carrierIndex: 0, hangarId: "Hangar_1" },
  };
function fixture(t, mode = "sweep", getRewardMultipliers = () => ({})) {
  let n = 0;
  const messages = [];
  const engine = createRoomEngine({
    rules: G,
    getRewardMultipliers,
    randomId: () => String(++n),
    randomToken: () => String(++n),
    randomSeed: () => 7319,
    send: (_, m) => messages.push(m),
    aiDelayMs: 999999,
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "LOGISTICS",
    roomMode: mode,
    characterFaction: "PMC",
    licenses: { Medea: true, Type61: true },
    inventory: { Medea: 5, Type61: 20 },
  });
  const room = engine.rooms.get("LOGISTICS");
  const act = (action, data = {}, id) =>
    engine.action(ws, {
      id: id || "req-" + ++n,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...data,
    });
  return { engine, room, act, messages };
}
test("new reward endpoints and every final award align to 25, including quick and drawn research", () => {
  assert.deepEqual(R.calculateBattleReward(1500), { money: 2000, supplies: 3000, technology: 500 });
  assert.deepEqual(R.calculateBattleReward(99999), {
    money: 10000,
    supplies: 15000,
    technology: 1000,
  });
  for (let cost = 0; cost < 25000; cost += 137)
    for (const value of Object.values(R.calculateBattleReward(cost))) assert.equal(value % 25, 0);
  assert.equal(R.rewardMultiplier, 1);
  assert.equal(R.technologyReward(null, "regular"), 500);
  assert.equal(R.technologyReward(true, "regular"), 550);
  assert.equal(R.technologyReward(false, "regular"), 550);
  assert.equal(R.technologyReward(true, "quick"), 50);
  for (let era = 0; era < 4; era++)
    for (const [cost, base] of [
      [1500, [5000, 7500, 1000]],
      [20000, [15000, 22500, 2000]],
    ]) {
      const settings = {
          costLimit: cost,
          battlefieldTeams: [{ era: G.battlefieldMode.eras[era] }],
        },
        reward = G.battlefieldMode.baseReward(settings, 0);
      assert.deepEqual(
        Object.values(reward),
        base.map((n) => R.roundReward(n * 1.25 ** era)),
      );
    }
});
test("technology caps reject owned high technology and no-tree units, while faction allies are exempt", (t) => {
  const caps = Object.fromEntries(D.factions.map((f) => [f, 0]));
  assert(D.allowsPointCaps("Type61", caps));
  assert(!D.allowsPointCaps("RGM_79", caps));
  assert(!D.allowsPointCaps("RX_93", Object.fromEntries(D.factions.map((f) => [f, 999999]))));
  const settings = { ...G.defaultRoomSettings(), mode: "battlefield", technologyCaps: caps };
  assert.equal(
    G.restrictionReason(G.models[E.defaultModel("RGM_79")], {
      technologyCaps: caps,
      licenses: { RGM_79: true },
      inventory: { RGM_79: 9 },
    }),
    "technology_limit",
  );
  assert.equal(
    G.armyRestrictions(settings, { bot: true, battlefieldAI: true }).technologyCaps,
    undefined,
  );
  const { room, act } = fixture(t, "battlefield");
  assert.equal(room.seats.length, 12);
  assert.deepEqual(
    G.getMap(room.settings.mapId)
      .spawns.filter((s) => !s.fixedAlly && s.team === 0)
      .map((s) => s.position),
    [1, 2, 3, 4, 5],
  );
  act("configure_room", {
    ...room.settings,
    battleMode: "battlefield",
    technologyLimitMode: "custom",
    technologyLimit: 2500,
  });
  assert.equal(room.settings.technologyLimit, 2500);
});
test("faction allies do not consume any of the ten human positions or lobby capacity", (t) => {
  const { engine, room } = fixture(t, "battlefield");
  for (let i = 0; i < 9; i++)
    engine.join({ readyState: 1 }, { mode: "join", room: "LOGISTICS", characterFaction: "PMC" });
  assert.equal(room.seats.filter((p) => p && !p.bot).length, 10);
  for (const team of [0, 1])
    assert.equal(room.seats.filter((p) => p && !p.bot && p.seat % 2 === team).length, 5);
  assert.equal(engine.roomList()[0].players, 10);
  assert.equal(engine.roomList()[0].capacity, 10);
});

test("war and sweep use era availability instead of host research caps", () => {
  const caps = Object.fromEntries(D.factions.map((f) => [f, 0]));
  const first = G.models[E.defaultModel("Medea")];
  const later = G.models[E.defaultModel("SalamisClassLateType")];
  for (const mode of ["battlefield", "sweep"]) {
    const settings = { ...G.defaultRoomSettings(), mapId: null, mode, technologyCaps: caps,
      battlefieldEra: "0079T1", sweepEra: "0079T1" };
    const player = { seat: 2, characterFaction: "PMC", licenses: { Medea: true, SalamisClassLateType: true },
      inventory: { Medea: 5, SalamisClassLateType: 5 } };
    const rules = G.armyRestrictions(settings, player);
    assert.equal(rules.technologyCaps, undefined);
    assert.equal(G.restrictionReason(first, rules), null);
    assert.equal(G.restrictionReason(later, rules), "not_allowed");
    const next = G.armyRestrictions({ ...settings, battlefieldEra: "0079T2", sweepEra: "0079T2" }, player);
    assert.equal(G.restrictionReason(first, next), null, "earlier carriers remain usable");
    assert.equal(G.restrictionReason(later, next), null);
    const ai = G.armyRestrictions(settings, { seat: 3, bot: true, characterFaction: "ZEON", researched: [] });
    assert.equal(ai.ignoreDevelopment, true);
    assert.equal(ai.technologyCaps, undefined);
    assert.deepEqual(ai.allowedEras, ["0079T1"]);
  }
  assert.equal(G.armyRestrictions({ ...G.defaultRoomSettings(), technologyCaps: caps }, {}).technologyCaps, caps);
  assert.equal(G.armyRestrictions({ ...G.defaultRoomSettings(), mode: "battlefield" }, { battlefieldAI: true }).allowedEras, undefined);
  for (const era of G.eras) {
    for (const faction of S.factionsForEra(G, era)) assert(G.catalog.prefabs.some(p =>
      !p.wip && !p.formOnly && !p.facility && p.faction === faction && p.tags.includes(era)));
  }
});

test("server rejects custom war scales and enforces era availability at assembly", (t) => {
  const { room, act, engine, messages } = fixture(t, "battlefield");
  assert.equal(room.settings.battlefieldEra, "0079T1");
  assert.throws(() => act("configure_room", { ...room.settings, battlefieldEra: "custom" }));
  assert.throws(() => act("configure_room", { ...room.settings, costLimit: 1525 }));
  assert.throws(() => act("configure_room", { ...room.settings, battlefieldTeams: [
    { faction: "AEUG", era: "0087T1" }, { faction: "ZEON", era: "0079T1" }] }));
  engine.broadcast(room);
  assert.equal(messages.findLast(m => m.type === "state").settings.technologyCaps, undefined);
  const host = room.seats.find(p => p && !p.bot);
  host.inventory.SalamisClassLateType = 5;
  host.licenses.SalamisClassLateType = true;
  act("start_game", { formation: [{unitId: "SalamisClassLateType", kitId: "standard"}, carrier, {...tank,preload:{carrierIndex:1,hangarId:"Hangar_1"}}] });
  assert.equal(room.phase, "assembly");
  act("confirm_formation");
  assert(room.started);
  const deployed = room.game.units.filter(u => u.ownerSeat === host.seat);
  assert(deployed.length > 0);
  assert(deployed.every(u => G.modelOf(u).tags.includes("0079T1")));
});

test("host research selection supplies one shared cap instead of per-faction balances", (t) => {
  const { engine, room, act, messages } = fixture(t, "regular");
  const host = room.seats[0];
  host.technologyPoints = D.normalizeTechnologyPoints({EFSF:5000,ZEON:100,AEUG:200});
  const caps = () => messages.findLast((m)=>m.type === "state").settings.technologyCaps;
  engine.broadcast(room);
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,5000])));
  act("configure_room",{...room.settings,technologyLimitFaction:"ZEON"});
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,100])));
  assert.throws(()=>act("configure_room",{...room.settings,technologyLimitFaction:"PMC"}),/参考阵营无效/);
  assert.equal(room.settings.technologyLimitFaction,"ZEON");
  act("configure_room",{...room.settings,technologyLimitMode:"custom",technologyLimit:2500});
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,2500])));
  act("configure_room",{...room.settings,technologyLimitMode:"host",technologyLimitFaction:"EFSF"});
  act("add_ai",{seat:1});
  act("start_game",{formation:[carrier,tank]});
  act("confirm_formation");
  assert(room.started);
  assert.deepEqual(room.technologyCapSnapshot,Object.fromEntries(D.factions.map(f=>[f,5000])));
  host.technologyPoints.EFSF=9999;
  engine.broadcast(room);
  assert.deepEqual(caps(),Object.fromEntries(D.factions.map(f=>[f,5000])));
});
