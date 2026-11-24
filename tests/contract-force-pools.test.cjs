const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  C = require("../shared/contract-mode"),
  F = require("../shared/contract-forces");
const { createRoomEngine } = require("../shared/room-engine"),
  { generate } = require("../tools/compile-contract-force-pools.cjs");
function checkPilots(units, difficulty) {
  assert(units.every(u => [undefined, "veteran", "elite"].includes(u.pilot.genericGrade)));
  if (difficulty < 5)
    assert(units.every(u => !u.pilot.genericGrade && u.pilot.name.includes("\u4e00\u822c")));
}
function fixture(t, { difficulty = 6, faction = "ZEON", players = 1, lobby = false, seed = 1936384585 } = {}) {
  let serial = 0;
  const errors = [],
    clients = Array.from({ length: players }, () => ({ readyState: 1 }));
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "pool-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => seed,
    aiDelayMs: 999999,
    roomReturnMs: 999999,
    send: (ws, msg) => {
      if (msg.type === "error") errors.push(msg.message);
    },
  });
  t.after(() => engine.close());
  for (let i = 0; i < players; i++)
    engine.join(clients[i], {
      mode: i ? "join" : "create",
      room: "POOL",
      roomMode: "sweep",
      characterFaction: "PMC",
      inventory: { Medea: 5 },
      licenses: { Medea: true },
      storedUnits: [
        {
          id: "stock",
          unitId: "Medea",
          kitId: "standard",
          hp: G.models.Medea__standard.hp,
          en: G.models.Medea__standard.en,
        },
      ],
    });
  const room = engine.rooms.get("POOL"),
    formation = [{ unitId: "Medea", kitId: "standard", stockId: "stock" }];
  const act = (i, action, fields = {}) =>
    engine.action(clients[i], {
      id: "act-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  act(0, "configure_room", {
    ...room.settings,
    sweepDifficulty: difficulty,
    sweepFaction: faction,
    sweepAlliedFaction: faction === "ZEON" ? "EFSF" : "ZEON",
    sweepEnvironment: "ground",
  });
  if (lobby) return { room, act, errors };
  for (let i = 1; i < players; i++) act(i, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  for (let i = 0; i < players; i++) act(i, "confirm_formation");
  assert.equal(room.phase, "deployment", errors.join("\n"));
  for (let i = 0; i < players; i++) {
    act(i, "auto_place_deployment");
    act(i, "confirm_deployment");
  }
  assert.equal(room.phase, "idle", errors.join("\n"));
  assert.deepEqual(errors, []);
  return { room, act, errors };
}
test("both runtime force pools exactly match the six-level Markdown source", () => {
  const data = generate({ check: true });
  assert.deepEqual(data, require("../shared/contract-force-pools.json"));
  for (const faction of ["EFSF", "ZEON"])
    for (let difficulty = 1; difficulty <= 6; difficulty++) {
      const settings = {
        sweepEra: "UC_0079_T1",
        sweepEnvironment: "ground",
        sweepFaction: faction,
        sweepDifficulty: difficulty,
      };
      const profile = F.profile(settings),
        formations = F.formations(settings, G);
      assert(formations.length);
      for (const f of formations) {
        assert(f.budget > 0);
        assert.equal(f.units.length % 3, 0);
        assert(f.kits.every((kits) => kits.length));
      }
      assert.equal(profile.garrisons.command,
        (faction === "EFSF" ? [150, 275, 400, 575, 775, 1050] : [150, 250, 450, 625, 775, 1050])[difficulty - 1]);
      assert.equal(
        profile.waves["defend.first"],
        (faction === "EFSF" ? [150, 325, 450, 650, 875, 1125] : [150, 300, 500, 700, 875, 1125])[difficulty - 1],
      );
      assert.equal(
        profile.waves["defend.followup"],
        (faction === "EFSF" ? [75, 100, 100, 150, 200, 300] : [75, 75, 125, 175, 200, 300])[difficulty - 1],
      );
    }
});
test("budget draws keep whole formations, caps, availability, and rarity separate", () => {
  const settings = {
    sweepEra: "UC_0079_T1",
    sweepEnvironment: "ground",
    sweepFaction: "EFSF",
    sweepDifficulty: 6,
  };
  let seed = 7;
  const rng = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 100; i++) {
    const drawn = F.draw(settings, G, rng, 350, 9);
    assert(drawn.reduce((s, f) => s + f.budget, 0) <= 350);
    assert(drawn.reduce((s, f) => s + f.models.length, 0) <= 9);
    assert(drawn.every((f) => f.models.length % 3 === 0));
  }
  assert.deepEqual(F.draw(settings, G, rng, 1000, 2), []);
  assert.deepEqual(F.draw(settings, G, rng, 50, 9), []);
  const list = F.formations(settings, G);
  assert(
    list.some(
      (f) =>
        f.units.includes("RX_78_2") && f.units.includes("RX_77_2") && f.units.includes("RX_75"),
    ),
  );
  assert(list.filter((f) => f.units.includes("RX_78_2")).every((f) => f.weight === .25 * 1.15));
  assert(
    list
      .filter((f) => f.units.every((id) => id === "RX_77_2" || id === "RX_75"))
      .every((f) => f.weight === 1 * 1.15),
  );
  assert(list.filter((f) => f.units.every((id) => id === "RGM_79")).every((f) => f.weight === (f.units.length===3?8:4)));
});
test("explicit budgets scale by player count once, replacing generic head-count adjustments", () => {
  for (let players = 1; players <= 5; players++) {
    const room = { settings: {sweepDifficulty:1}, game: { contract: { players } } };
    assert.equal(F.budget(room, 100), 100 + 25 * (players - 1));
    assert.equal(F.budget(room, 100, true), 100 + 25 * (players - 1));
  }
});

for (const faction of ["EFSF", "ZEON"])
  test(`N1 ${faction} starts with at most nine ordinary enemies across sampled maps`, t => {
    for (let sample=0;sample<8;sample++) {
      const f=fixture(t,{faction,difficulty:1,seed:1936384585+sample*1979});
      const enemies=f.room.game.units.filter(unit=>unit.team===1&&!unit.facility);
      assert(enemies.length>0&&enemies.length<=9);
      assert(enemies.every(unit=>!unit.pilot.genericGrade));
    }
  });
test("Zeon switches from Zaku to Gouf to Dom, excludes branch units and middle/late conventional aircraft", () => {
  const branches = new Set([
    "EMS_10",
    "EMS_10_1",
    "MS_08TX",
    "MS_08TX_Kai",
    "MS_07H",
    "MS_07H8",
    "MS_10",
    "MS_11",
    "MS_11S",
    "MS_12",
  ]);
  for (let n = 1; n <= 6; n++) {
    const p = F.profile({
      sweepEra: "UC_0079_T1",
      sweepEnvironment: "ground",
      sweepFaction: "ZEON",
      sweepDifficulty: n,
    });
    const main = p.formations.filter((f) => f.weight === 8).flatMap((f) => f.units);
    assert(
      main.some((id) =>
        n < 3 ? id.startsWith("MS_06") : n < 5 ? id === "MS_07B" : id === "MS_09",
      ),
    );
    assert(p.formations.every((f) => f.units.every((id) => !branches.has(id))));
    if (n >= 3)
      assert(
        p.formations.every((f) =>
          f.units.every((id) => !["MTank", "Dopp", "ZN_Heli"].includes(id)),
        ),
      );
  }
});
for (const faction of ["EFSF", "ZEON"])
  for (const difficulty of [1, 2, 3, 4, 5, 6])
    test(`live ${faction} N${difficulty} initial forces and patrols use configured formations`, (t) => {
      const f = fixture(t, { faction, difficulty }),
        g = f.room.game;
      const formations = F.formations(f.room.settings, G),
        allowed = new Set(formations.flatMap((f) => f.units));
      const mobile = () => g.units.filter((u) => u.team === 1 && !u.facility && !u.embarked);
      assert(mobile().length);
      assert(mobile().every((u) => allowed.has(G.modelOf(u).prefabId)));
      checkPilots(mobile(), difficulty);
      for (const o of g.contract.objectives) o.status = "completed";
      const before = g.units.length;
      for (let i = 0; i < 4; i++) {
        g.round += 2;
        C.poll(f.room, G);
      }
      const added = g.units.slice(before);
      assert(added.length >= 3);
      assert.equal(added.length % 3, 0);
      assert(added.every((u) => u.contractReinforcement && allowed.has(G.modelOf(u).prefabId)));
      assert(added.every((u) => G.squadMembers(g, u).length <= 3));
      checkPilots(added, difficulty);
    });
for (const faction of ["EFSF", "ZEON"])
  test(`live ${faction} N6 salvage uses two upgraded, loaded transports`, (t) => {
    const f = fixture(t, { faction }),
      g = f.room.game,
      o = g.contract.objectives.find((o) => o.type === "salvage");
    assert(o);
    const actor = g.units.find((u) => u.ownerSeat === 0);
    Object.assign(actor, { x: o.x, y: o.y, acted: false, moved: false });
    const before = g.units.length;
    C.action(f.room, G, f.room.seats[0], {
      action: "contract_interact",
      unitId: actor.id,
      objectiveId: o.id,
    });
    const added = g.units.slice(before),
      ships = added.filter(
        (u) => G.modelOf(u).prefabId === (faction === "EFSF" ? "MedeaKai" : "FatUncleKai"),
      );
    assert.equal(ships.length, 2);
    assert.equal(o.status, "completed");
    for (const ship of ships) {
      const cargo = added.filter((u) => u.embarked?.carrierId === ship.id);
      assert(cargo.length >= 3);
      assert.equal(cargo.length % 3, 0);
    }
    assert(added.length <= C.config(6).patrolLimit);
    checkPilots(added, 6);
  });
test("lobby and startup authoritatively reject space contracts without limiting quick battles", (t) => {
  assert.throws(
    () => C.roomSettings({ sweepDifficulty: 1, sweepEra: "UC_0079_T1", sweepEnvironment: "space" }),
    /宇宙.*禁用/,
  );
  const f = fixture(t, { difficulty: 1, lobby: true });
  assert.throws(
    () => f.act(0, "configure_room", { ...f.room.settings, sweepEnvironment: "space" }),
    /宇宙.*禁用/,
  );
  assert.equal(f.room.settings.sweepEnvironment, "ground");
  f.room.settings.sweepEnvironment = "space";
  assert.throws(
    () =>
      f.act(0, "start_game", {
        formation: [{ unitId: "Medea", kitId: "standard", stockId: "stock" }],
      }),
    /宇宙.*禁用/,
  );
  assert(G.getMap("outer_orbit_5v5").environment === "space");
});
test("five-player configured waves keep complete formations below the shared live cap", (t) => {
  const f = fixture(t, { players: 5 }),
    g = f.room.game;
  assert.equal(g.contract.players, 5);
  for (const u of g.units.filter((u) => u.team === 1)) u.hp = 0;
  for (const o of g.contract.objectives) o.status = "completed";
  for (let i = 0; i < 160; i++) {
    g.round += 2;
    C.poll(f.room, G);
  }
  let alive = g.units.filter((u) => u.contractReinforcement && u.hp > 0);
  assert(alive.length > 0);
  assert(alive.length <= 108);
  assert.equal(alive.length % 3, 0);
  const count = g.units.length;
  for (let i = 0; i < 8; i++) {
    g.round += 2;
    C.poll(f.room, G);
  }
  assert.equal(g.units.length, count);
  for (const u of alive.slice(0, 3)) u.hp = 0;
  for (let i = 0; i < 4; i++) {
    g.round += 2;
    C.poll(f.room, G);
  }
  assert(g.units.length > count);
  assert(g.units.filter((u) => u.contractReinforcement && u.hp > 0).length <= 108);
});
