const test = require("node:test"),
  assert = require("node:assert/strict");
const Sensors = require("../shared/unit-sensors.js");

function fixture() {
  const api = Sensors.create({
    modelOf: (unit) => ({ sensors: unit.sensors, movementType: unit.flying ? "air" : "ground" }),
    cells: (unit) =>
      Array.from({ length: unit.width || 1 }, (_, i) => ({ x: unit.x + i, y: unit.y })),
    onMap: (unit) => unit.hp > 0 && !unit.embarked,
    minovskyAt: (_game, unit) => unit.x === 7,
  });
  const game = {
    round: 2,
    environment: "ground",
    fogMode: "full",
    tiles: Array.from({ length: 16 }, () => Array(22).fill("plain")),
    units: Array.from({ length: 24 }, (_, i) => ({
      id: "u" + i,
      team: i % 2,
      hp: 100,
      x: (i * 7) % 20,
      y: (i * 3) % 15,
      width: i % 5 === 0 ? 2 : 1,
      flying: i % 3 === 0,
      brokenParts: i % 4 === 0 ? { head: true } : {},
      sensors: {
        sight: 3 + (i % 6),
        radar: i % 4 === 0 ? 0 : 8,
        antiDetection: i % 3,
        stealth: i % 3 === 0,
        antiDetect: i % 5 === 0,
        revealOnDetection: i % 7 === 0,
      },
    })),
    visionAreas: [{ team: 0, x: 8, y: 8, sight: 4, radar: 6, expiresRound: 5 }],
    campaignBattlefield: { layout: { nodes: [{ id: "node", x: 15, y: 5 }] }, owners: { node: 1 } },
  };
  return { api, game };
}

test("query-local sensor caches match independent detection and sight after board mutations", () => {
  const { api, game } = fixture();
  for (const fog of ["full", "visible", "disabled"])
    for (let step = 0; step < 5; step++) {
      game.fogMode = fog;
      game.round++;
      game.climate = { sight: step % 2 ? 0.75 : 1, radar: step % 2 ? 0.6 : 1 };
      game.units[3].x = 2 + step;
      game.units[4].hp = step % 2 ? 0 : 100;
      game.units[5].embarked = step % 2 ? { carrierId: "u1" } : null;
      game.units[7].detectedBy = { 0: game.round };
      for (const team of [0, 1]) {
        const active = game.units.filter((unit) => unit.hp > 0 && !unit.embarked);
        const view = api.view(game, team);
        assert.deepEqual(
          view.visibleIds,
          active.filter((unit) => api.visible(game, team, unit)).map((unit) => unit.id),
        );
        assert.deepEqual(
          view.detectedIds,
          active.filter((unit) => api.detected(game, team, unit)).map((unit) => unit.id),
        );
        assert.equal(new Set(view.visibleCells).size, view.visibleCells.length);
        if (fog !== "full") assert.equal(view.visibleCells.length, 16 * 22);
      }
    }
});

test("full-map visibility has stable order, isolated arrays and follows map dimension changes", () => {
  const { api, game } = fixture();
  game.fogMode = "disabled";
  const first = api.view(game, 0).visibleCells;
  game.units.reverse();
  game.units[0].x++;
  assert.deepEqual(api.view(game, 0).visibleCells, first);
  first.pop();
  assert.equal(api.view(game, 0).visibleCells.length, 16 * 22);
  game.tiles.pop();
  assert.equal(api.view(game, 0).visibleCells.length, 15 * 22);
  game.tiles = [Array(3).fill("plain")];
  assert.deepEqual(api.view(game, 0).visibleCells, ["0,0", "1,0", "2,0"]);
});

test("unchanged full-fog coverage has stable cell order despite observer movement", () => {
  const { api, game } = fixture();
  game.units = game.units.slice(0, 2);
  game.units.forEach((unit) => {
    unit.team = 0;
    unit.width = 1;
  });
  game.units[0].sensors.sight = 2;
  game.units[1].sensors.sight = 100;
  const first = api.view(game, 0).visibleCells;
  game.units[0].x++;
  assert.deepEqual(api.view(game, 0).visibleCells, first);
  assert.equal(first.length, 16 * 22);
  game.units.push({
    ...structuredClone(game.units[0]),
    id: "off-map",
    team: 1,
    x: 50.5,
    y: 50,
    sensors: { sight: 1, radar: 1, revealOnDetection: true },
    detectedBy: { 0: game.round },
  });
  assert(api.view(game, 0).visibleCells.includes("50.5,50"));
});
