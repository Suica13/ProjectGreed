const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  D = require("../shared/development.js");
const { createRoomEngine } = require("../shared/room-engine.js");
const all = (f) => D.nodes(f).map((n) => n.id);
test("inactive late-game faction never advances AI, while active main-line progress mirrors both factions", () => {
  const profile = {
    EFSF: all("EFSF"),
    ZEON: D.nodes("ZEON")
      .filter((n) => n.page === 0 && n.row === "mid" && n.column <= 2)
      .map((n) => n.id),
  };
  const original = JSON.stringify(profile);
  const result = D.aiResearch([{ characterFaction: "ZEON", researched: profile }]);
  for (const faction of ["EFSF", "ZEON"]) {
    assert(
      D.nodes(faction)
        .filter((n) => result[faction].includes(n.id))
        .every((n) => n.page === 0 && n.column <= 2),
    );
    for (const n of D.nodes(faction).filter((n) => n.page === 0 && n.column <= 2))
      assert(result[faction].includes(n.id), n.id);
  }
  assert.equal(JSON.stringify(profile), original);
  const switched = D.aiResearch([{ characterFaction: "EFSF", researched: profile }]);
  assert(D.nodes("ZEON").some((n) => n.page === 1 && switched.ZEON.includes(n.id)));
  const pmc = D.aiResearch([{ characterFaction: "PMC", researched: profile }]);
  assert.deepEqual(pmc, switched);
  const merged = D.aiResearch([
    { characterFaction: "ZEON", researched: profile },
    { characterFaction: "EFSF", researched: profile },
  ]);
  assert.deepEqual(merged, switched);
});
test("room source follows selected faction and does not include spectator research", () => {
  let seq = 0;
  const frames = new Map();
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "active-" + ++seq,
    randomToken: () => "token-" + ++seq,
    randomSeed: () => 1,
    send: (ws, m) => frames.set(ws, m),
  });
  const host = { readyState: 1 },
    watcher = { readyState: 1 };
  try {
    const model = Object.values(G.models).find(
      (m) =>
        m.faction === "ZEON" &&
        !m.formOnly &&
        !m.wip &&
        m.cost <= 250 &&
        D.allows("ZEON", m.prefabId, {}),
    );
    const researched = { EFSF: all("EFSF") };
    engine.join(host, {
      mode: "create",
      room: "ACTIVE",
      characterFaction: "EFSF",
      researched,
      inventory: { [model.prefabId]: 5 },
    });
    const room = engine.rooms.get("ACTIVE");
    const act = (action, fields = {}) =>
      engine.action(host, {
        id: "action-" + ++seq,
        revision: room.revision,
        round: room.game.round,
        matchId: room.matchId,
        action,
        ...fields,
      });
    act("add_ai", { seat: 1 });
    engine.join(watcher, {
      mode: "join",
      room: "ACTIVE",
      characterFaction: "EFSF",
      researched: { EFSF: all("EFSF") },
    });
    assert.equal(watcher.seat, null);
    act("set_faction", { faction: "ZEON" });
    act("start_game", {
      formation: [{ unitId: model.prefabId, kitId: model.kitId }],
      researched,
      inventory: { [model.prefabId]: 5 },
    });
    assert.equal(room.phase, "assembly");
    assert.deepEqual(room.aiResearch, D.aiResearch([{ characterFaction: "ZEON", researched }]));
    assert(!D.nodes("EFSF").some((n) => n.page === 1 && room.aiResearch.EFSF.includes(n.id)));
    assert(
      room.seats[1].formation.every((e) =>
        D.allows(room.seats[1].characterFaction, e.unitId, room.aiResearch),
      ),
    );
    const limits = frames.get(watcher).assembly.players.find((p) => p.bot);
    assert(limits.limit >= 750 && limits.limit <= 1000);
    assert(limits.unitLimit >= 9 && limits.unitLimit <= 12);
    assert(limits.unitCostLimit >= 187 && limits.unitCostLimit <= 250);
    assert(
      room.seats[1].formation.reduce(
        (sum, e) => sum + G.models[e.unitId + "__" + e.kitId].cost,
        0,
      ) <= limits.limit,
    );
    assert(G.formationPoints(room.seats[1].formation) <= limits.unitLimit);
    assert(
      room.seats[1].formation.every(
        (e) => G.models[e.unitId + "__" + e.kitId].cost <= limits.unitCostLimit,
      ),
    );
    room.game.seed ^= 0x12345678;
    act("sync");
    assert.deepEqual(
      frames.get(watcher).assembly.players.find((p) => p.bot),
      limits,
    );
  } finally {
    engine.close();
  }
});
function pool(run) {
  const saved = { ...G.models },
    base = G.models.Type61__standard;
  for (const id of Object.keys(G.models)) delete G.models[id];
  const add = (id, cost) =>
    (G.models[id + "__standard"] = {
      ...base,
      prefabId: id,
      kitId: "standard",
      cost,
      ship: false,
      unitTags: ["Tank"],
      skills: [],
      commandAuras: [],
      hangars: [],
      supplyAura: null,
    });
  try {
    return run(add);
  } finally {
    for (const id of Object.keys(G.models)) delete G.models[id];
    Object.assign(G.models, saved);
  }
}
test("comparable main-line units have higher draw probability without weapon-kit bias", () =>
  pool((add) => {
    add("Type61", 100);
    add("branch-a", 100);
    add("branch-b", 100);
    let main = 0;
    for (let n = 1; n <= 240; n++) {
      const seed = Math.imul(n, 0x9e3779b9) >>> 0;
      const result = G.randomFormation(seed, 100, {}, 1);
      assert.equal(result.length, 1);
      if (result[0].unitId === "Type61") main++;
      assert.deepEqual(result, G.randomFormation(seed, 100, {}, 1));
    }
    assert(main > 120 && main < 180, String(main));
  }));
test("comparable cheaper units prevent a narrow high-cost tier from repeatedly selecting one chassis", () =>
  pool((add) => {
    add("Type61", 100);
    add("branch-a", 75);
    add("branch-b", 65);
    add("branch-c", 60);
    for (let n = 1; n <= 60; n++) {
      const army = G.randomFormation(Math.imul(n, 0x9e3779b9) >>> 0, 600, {}, 6);
      assert.equal(army.length, 6);
      assert(new Set(army.map((e) => e.unitId)).size >= 3, JSON.stringify(army));
      assert(army.reduce((sum, e) => sum + G.models[e.unitId + "__" + e.kitId].cost, 0) <= 600);
      for (const id of new Set(army.map((e) => e.unitId)))
        assert(army.filter((e) => e.unitId === id).length <= 3, JSON.stringify(army));
    }
  }));

test("AI budget, points and per-unit cost vary independently within 75-100 percent without changing humans", () => {
  const settings = {
    ...G.defaultRoomSettings(),
    costLimit: 1000,
    unitLimit: 12,
    unitCostLimit: 250,
  };
  const variants = new Set(),
    budgets = new Set(),
    points = new Set(),
    unitCaps = new Set();
  for (let seed = 1; seed <= 240; seed++) {
    const formationVariation = G.aiFormationVariation(Math.imul(seed, 0x9e3779b9), 1);
    assert.deepEqual(formationVariation, G.aiFormationVariation(Math.imul(seed, 0x9e3779b9), 1));
    for (const v of Object.values(formationVariation)) assert(v >= 0.75 && v <= 1);
    variants.add(JSON.stringify(formationVariation));
    const bot = { bot: true, seat: 1, formationVariation };
    const budget = G.armyBudget(settings, bot),
      count = G.armyUnitLimit(settings, bot),
      cap = G.armyRestrictions(settings, bot).unitCostLimit;
    assert(budget >= 750 && budget <= 1000);
    assert(count >= 9 && count <= 12);
    assert(cap >= 187 && cap <= 250);
    budgets.add(budget);
    points.add(count);
    unitCaps.add(cap);
    const human = { ...bot, bot: false };
    assert.equal(G.armyBudget(settings, human), 1000);
    assert.equal(G.armyUnitLimit(settings, human), 12);
    assert.equal(G.armyRestrictions(settings, human).unitCostLimit, 250);
  }
  assert(variants.size > 100);
  assert(budgets.size > 15);
  assert(points.size >= 3);
  assert(unitCaps.size > 15);
});
