const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const modelOf = (entry) => G.models[entry.unitId + "__" + entry.kitId];
const commander = (model) =>
  !model.ship && model.commandAuras?.some((aura) => ["cmdAtk", "cmdCom", "cmdDef"].includes(aura.type));
const seedOf = (n) => Math.imul(n, 0x9e3779b9) >>> 0;
test("AI mixes starter platforms, respects budget and counts command auras across weapon kits", () => {
  for (const faction of ["EFSF", "ZEON"])
    for (const environment of ["ground", "space"]) {
      for (let n = 1; n <= 30; n++) {
        const restrictions = { characterFaction: faction, environment, unitCostLimit: 500 };
        const army = G.randomFormation(seedOf(n), 3000, restrictions, 12);
        assert.deepEqual(army, G.randomFormation(seedOf(n), 3000, restrictions, 12));
        assert.ok(army.length >= 3);
        assert.ok(new Set(army.map((entry) => entry.unitId)).size >= 3, JSON.stringify(army));
        assert.ok(G.formationPoints(army) <= 12);
        assert.ok(army.reduce((total, entry) => total + modelOf(entry).cost, 0) <= 3000);
        assert.ok(army.every((entry) => !G.restrictionReason(modelOf(entry), restrictions)));
        const nonShips = army.map(modelOf).filter((model) => !model.ship);
        assert.ok(nonShips.filter(commander).length <= Math.floor(nonShips.length / 3));
        if (environment === "space")
          assert.ok(nonShips.every((model) => !model.unitTags.includes("Infantry")));
      }
    }
});
test("space maps exclude ground infantry even at tiny budgets and when environment is inferred from mapId", () => {
  for (const budget of [25, 100, 500, 3000, 20000])
    for (let n = 1; n <= 10; n++) {
      const army = G.randomFormation(
        seedOf(n),
        budget,
        { mapId: "asteroid_crossing_1v1", unitCostLimit: 5000 },
        12,
      );
      assert.ok(army.every((entry) => !modelOf(entry).unitTags.includes("Infantry")));
      assert.ok(army.every((entry) => modelOf(entry).adaptability.space > 0));
    }
});
test("every three non-ship units can probabilistically include one MOD-aura commander, including multiple command slots", () => {
  const saved = { ...G.models },
    base = G.models.Type61__standard;
  for (const key of Object.keys(G.models)) delete G.models[key];
  for (const [id, aura] of [
    ["line-a", null],
    ["line-b", null],
    ["leader-a", "cmdCom"],
    ["leader-b", "cmdDef"],
  ])
    G.models[id + "__standard"] = {
      ...base,
      prefabId: id,
      kitId: "standard",
      cost: 100,
      ship: false,
      commandAuras: aura ? [{ type: aura, radiusCells: 2 }] : [],
    };
  try {
    const totals = new Set();
    let threeWith = 0,
      threeWithout = 0;
    for (let n = 1; n <= 100; n++) {
      const seed = seedOf(n),
        small = G.randomFormation(seed, 300, {}, 3),
        large = G.randomFormation(seed, 900, {}, 9);
      assert.equal(small.length, 3);
      assert.equal(large.length, 9);
      const smallCount = small.map(modelOf).filter(commander).length;
      assert.ok(smallCount <= 1);
      smallCount ? threeWith++ : threeWithout++;
      const count = large.map(modelOf).filter(commander).length;
      totals.add(count);
      assert.ok(count <= 3);
      for (let length = 1; length <= large.length; length++)
        assert.ok(
          large.slice(0, length).map(modelOf).filter(commander).length <= Math.floor(length / 3),
        );
    }
    assert.ok(threeWith > 25 && threeWithout > 25, `${threeWith}/${threeWithout}`);
    assert.ok([...totals].some((total) => total > 1));
    assert.equal(G.randomFormation(7319, 200, {}, 2).map(modelOf).filter(commander).length, 0);
  } finally {
    for (const key of Object.keys(G.models)) delete G.models[key];
    Object.assign(G.models, saved);
  }
});
test("tight pools may repeat ordinary platforms but free ground infantry cannot flood a roster", () => {
  for (const bannedFactions of [["EFSF"], ["ZEON"]])
    for (let n = 1; n <= 20; n++) {
      const army = G.randomFormation(seedOf(n), 100, { bannedFactions, unitCostLimit: 100 }, 12);
      assert.ok(
        army.map(modelOf).filter((model) => model.unitTags.includes("Infantry")).length <= 2,
      );
      assert.ok(army.reduce((total, entry) => total + modelOf(entry).cost, 0) <= 100);
    }
});

test("mixed AI rosters deploy on both map environments without overlap or exceeding formation points", () => {
  for (const mapId of ["frontier_1v1", "asteroid_crossing_1v1"])
    for (const seed of [1, 7319, seedOf(99)]) {
      const settings = {
        ...G.defaultRoomSettings(),
        mapId,
        costLimit: 3000,
        unitCostLimit: 500,
        unitLimit: 12,
      };
      const formations = [0, 1].map((seat) => {
        const restrictions = G.formationRestrictions(settings, seat);
        const army = G.randomFormation(seed + seat, 3000, restrictions, 12);
        assert.ok(G.planFormation(army, 3000, restrictions, 12).deployable.length > 0);
        return army;
      });
      const game = G.create(false, seed, formations, true, settings);
      assert.equal(game.units.length, formations.flat().length);
      const cells = game.units
        .filter((unit) => !unit.embarked)
        .flatMap((unit) => G.cells(unit).map((cell) => G.key(cell.x, cell.y)));
      assert.equal(new Set(cells).size, cells.length);
    }
});
