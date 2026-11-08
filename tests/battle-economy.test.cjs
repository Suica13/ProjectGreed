const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  R = require("../shared/battle-economy.js");
const { createRoomEngine } = require("../shared/room-engine.js");
test("currency and research add 25 percent once while pilot experience keeps its original multipliers", () => {
  const activity = { money: 2, supplies: 3, technology: 4, experience: 0 };
  assert.deepEqual(R.rewardMultipliers(), { money: 1.25, supplies: 1.25, technology: 1.25, experience: 1 });
  assert.deepEqual(R.rewardMultipliers(activity), { money: 2.5, supplies: 3.75, technology: 5, experience: 0 });
  assert.deepEqual(activity, { money: 2, supplies: 3, technology: 4, experience: 0 });
  assert.equal(R.rewardMultipliers({ experience: 2 }).experience, 2);
  assert.equal(R.technologyReward(true, "regular", R.rewardMultipliers().technology), 825);
  assert.equal(R.technologyReward(true, "quick", R.rewardMultipliers().technology), 82);
});
function fixture(
  t,
  {
    mode = "regular",
    faction = "PMC",
    saved = false,
    strength = 1,
    assist = false,
    getRewardMultipliers,
    onHostileDefeat,
    onSettlement,
    pilot = null,
    ownFormation = null,
    technologyPoints = {},
  } = {},
) {
  let seq = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    getRewardMultipliers,
    onHostileDefeat,
    onSettlement,
    randomId: () => `id-${++seq}`,
    randomToken: () => `token-${++seq}`,
    randomSeed: () => 1,
    send: (ws, msg) => frames.set(ws, msg),
  });
  t.after(() => engine.close());
  const clients = [
    {
      readyState: 1,
      close() {
        this.readyState = 3;
      },
    },
    {
      readyState: 1,
      close() {
        this.readyState = 3;
      },
    },
  ];
  if (assist) clients.push({ readyState: 1 });
  clients.forEach((ws, i) => {
    ws.activityProfileId = "profile-test-" + i;
  });
  clients.forEach((ws, i) =>
    engine.join(ws, {
      mode: i ? "join" : "create",
      room: "REWARD",
      characterFaction: i ? "PMC" : faction,
      licenses: { Type61: true }, inventory: {Type61:10}, kits: {Type61__standard:10},
      technologyPoints: i ? {} : technologyPoints,
      ...(i === 0 && ownFormation ? {
        licenses: Object.fromEntries(ownFormation.map(entry => [entry.unitId,true])),
        inventory: ownFormation.reduce((counts, entry) => {counts[entry.unitId]=(counts[entry.unitId]||0)+1;return counts},{}),
        kits: ownFormation.reduce((counts, entry) => {const id=entry.unitId+"__"+entry.kitId;counts[id]=(counts[id]||0)+1;return counts},{}),
      } : {}),
    }),
  );
  const room = engine.rooms.get("REWARD");
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
    ...(assist ? { mapId: "crossroads_2v2" } : {}),
    costLimit: ownFormation ? 99999 : 900,
    unitCostLimit: 99999,
    fogMode: "disabled",
  });
  if (assist) act(2, "switch_seat", { seat: 2 });
  const tank = { unitId: "Type61", kitId: "standard" };
  const formations = [
    ownFormation || [
      {
        ...tank,
        customPilot: pilot || G.pilots.createCustom("custom-reward", "Reward", null, faction),
      },
      tank,
    ],
    [tank],
  ];
  if (assist) formations.push([tank]);
  if (saved) {
    const Records = require("../shared/match-records.js");
    const game = G.create(false, 1, formations, false, room.settings);
    room.loadedSave = Records.validateSave(
      G,
      Records.createSave(G, { game, settings: room.settings, seats: room.seats }),
    );
    act(0, "save_load");
    assert.ok(room.resumeSave);
  }
  clients.forEach((_, i) => act(i, "set_ready", { ready: true, formation: formations[i] }));
  act(0, "start_game", { formation: formations[0] });
  clients.forEach((_, i) => act(i, "confirm_formation"));
  if (!saved) clients.forEach((_, i) => act(i, "confirm_deployment"));
  assert.equal(room.game.units.length, ownFormation ? ownFormation.length + 1 : assist ? 4 : 3);
  assert.equal(room.startedFromSave, saved);
  room.game.tiles.forEach((r) => r.fill("plain"));
  const attacker = room.game.units.find(unit => G.ownerOf(unit) === 0);
  const ally = room.game.units.find(unit => G.ownerOf(unit) === 0 && unit !== attacker);
  const target = room.game.units.find(unit => G.ownerOf(unit) === 1);
  [
    [attacker, 2, 4],
    [ally, 2, 5],
    [target, 4, 4],
  ].forEach(([u, x, y]) => Object.assign(u, { x, y, shield: 0 }));
  target.performance = strength;
  if (!saved) room.battleRoster[target.id].performance = strength;
  function kill() {
    room.game.seed = 1;
    target.hp = 1;
    act(0, "attack", { unitId: attacker.id, targetId: target.id, weaponId: "EF_Type61_Cannon" });
    act(0, "end_turn");
    if (assist) act(2, "end_turn");
    for (let i = 0; i < 8 && room.phase === "reaction"; i++)
      act(1, "respond", { response: "evade" });
    assert.equal(target.hp, 0);
    assert.equal(room.phase, "playback");
  }
  function finish() {
    const batchId = room.playback.id;
    clients.forEach((_, i) => act(i, "playback_ready", { batchId }));
    assert.equal(room.phase, "finished");
  }
  return { engine, room, frames, clients, act, attacker, ally, target, kill, finish };
}
function rewardRates(faction, mode) {
  const rates = R.rates(faction, mode);
  return {currency: rates.currency * 1.25, experience: rates.experience};
}
function baseReward(f, team = 0) {
  return R.calculateBattleReward(R.teamAverageFormationCost(f.room.battleRoster, team));
}
for (const faction of ["EFSF", "PMC"])
  for (const mode of faction === "EFSF" ? ["regular"] : ["regular", "quick"])
    test(`authoritative ${faction} ${mode}: private prices, rates, win bonus, losses and deduplication`, (t) => {
      const f = fixture(t, { faction, mode, strength: 1.5 });
      f.ally.hp = 0;
      f.kill();
      const view = f.frames.get(f.clients[0]);
      const rates = rewardRates(faction, mode);
      assert.deepEqual(view.techAwards, []);
      assert.equal(
        view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).money,
        Math.floor(R.price("Type61__standard") * 0.5 * rates.currency * 1.5),
      );
      assert.equal(
        view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
        Math.floor(100 * G.modelOf(f.target).cost / G.modelOf(f.attacker).cost * rates.experience * 1.5),
      );
      assert.equal(
        view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).supplies,
        Math.floor(R.price(f.target.model, "supplies") * 0.5 * rates.currency * 1.5),
      );
      assert(!view.economyAwards.some((a) => a.kind === "result"));
      assert.deepEqual(f.frames.get(f.clients[1]).economyAwards.filter(a => !["deployment", "loss"].includes(a.kind)), []);
      assert.equal(view.battleRoster, undefined);
      f.finish();
      assert.equal(f.frames.get(f.clients[0]).techAwards.reduce((sum, award) => sum + award.points, 0), R.technologyReward(true, mode, 1.25));
      const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
      assert.equal(result.money, Math.floor(baseReward(f).money * rates.currency * 1.5));
      assert.equal(
        result.supplies,
        Math.floor(baseReward(f).supplies * rates.currency * 1.5),
      );
      assert.deepEqual(result.losses, mode === "quick" ? {} : { Type61: 1 });
      const loser = f.frames.get(f.clients[1]).economyAwards.find((a) => a.kind === "result");
      assert.equal(loser.money, 0);
      assert.equal(loser.supplies, 0);
      assert.deepEqual(loser.losses, mode === "quick" ? {} : { Type61: 1 });
      const before = JSON.stringify(f.frames.get(f.clients[0]).economyAwards);
      f.act(0, "sync");
      assert.equal(JSON.stringify(f.frames.get(f.clients[0]).economyAwards), before);
    });
for (const mode of ["regular", "quick"])
  test(`save-loaded ${mode} has no resources, technology, XP, pilot losses or inventory losses`, (t) => {
    const f = fixture(t, { mode, saved: true });
    f.ally.hp = 0;
    f.kill();
    f.finish();
    for (const ws of f.clients) {
      const snapshot = f.frames.get(ws);
      assert.equal(snapshot.startedFromSave, true);
      assert.deepEqual(snapshot.economyAwards, []);
      assert.deepEqual(snapshot.techAwards, []);
      assert.deepEqual(snapshot.pilotAwards, []);
    }
  });
for (const path of ["disconnect", "replace"])
  test(`${path} before the match ends preserves stock reservation and casualty settlement through reconnection`, (t) => {
    const f = fixture(t);
    f.ally.hp = 0;
    const ws = f.clients[0],
      token = f.room.seats[0].token;
    if (path === "disconnect") {
      ws.readyState = 3;
      f.engine.disconnect(ws);
    }
    const next = { readyState: 1 };
    f.engine.join(next, { mode: "resume", room: "REWARD", token, characterFaction: "PMC" });
    f.clients[0] = next;
    f.kill();
    f.finish();
    assert.deepEqual(f.frames.get(next).economyAwards.find((a) => a.kind === "result").losses, { Type61: 1 });
    assert(f.frames.get(next).economyAwards.some((a) => a.kind === "kill"));
    assert.equal(f.room.seats[0].inventory.Type61,9);
  });
test("returning to the room mid-match produces no result award or loss settlement", (t) => {
  const f = fixture(t);
  f.ally.hp = 0;
  f.act(0, "return_room");
  assert(f.room.returnCountdown);
  assert.equal(f.room.economySettled, false);
  assert(!f.frames.get(f.clients[0]).economyAwards.some((a) => a.kind === "result"));
});
test("all production-backed chassis have original factory-backed per-unit prices", () => {
  const catalog = require("../shared/production-catalog.json");
  for (const base of Object.values(catalog.baseModels).filter((id) => catalog.offers[id]))
    assert(R.price(base) > 0, base);
  assert(R.price("RX_80PR_2__kit_0") === R.price("RX_80PR_2__kit_3"));
});

test("identity and quick-mode multiplier contract", () => {
  assert.deepEqual(R.rates("EFSF", "regular"), { currency: 1, experience: 1 });
  assert.deepEqual(R.rates("PMC", "regular"), { currency: 1, experience: 1 });
  assert.deepEqual(R.rates("EFSF", "quick"), { currency: 0.1, experience: 0.1 });
  assert.deepEqual(R.rates("PMC", "quick"), { currency: 0.1, experience: 0.1 });
});

for (const faction of ["PMC", "EFSF"])
  for (const mode of ["regular", "quick"])
    for (const below of [false, true])
      test(`player assist threshold/private settlement ${faction} ${mode} below=${below}`, (t) => {
        const f = fixture(t, { faction, mode, assist: true, strength: 1.5 });
        f.room.seats[2].characterFaction = faction;
        const assistant = f.room.seats[2];
        f.room.playerDamage = {
          [f.target.id]: {
            [assistant.id]: {
              seat: 2,
              damage: G.modelOf(f.target).hp * 0.25 - (below ? 1 : 0),
              factions: { EFSF: 2000 },
            },
            [f.room.seats[0].id]: {
              seat: 0,
              damage: G.modelOf(f.target).hp,
              factions: { EFSF: 8000 },
            },
          },
        };
        f.kill();
        const view = f.frames.get(f.clients[2]);
        assert.equal(view.economyAwards.filter(a => a.kind !== "deployment").length, below ? 0 : 1);
        assert.equal(view.techAwards.length, 0);
        if (!below) {
          const rates = rewardRates(faction, mode);
          assert.equal(
            view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).money,
            Math.floor(R.price(f.target.model) * 0.25 * rates.currency * 1.5),
          );
          assert.equal(
            view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).supplies,
            Math.floor(R.price(f.target.model, "supplies") * 0.25 * rates.currency * 1.5),
          );
          assert.equal(view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).kind, "assist");
          assert.deepEqual(view.techAwards, []);
        }
        const killer = f.frames.get(f.clients[0]);
        assert.equal(killer.economyAwards.filter((a) => a.kind === "kill").length, 1);
        assert.equal(killer.economyAwards.filter((a) => a.kind === "assist").length, 0);
        assert.equal(f.room.playerDamage[f.target.id], undefined);
      });

for (const faction of ["EFSF", "PMC"])
  for (const mode of faction === "EFSF" ? ["regular"] : ["regular", "quick"])
    test(`server event multiplies ${faction} ${mode} authoritative kill and victory awards`, (t) => {
      let enabled = true;
      const bonus = { experience: 3, money: 2, supplies: 4, technology: 5 };
      const f = fixture(t, {
        faction,
        mode,
        strength: 1.5,
        getRewardMultipliers: () =>
          enabled ? bonus : { experience: 1, money: 1, supplies: 1, technology: 1 },
      });
      const rates = rewardRates(faction, mode);
      f.kill();
      const view = f.frames.get(f.clients[0]);
      assert.deepEqual(view.techAwards, []);
      assert.equal(
        view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).money,
        Math.floor(R.price(f.target.model) * 0.5 * rates.currency * 1.5 * 2),
      );
      assert.equal(
        view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
        Math.floor(100 * G.modelOf(f.target).cost / G.modelOf(f.attacker).cost * rates.experience * 1.5 * 3),
      );
      assert.equal(
        view.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).supplies,
        Math.floor(R.price(f.target.model, "supplies") * 0.5 * rates.currency * 1.5 * 4),
      );
      f.finish();
      assert.equal(f.frames.get(f.clients[0]).techAwards.reduce((sum, award) => sum + award.points, 0), R.technologyReward(true, mode, 6.25));
      const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
      assert.equal(
        result.money,
        Math.floor(baseReward(f).money * rates.currency * 1.5 * 2),
      );
      assert.equal(
        result.supplies,
        Math.floor(baseReward(f).supplies * rates.currency * 1.5 * 4),
      );
      const loser = f.frames.get(f.clients[1]).economyAwards.find((a) => a.kind === "result");
      assert.equal(loser.money, 0);
      assert.equal(loser.supplies, 0);
    });
test("event expiring between kill and victory does not change earlier awards; saves remain reward-free", (t) => {
  let active = true;
  const getRewardMultipliers = () => ({
    experience: active ? 2 : 1,
    money: active ? 2 : 1,
    supplies: active ? 2 : 1,
    technology: active ? 2 : 1,
  });
  const f = fixture(t, { getRewardMultipliers });
  f.kill();
  const money = f.frames.get(f.clients[0]).economyAwards.find(a => a.kind === "kill").money;
  active = false;
  f.finish();
  const awards = f.frames.get(f.clients[0]).economyAwards;
  assert.equal(awards.find(a => a.kind === "kill").money, money);
  assert.equal(awards.find((a) => a.kind === "result").money, Math.floor(baseReward(f).money * 1.25));
  active = true;
  const saved = fixture(t, { saved: true, getRewardMultipliers });
  saved.kill();
  saved.finish();
  const view = saved.frames.get(saved.clients[0]);
  assert.deepEqual(view.economyAwards, []);
  assert.deepEqual(view.techAwards, []);
  assert.deepEqual(view.pilotAwards, []);
});

test("victory uses the starting room participants strength averages, including defeated participants", (t) => {
  const f = fixture(t, { strength: 1.5 });
  f.room.battleRoster["destroyed-enemy-1"] = { team: 1, performance: 0.5 };
  f.room.battleRoster["destroyed-enemy-2"] = { team: 1, performance: 1 };
  // Three enemy participants average 1; one friendly participant has strength 2.
  f.room.battleRoster[f.attacker.id].performance = 2;
  f.kill();
  f.finish();
  const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
  assert.equal(result.money, Math.floor(baseReward(f).money * 1.25 / 2));
  assert.equal(result.supplies, Math.floor(baseReward(f).supplies * 1.25 / 2));
  const before = JSON.stringify(result);
  f.act(0, "sync");
  assert.equal(
    JSON.stringify(f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result")),
    before,
  );
  assert.equal(R.strengthRatio({}, 0), 1);
});

for (const allied of [0.5, 1, 1.5, 2])
  test(`allied unit strength ${allied} adjusts currency and pilot XP while research stays fixed`, (t) => {
    const f = fixture(t, { faction: "EFSF", strength: 1.5 });
    for (const unit of Object.values(f.room.battleRoster))
      if (unit.team === 0) unit.performance = allied;
    f.kill();
    const view = f.frames.get(f.clients[0]),
      rates = rewardRates("EFSF", "regular");
    assert.equal(
      view.economyAwards.find((a) => a.kind === "kill").money,
      Math.floor((R.price(f.target.model) * 0.5 * rates.currency * 1.5) / allied),
    );
    assert.equal(
      view.economyAwards.find((a) => a.kind === "kill").supplies,
      Math.floor((R.price(f.target.model, "supplies") * 0.5 * rates.currency * 1.5) / allied),
    );
    assert.deepEqual(view.techAwards, []);
    assert.equal(
      view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
      Math.floor((100 * G.modelOf(f.target).cost / G.modelOf(f.attacker).cost * rates.experience * 1.5) / allied),
    );
    f.finish();
    const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
    assert.equal(
      result.money,
      Math.floor((baseReward(f).money * rates.currency * 1.5) / allied),
    );
    assert.equal(
      result.supplies,
      Math.floor((baseReward(f).supplies * rates.currency * 1.5) / allied),
    );
  });
test("room participant averages ignore army sizes and give reciprocal team ratios", () => {
  const roster = {
    a: { memberId: "own1", team: 0, performance: 2 },
    b: { memberId: "own1", team: 0, performance: 2 },
    c: { memberId: "own2", team: 0, performance: 1 },
    d: { memberId: "enemy", team: 1, performance: 3 },
  };
  assert.equal(R.strengthRatio(roster, 0), 2);
  assert.equal(R.strengthRatio(roster, 1), 0.5);
  assert.equal(R.strengthRatio({ ...roster, extra: { ...roster.a } }, 0), 2);
  assert.equal(R.strengthRatio({}, 0), 1);
});
test("individual target strength no longer stacks on the match strength ratio", (t) => {
  const f = fixture(t, { strength: 1 });
  // Both room participants started at 100%; later target changes must not add a multiplier.
  f.target.performance = 2;
  f.kill();
  const view = f.frames.get(f.clients[0]);
  assert.equal(
    view.economyAwards.find((a) => a.kind === "kill").money,
    Math.floor(R.price(f.target.model) * 0.5 * 1.25),
  );
  assert.equal(
    view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
    Math.floor(100 * G.modelOf(f.target).cost / G.modelOf(f.attacker).cost),
  );
});

test("money and supplies prices retain per-unit batch division and fallback independently", () => {
  const c = require("../shared/production-catalog.json"),
    o = c.offers.Type61__standard;
  assert.equal(R.price("Type61__standard"), c.licenseOffers.Type61.money);
  assert.equal(R.price("Type61__standard", "supplies"), c.licenseOffers.Type61.supplies);
  const base = c.offers[c.baseModels.RGM_79_G];
  assert.equal(R.price("RGM_79_G__cannon", "supplies"), c.licenseOffers.RGM_79_G.supplies);
});

test("both battle modes use the same starting participant composition coefficient", () => {
  const roster = {
    own: { team: 0, memberId: "self", bot: false },
    h: { team: 1, memberId: "human", bot: false },
    b: { team: 1, memberId: "bot", bot: true },
    duplicate: { team: 1, memberId: "human", bot: false },
  };
  assert.equal(R.opponentRatio(roster, 0, "regular"), 0.75);
  assert.equal(R.opponentRatio({ b: roster.b }, 0, "regular"), 0.5);
  assert.equal(R.opponentRatio({ h: roster.h }, 0, "regular"), 1);
  assert.equal(R.opponentRatio(roster, 0, "quick"), 0.75);
});
for (const mode of ["regular", "quick"])
  test(`AI composition scales authoritative ${mode} awards and final income`, (t) => {
    const f = fixture(t, { mode, strength: 1.5 });
    f.room.battleRoster[f.target.id].bot = true;
    const scale = 0.5,
      rates = rewardRates("PMC", mode);
    f.kill();
    const snapshot = f.frames.get(f.clients[0]);
    assert.deepEqual(snapshot.techAwards, []);
    assert.equal(
      snapshot.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).money,
      Math.floor(R.price(f.target.model) * 0.5 * rates.currency * 1.5 * scale),
    );
    assert.equal(
      snapshot.economyAwards.find(a => ["kill", "assist"].includes(a.kind)).supplies,
      Math.floor(R.price(f.target.model, "supplies") * 0.5 * rates.currency * 1.5 * scale),
    );
    assert.equal(
      snapshot.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
      Math.floor(100 * G.modelOf(f.target).cost / G.modelOf(f.attacker).cost * rates.experience * 1.5 * scale),
    );
    f.finish();
    const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
    assert.equal(
      result.money,
      Math.floor(baseReward(f).money * rates.currency * 1.5 * scale),
    );
    assert.equal(
      result.supplies,
      Math.floor(baseReward(f).supplies * rates.currency * 1.5 * scale),
    );
  });

test("victory uses frozen team-average formation COST, ignores room limit and assists never duplicate COST", (t) => {
  const f = fixture(t, { assist: true });
  f.kill();
  const cost = G.modelOf(f.target).cost;
  assert.deepEqual(f.room.teamDestroyedCost, [cost, 0]);
  f.room.settings.costLimit = 10000;
  f.finish();
  for (const i of [0, 2]) {
    const result = f.frames.get(f.clients[i]).economyAwards.find((a) => a.kind === "result");
    assert.equal(result.destroyedCost, cost);
    assert.equal(result.money, Math.floor(baseReward(f).money * 1.25));
    assert.equal(result.supplies, Math.floor(baseReward(f).supplies * 1.25));
  }
  const loser = f.frames.get(f.clients[1]).economyAwards.find((a) => a.kind === "result");
  assert.equal(loser.destroyedCost, 0);
  assert.equal(loser.money, 0);
  assert.equal(loser.supplies, 0);
  f.act(0, "sync");
  assert.deepEqual(f.room.teamDestroyedCost, [cost, 0]);
});

test("a losing team receives the half-rate result bonus for enemies it actually destroyed", (t) => {
  const f = fixture(t);
  f.room.game.team = 1;
  f.room.game.seed = 1;
  f.ally.hp = 1;
  f.act(1, "attack", { unitId: f.target.id, targetId: f.ally.id, weaponId: "EF_Type61_Cannon" });
  f.act(1, "end_turn");
  for (let i = 0; i < 8 && f.room.phase === "reaction"; i++)
    f.act(0, "respond", { response: "evade" });
  assert.equal(f.ally.hp, 0);
  assert.equal(f.room.phase, "playback");
  const batchId = f.room.playback.id;
  f.clients.forEach((_, i) => f.act(i, "playback_ready", { batchId }));
  assert.equal(f.room.phase, "idle");
  f.kill();
  f.finish();
  const loser = f.frames.get(f.clients[1]).economyAwards.find((a) => a.kind === "result");
  const cost = G.modelOf(f.ally).cost;
  assert.equal(loser.destroyedCost, cost);
  assert.equal(loser.money, Math.floor(cost * 1.25));
  assert.equal(loser.supplies, Math.floor(cost * 2 * 1.25));
});

for (const saved of [false, true])
  test(`server event kill hook counts authoritative human defeats once, saved=${saved}`, (t) => {
    const events = [],
      f = fixture(t, { saved, onHostileDefeat: (e) => events.push(e) });
    f.kill();
    f.finish();
    assert.equal(events.length, saved ? 0 : 1);
    if (!saved)
      assert.deepEqual(events[0], {
        id: f.room.matchId + ":" + f.target.id,
        cost: G.modelOf(f.target).cost,
        profileIds: ["profile-test-0"],
      });
  });

test("ACE experience acceleration is credited once by the authoritative award path", (t) => {
  const source = G.pilots.catalog.aces.find(
    (p) => p.price && p.skills.some((s) => s.id === "Pilot_ExpUp_Trigger"),
  );
  const f = fixture(t, { pilot: G.pilots.createAce(source.id) }),
    u = f.attacker;
  f.act(0, "skill", { unitId: u.id, skillId: "Pilot_ExpUp_Trigger", x: u.x, y: u.y });
  assert.equal(G.modelOf(u).pilotExperienceMultiplier, 1.35);
  f.kill();
  const award = f.frames.get(f.clients[0]).pilotAwards.find((a) => a.kind === "kill");
  assert.equal(award.experiencePoints, Math.floor(100 * G.modelOf(f.target).cost / G.modelOf(u).cost * 1.35));
  assert.equal(u.pilot.experience, award.experiencePoints);
  assert(!u.pilot.stats.shooting.temporary);
});
test("finished team-loss summaries include bot casualties and are public to observers only after combat", (t) => {
  const f = fixture(t);
  f.act(0, "sync");
  assert.equal(f.frames.get(f.clients[0]).teamLosses, null);
  f.room.battleRoster["bot-casualty"] = {
    memberId: "bot", bot: true, unitId: "Type61", model: f.attacker.model,
    money: 12345, supplies: 67890, team: 0,
  };
  f.kill(); f.finish();
  const watcher = { readyState: 1 };
  f.engine.join(watcher, { mode: "join", room: "REWARD", characterFaction: "PMC", name: "Observer" });
  const snapshot = f.frames.get(watcher);
  assert.equal(snapshot.you.seat, null);
  assert.deepEqual(snapshot.economyAwards, []);
  assert.deepEqual(snapshot.teamLosses.map(team => team.units.length), [1, 1]);
  assert.equal(snapshot.teamLosses[0].units[0].id, "bot-casualty");
  assert.deepEqual(Object.keys(snapshot.teamLosses[0].units[0]).sort(), ["id", "model", "unitId"]);
});

for(const saved of [false,true])test('settlement audit totals actual awards once, saved='+saved,t=>{
 const logs=[],f=fixture(t,{saved,onSettlement:r=>logs.push(structuredClone(r))});
 assert.equal(logs.length,0);f.kill();assert.equal(logs.length,0);f.finish();assert.equal(logs.length,1);
 const record=logs[0];assert.equal(record.matchId,f.room.matchId);assert.equal(record.costLimit,900);
 assert.equal(record.startedFromSave,saved);assert.equal(record.players.length,2);
 for(const p of record.players){
  const econ=(f.room.economyAwards||[]).filter(a=>a.memberId===p.memberId);
  const tech=(f.room.techAwards||[]).filter(a=>a.memberId===p.memberId);
  const xp=(f.room.pilotAwards||[]).filter(a=>a.memberId===p.memberId);
  assert.deepEqual(p.total,{money:econ.reduce((n,a)=>n+a.money,0),supplies:econ.reduce((n,a)=>n+a.supplies,0),technology:tech.reduce((n,a)=>n+a.points,0),experience:xp.reduce((n,a)=>n+(a.experiencePoints||0),0)});
  if(saved)assert.deepEqual(p.total,{money:0,supplies:0,technology:0,experience:0});
 }
 for(let i=0;i<3;i++)f.act(0,'sync');assert.equal(logs.length,1);
 assert.doesNotMatch(JSON.stringify(record),/token|secret|seed/i);
});

test('aborted matches do not produce settlement audit records',t=>{
 const logs=[],f=fixture(t,{onSettlement:r=>logs.push(r)});
 f.act(0,'return_room');assert.equal(logs.length,0);
});


test("casualties deduct stock immediately and final research does not deduct casualties twice", t => {
  const f = fixture(t, {faction:"EFSF", strength:4});
  const own = f.room.seats[0], enemy = f.room.seats[1];
  assert.equal(own.inventory.Type61,10); assert.deepEqual(own.kits,{});
  assert.equal(enemy.inventory.Type61,10);
  assert.equal(f.frames.get(f.clients[0]).economyAwards.filter(a=>a.kind==="deployment").length,1);
  f.ally.hp=0;
  f.kill();
  assert.deepEqual(f.frames.get(f.clients[0]).techAwards,[]);
  const kill = f.frames.get(f.clients[0]).economyAwards.find(a=>a.kind==="kill");
  assert.equal(kill.money,Math.floor(R.price(f.target.model)*0.5*rewardRates("EFSF","regular").currency*4));
  assert.equal(own.inventory.Type61,9);
  assert.equal(enemy.inventory.Type61,9);
  f.finish();
  const winner = f.frames.get(f.clients[0]), loser = f.frames.get(f.clients[1]);
  assert.equal(winner.techAwards.reduce((sum,a)=>sum+a.points,0),825);
  assert.equal(loser.techAwards.reduce((sum,a)=>sum+a.points,0),675);
  assert.equal(winner.economyAwards.find(a=>a.kind==="loss").stockLost.inventory.Type61,1);
  assert.equal(own.inventory.Type61,9); assert.deepEqual(own.kits,{});
  assert.equal(enemy.inventory.Type61,9); assert.deepEqual(enemy.kits,{});
  const before=JSON.stringify([f.room.economyAwards,f.room.techAwards,own.inventory]);
  f.act(0,"sync");
  assert.equal(JSON.stringify([f.room.economyAwards,f.room.techAwards,own.inventory]),before);
});

test("quick stock settlement uses fixed research and save-loaded battles never reserve physical inventory", t => {
  const quick=fixture(t,{mode:"quick"}); quick.kill(); quick.finish();
  assert.equal(quick.frames.get(quick.clients[0]).techAwards.reduce((sum,a)=>sum+a.points,0),82);
  const saved=fixture(t,{saved:true});
  assert.equal(saved.room.seats[0].inventory.Type61,10);
  saved.kill();saved.finish();
  assert.deepEqual(saved.frames.get(saved.clients[0]).economyAwards,[]);
  assert.deepEqual(saved.frames.get(saved.clients[0]).techAwards,[]);
});


test("host interruption settles actual casualties once without technology or victory rewards", t => {
  const f=fixture(t); f.ally.hp=0;
  f.act(0,"return_room");
  const view=f.frames.get(f.clients[0]);
  const returned=view.economyAwards.find(a=>a.kind==="loss");
  assert.equal(returned.stockLost.inventory.Type61,1);
  assert.equal(f.room.seats[0].inventory.Type61,9);
  assert.equal(f.room.seats[1].inventory.Type61,10);
  assert.deepEqual(view.techAwards,[]);
  const count=view.economyAwards.length;
  f.act(0,"return_room");
  assert.equal(f.frames.get(f.clients[0]).economyAwards.length,count);
});


for (const faction of ["AEUG", "TITANS", "NEO_ZEON"]) {
  test(`legacy ${faction} identity cannot override roster-based research`, t => {
    const f=fixture(t,{faction:"EFSF"});
    // Isolate settlement routing: the original unit source stays EFSF.
    f.room.seats[0].characterFaction=faction;
    assert.equal(G.modelOf(f.attacker).faction,"EFSF");
    f.kill(); f.finish();
    const awards=f.frames.get(f.clients[0]).techAwards;
    assert.equal(awards.length,1);assert.equal(awards[0].faction,"EFSF");
    assert.equal(awards[0].points,825);
  });
}


const tenToOneArmy = () => [...Array.from({length:10},()=>({unitId:"Type61",kitId:"standard"})),
  {unitId:"MS_06F",kitId:"machine_gun"}];
function pointsByFaction(snapshot) {
  return Object.fromEntries(snapshot.techAwards.map(award=>[award.faction,award.points]));
}
test("PMC opening roster apportions 10 to 1 even after casualties or model changes", t => {
  const f=fixture(t,{ownFormation:tenToOneArmy()});
  f.ally.hp=0;
  const zeon=f.room.game.units.find(unit=>G.ownerOf(unit)===0 && G.modelOf(unit).faction==="ZEON");
  zeon.model="Type61__standard";
  f.kill();f.finish();
  assert.deepEqual(pointsByFaction(f.frames.get(f.clients[0])),{EFSF:750,ZEON:75});
});
for (const [name,balances,expected] of [
  ["exclude a full faction",{EFSF:24000},{ZEON:825}],
  ["fill a nearly full faction and redistribute",{EFSF:23900},{EFSF:100,ZEON:725}],
  ["discard excess when all carried factions fill",{EFSF:23990,ZEON:23980},{EFSF:10,ZEON:20}],
  ["award nothing when all carried factions are full",{EFSF:24000,ZEON:24000},{}],
]) test("PMC caps: "+name,t=>{
  const f=fixture(t,{ownFormation:tenToOneArmy(),technologyPoints:balances});
  const original=JSON.stringify(f.room.technologyStartPoints);
  f.kill();f.finish();
  assert.deepEqual(pointsByFaction(f.frames.get(f.clients[0])),expected);
  const before=JSON.stringify(f.room.techAwards);f.act(0,"sync");
  assert.equal(JSON.stringify(f.room.techAwards),before);
  assert.equal(JSON.stringify(f.room.technologyStartPoints),original);
});
test("common units count every playable faction without requiring each one to attack",t=>{
  const f=fixture(t,{ownFormation:[{unitId:"Type61",kitId:"standard"},{unitId:"RGC_80",kitId:"beam_spray"}]});
  f.kill();f.finish();
  assert.deepEqual(pointsByFaction(f.frames.get(f.clients[0])),{EFSF:413,AEUG:206,TITANS:206});
});
for(const path of ["finish","return"]) test("quick casualties never remove chassis or kits, path="+path,t=>{
  const f=fixture(t,{mode:"quick"});
  assert.equal(f.room.seats[0].inventory.Type61,10);
  assert.deepEqual(f.room.seats[0].kits,{});
  const deployment=f.frames.get(f.clients[0]).economyAwards.find(award=>award.kind==="deployment");
  assert.deepEqual(deployment.stockUsed,{inventory:{},kits:{}});
  f.ally.hp=0;
  if(path==="finish"){f.kill();f.finish()}else f.act(0,"return_room");
  for(const player of f.room.seats.filter(Boolean)){
    assert.equal(player.inventory.Type61,10);assert.deepEqual(player.kits,{});
  }
  const before=JSON.stringify(f.room.economyAwards);f.act(0,"sync");
  assert.equal(JSON.stringify(f.room.economyAwards),before);
});

for (const [cost, money, supplies] of [
  [0,2500,5000], [1999,2500,5000], [2000,2500,5000], [2499,2500,5000],
  [2500,2750,5500], [4999,3750,7500], [5000,4000,8000], [7500,5150,10300],
  [10000,6220,12440], [15000,8120,16240], [17000,8800,17600],
  [19999,9550,19100], [20000,9700,19400], [20001,9700,19400], [24000,9700,19400], [24500,9700,19400], [99999,9700,19400],
]) test(`integer staircase base reward at COST ${cost}`, () => {
  assert.deepEqual(R.calculateBattleReward(cost), {money,supplies});
});

test("formation COST sums each participant before averaging and keeps teams independent", () => {
  const roster = {
    a:{memberId:"one",team:0,cost:4000}, b:{memberId:"one",team:0,cost:3000},
    c:{memberId:"two",team:0,cost:3000,bot:true}, d:{memberId:"enemy",team:1,cost:24000},
  };
  assert.equal(R.teamAverageFormationCost(roster,0),5000);
  assert.equal(R.teamAverageFormationCost(roster,1),24000);
  assert.equal(R.teamAverageFormationCost({},0),0);
  roster.c.cost=2999;
  assert.equal(R.teamAverageFormationCost(roster,0),4999.5);
  assert.deepEqual(R.calculateBattleReward(R.teamAverageFormationCost(roster,0)),{money:3750,supplies:7500});
});

for (const mode of ["regular", "quick"]) test(`authoritative ${mode} staircase reward freezes cost and uses teammate average`, t => {
  const f=fixture(t,{mode,assist:true});
  for (const unit of f.room.game.units)
    assert.equal(f.room.battleRoster[unit.id].cost,G.modelOf(unit).cost+(unit.pilot?.custom ? G.pilots.cost(unit.pilot) : 0));
  const ally = f.room.game.units.find(unit=>G.ownerOf(unit)===2);
  // Two friendly participants: 7000 and 3000, not three units averaged separately.
  f.room.battleRoster[f.attacker.id].cost=4000;
  f.room.battleRoster[f.ally.id].cost=3000;
  f.room.battleRoster[ally.id].cost=3000;
  f.room.settings.costLimit=100000;
  f.ally.hp=0;
  f.kill(); f.finish();
  const rate=(mode==="quick"?0.1:1)*1.25;
  for (const seat of [0,2]) {
    const result=f.frames.get(f.clients[seat]).economyAwards.find(a=>a.kind==="result");
    assert.equal(result.money,4000*rate);
    assert.equal(result.supplies,8000*rate);
  }
  assert.equal(R.teamAverageFormationCost(f.room.battleRoster,0),5000);
});

for (const mode of ["regular", "quick"]) test(`authoritative ${mode} victory base caps above 20000 roster COST`, t => {
  const f = fixture(t, {mode});
  for (const unit of Object.values(f.room.battleRoster))
    if (unit.team === 0) unit.cost = 50000;
  f.kill(); f.finish();
  const award = f.frames.get(f.clients[0]).economyAwards.find(a => a.kind === "result");
  const rate = (mode === "quick" ? .1 : 1) * 1.25;
  assert.equal(award.money, Math.floor(9700 * rate));
  assert.equal(award.supplies, Math.floor(19400 * rate));
});


test("closing and resuming regular battle preserves immediate casualty accounting without double deduction", t => {
  const f = fixture(t);
  const player = f.room.seats[0];
  const afterLoss = { inventory: { Type61: 9 }, kits: {} };
  f.ally.hp = 0;
  f.engine.disconnect(f.clients[0]);
  assert.deepEqual({ inventory: player.inventory, kits: player.kits }, afterLoss);
  assert(f.room.economyAwards.filter(a => a.memberId === player.id)
    .filter(a => a.kind !== "loss").every(a => !a.stockLost && !Object.keys(a.stockUsed?.inventory || {}).length));
  const resumed = { readyState: 1 };
  f.engine.join(resumed, { mode: "resume", room: "REWARD", token: player.token, characterFaction: "PMC" });
  f.clients[0] = resumed;
  assert.deepEqual({ inventory: player.inventory, kits: player.kits }, afterLoss);
  f.kill();
  assert.equal(player.inventory.Type61, 9);
  f.finish();
  const award = f.frames.get(resumed).economyAwards.find(a => a.kind === "result");
  assert.equal(award.stockLost, undefined);
  assert.deepEqual(f.frames.get(resumed).economyAwards.find(a => a.kind === "loss").stockLost,
    { inventory: { Type61: 1 }, kits: {} });
  assert.equal(player.inventory.Type61, 9);
  assert.deepEqual(player.kits,{});
  f.act(0, "sync");
  assert.equal(player.inventory.Type61, 9);
  assert.equal(f.frames.get(resumed).economyAwards.filter(a => a.kind === "result").length, 1);
});
