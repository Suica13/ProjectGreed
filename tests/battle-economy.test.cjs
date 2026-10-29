const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  R = require("../shared/battle-economy.js");
const { createRoomEngine } = require("../shared/room-engine.js");
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
    pilot = null,
  } = {},
) {
  let seq = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    getRewardMultipliers,
    onHostileDefeat,
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
      inventory: { Type61: 10 },
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
    costLimit: 900,
    unitCostLimit: 99999,
    fogMode: "disabled",
  });
  if (assist) act(2, "switch_seat", { seat: 2 });
  const tank = { unitId: "Type61", kitId: "standard" };
  const formations = [
    [
      {
        ...tank,
        customPilot: pilot || G.pilots.createCustom("custom-reward", "Reward", null, faction),
      },
      tank,
    ],
    [tank],
  ];
  if (assist) formations.push([tank]);
  clients.forEach((_, i) => act(i, "set_ready", { ready: true, formation: formations[i] }));
  act(0, "start_game", { formation: formations[0] });
  clients.forEach((_, i) => act(i, "confirm_formation"));
  clients.forEach((_, i) => act(i, "confirm_deployment"));
  assert.equal(room.game.units.length, assist ? 4 : 3);
  room.startedFromSave = saved;
  // This fixture switches to a loaded match after initial deployment; discard the
  // new-match participation notice generated before that switch.
  if (saved) room.pilotAwards = [];
  room.game.tiles.forEach((r) => r.fill("plain"));
  const [attacker, ally, target] = room.game.units;
  [
    [attacker, 2, 4],
    [ally, 2, 5],
    [target, 4, 4],
  ].forEach(([u, x, y]) => Object.assign(u, { x, y, shield: 0 }));
  target.performance = strength;
  room.battleRoster[target.id].performance = strength;
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
for (const faction of ["EFSF", "PMC"])
  for (const mode of faction === "EFSF" ? ["regular"] : ["regular", "quick"])
    test(`authoritative ${faction} ${mode}: private prices, rates, win bonus, losses and deduplication`, (t) => {
      const f = fixture(t, { faction, mode, strength: 1.5 });
      f.ally.hp = 0;
      f.kill();
      const view = f.frames.get(f.clients[0]);
      const rates = R.rates(faction, mode);
      assert.equal(
        view.techAwards[0].points,
        Math.floor(G.modelOf(f.target).cost * 0.5 * rates.technology * 1.5),
      );
      assert.equal(
        view.economyAwards[0].money,
        Math.floor(R.price("Type61__standard") * rates.currency * 1.5),
      );
      assert.equal(
        view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
        Math.floor(G.modelOf(f.target).cost * rates.experience * 1.5),
      );
      assert.equal(
        view.economyAwards[0].supplies,
        Math.floor(R.price(f.target.model, "supplies") * rates.currency * 1.5),
      );
      assert(!view.economyAwards.some((a) => a.kind === "result"));
      assert.deepEqual(f.frames.get(f.clients[1]).economyAwards, []);
      assert.equal(view.battleRoster, undefined);
      f.finish();
      const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
      assert.equal(result.money, Math.floor(G.modelOf(f.target).cost * 1.5 * rates.currency * 1.5));
      assert.equal(
        result.supplies,
        Math.floor(G.modelOf(f.target).cost * 3 * rates.currency * 1.5),
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
  test(`${path} before the match ends waives inventory losses through reconnection`, (t) => {
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
    assert.deepEqual(f.frames.get(next).economyAwards.find((a) => a.kind === "result").losses, {});
    assert(f.frames.get(next).economyAwards.some((a) => a.kind === "kill"));
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
  assert(R.price("RX_80PR_2__kit_0") > R.price("RX_80PR_2__kit_3"));
});

test("identity and quick-mode multiplier contract", () => {
  assert.deepEqual(R.rates("EFSF", "regular"), { currency: 0.5, technology: 1, experience: 1 });
  assert.deepEqual(R.rates("PMC", "regular"), { currency: 1, technology: 0.5, experience: 1 });
  assert.deepEqual(R.rates("EFSF", "quick"), { currency: 0.05, technology: 0.1, experience: 0.1 });
  assert.deepEqual(R.rates("PMC", "quick"), { currency: 0.1, technology: 0.05, experience: 0.1 });
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
        assert.equal(view.economyAwards.length, below ? 0 : 1);
        const expectedTech = below
          ? 0
          : Math.floor(G.modelOf(f.target).cost * 0.25 * R.rates(faction, mode).technology * 1.5);
        assert.equal(view.techAwards.length, expectedTech > 0 ? 1 : 0);
        if (!below) {
          const rates = R.rates(faction, mode);
          assert.equal(
            view.economyAwards[0].money,
            Math.floor(R.price(f.target.model) * 0.25 * rates.currency * 1.5),
          );
          assert.equal(
            view.economyAwards[0].supplies,
            Math.floor(R.price(f.target.model, "supplies") * 0.25 * rates.currency * 1.5),
          );
          assert.equal(view.economyAwards[0].kind, "assist");
          assert.equal(
            view.techAwards[0]?.points ?? 0,
            Math.floor(G.modelOf(f.target).cost * 0.25 * rates.technology * 1.5),
          );
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
      const rates = R.rates(faction, mode);
      f.kill();
      const view = f.frames.get(f.clients[0]);
      assert.equal(
        view.techAwards[0].points,
        Math.floor(G.modelOf(f.target).cost * 0.5 * rates.technology * 1.5 * 5),
      );
      assert.equal(
        view.economyAwards[0].money,
        Math.floor(R.price(f.target.model) * rates.currency * 1.5 * 2),
      );
      assert.equal(
        view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
        Math.floor(G.modelOf(f.target).cost * rates.experience * 1.5 * 3),
      );
      assert.equal(
        view.economyAwards[0].supplies,
        Math.floor(R.price(f.target.model, "supplies") * rates.currency * 1.5 * 4),
      );
      f.finish();
      const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
      assert.equal(
        result.money,
        Math.floor(G.modelOf(f.target).cost * 1.5 * rates.currency * 1.5 * 2),
      );
      assert.equal(
        result.supplies,
        Math.floor(G.modelOf(f.target).cost * 3 * rates.currency * 1.5 * 4),
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
  const money = f.frames.get(f.clients[0]).economyAwards[0].money;
  active = false;
  f.finish();
  const awards = f.frames.get(f.clients[0]).economyAwards;
  assert.equal(awards[0].money, money);
  assert.equal(awards.find((a) => a.kind === "result").money, G.modelOf(f.target).cost * 1.5);
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
  assert.equal(result.money, Math.floor((G.modelOf(f.target).cost * 1.5) / 2));
  assert.equal(result.supplies, Math.floor((G.modelOf(f.target).cost * 3) / 2));
  const before = JSON.stringify(result);
  f.act(0, "sync");
  assert.equal(
    JSON.stringify(f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result")),
    before,
  );
  assert.equal(R.strengthRatio({}, 0), 1);
});

for (const allied of [0.5, 1, 1.5, 2])
  test(`allied unit strength ${allied} adjusts kill currency, technology, pilot XP and victory income`, (t) => {
    const f = fixture(t, { faction: "EFSF", strength: 1.5 });
    for (const unit of Object.values(f.room.battleRoster))
      if (unit.team === 0) unit.performance = allied;
    f.kill();
    const view = f.frames.get(f.clients[0]),
      rates = R.rates("EFSF", "regular");
    assert.equal(
      view.economyAwards.find((a) => a.kind === "kill").money,
      Math.floor((R.price(f.target.model) * rates.currency * 1.5) / allied),
    );
    assert.equal(
      view.economyAwards.find((a) => a.kind === "kill").supplies,
      Math.floor((R.price(f.target.model, "supplies") * rates.currency * 1.5) / allied),
    );
    assert.equal(
      view.techAwards.find((a) => a.kind === "kill").points,
      Math.floor((G.modelOf(f.target).cost * 0.5 * rates.technology * 1.5) / allied),
    );
    assert.equal(
      view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
      Math.floor((G.modelOf(f.target).cost * rates.experience * 1.5) / allied),
    );
    f.finish();
    const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
    assert.equal(
      result.money,
      Math.floor((G.modelOf(f.target).cost * 1.5 * rates.currency * 1.5) / allied),
    );
    assert.equal(
      result.supplies,
      Math.floor((G.modelOf(f.target).cost * 3 * rates.currency * 1.5) / allied),
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
    Math.floor(R.price(f.target.model)),
  );
  assert.equal(
    view.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
    Math.floor(G.modelOf(f.target).cost),
  );
});

test("money and supplies prices retain per-unit batch division and fallback independently", () => {
  const c = require("../shared/production-catalog.json"),
    o = c.offers.Type61__standard;
  assert.equal(R.price("Type61__standard"), o.money / o.quantity);
  assert.equal(R.price("Type61__standard", "supplies"), o.supplies / o.quantity);
  const base = c.offers[c.baseModels.RGM_79_G];
  assert.equal(R.price("RGM_79_G__cannon", "supplies"), base.supplies / base.quantity);
});

test("regular opponent composition counts starting participants, never unit counts or quick games", () => {
  const roster = {
    own: { team: 0, memberId: "self", bot: false },
    h: { team: 1, memberId: "human", bot: false },
    b: { team: 1, memberId: "bot", bot: true },
    duplicate: { team: 1, memberId: "human", bot: false },
  };
  assert.equal(R.opponentRatio(roster, 0, "regular"), 0.75);
  assert.equal(R.opponentRatio({ b: roster.b }, 0, "regular"), 0.5);
  assert.equal(R.opponentRatio({ h: roster.h }, 0, "regular"), 1);
  assert.equal(R.opponentRatio(roster, 0, "quick"), 1);
});
for (const mode of ["regular", "quick"])
  test(`AI composition scales authoritative ${mode} awards and final income`, (t) => {
    const f = fixture(t, { mode, strength: 1.5 });
    f.room.battleRoster[f.target.id].bot = true;
    const scale = mode === "regular" ? 0.5 : 1,
      rates = R.rates("PMC", mode);
    f.kill();
    const snapshot = f.frames.get(f.clients[0]);
    assert.equal(
      snapshot.techAwards[0]?.points ?? 0,
      Math.floor(G.modelOf(f.target).cost * 0.5 * rates.technology * 1.5 * scale),
    );
    assert.equal(
      snapshot.economyAwards[0].money,
      Math.floor(R.price(f.target.model) * rates.currency * 1.5 * scale),
    );
    assert.equal(
      snapshot.economyAwards[0].supplies,
      Math.floor(R.price(f.target.model, "supplies") * rates.currency * 1.5 * scale),
    );
    assert.equal(
      snapshot.pilotAwards.find((a) => a.kind === "kill").experiencePoints,
      Math.floor(G.modelOf(f.target).cost * rates.experience * 1.5 * scale),
    );
    f.finish();
    const result = f.frames.get(f.clients[0]).economyAwards.find((a) => a.kind === "result");
    assert.equal(
      result.money,
      Math.floor(G.modelOf(f.target).cost * 1.5 * rates.currency * 1.5 * scale),
    );
    assert.equal(
      result.supplies,
      Math.floor(G.modelOf(f.target).cost * 3 * rates.currency * 1.5 * scale),
    );
  });

test("result rewards use each team's credited hostile COST, ignore room limits and do not duplicate assists", (t) => {
  const f = fixture(t, { assist: true });
  f.kill();
  const cost = G.modelOf(f.target).cost;
  assert.deepEqual(f.room.teamDestroyedCost, [cost, 0]);
  f.room.settings.costLimit = 10000;
  f.finish();
  for (const i of [0, 2]) {
    const result = f.frames.get(f.clients[i]).economyAwards.find((a) => a.kind === "result");
    assert.equal(result.destroyedCost, cost);
    assert.equal(result.money, Math.floor(cost * 1.5));
    assert.equal(result.supplies, Math.floor(cost * 3));
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
  assert.equal(loser.money, Math.floor(cost * 0.75));
  assert.equal(loser.supplies, Math.floor(cost * 1.5));
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
  assert.equal(G.modelOf(u).pilotExperienceMultiplier, 1.75);
  f.kill();
  const award = f.frames.get(f.clients[0]).pilotAwards.find((a) => a.kind === "kill");
  assert.equal(award.experiencePoints, Math.floor(G.modelOf(f.target).cost * 1.75));
  assert.equal(u.pilot.experience, award.experiencePoints);
  assert(!u.pilot.stats.shooting.temporary);
});
