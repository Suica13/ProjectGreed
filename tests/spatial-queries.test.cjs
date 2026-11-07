const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");

function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 123, [[entry], [entry]], false, { fogMode: "disabled" });
  g.tiles = Array.from({ length: 18 }, () => Array(24).fill("plain"));
  g.tiles[4][5] = "rock";
  const first = g.units[0],
    enemy = g.units[1];
  Object.assign(first, { x: 4, y: 4 });
  Object.assign(enemy, { x: 11, y: 7 });
  const large = G.makeUnit(
    { unitId: "Medea", kitId: "standard" },
    0,
    "large",
    { x: 8, y: 5 },
    90,
    123,
  );
  large.pendingMove = { x: 15, y: 8, angle: 0 };
  g.units.push(large, {
    ...structuredClone(enemy),
    id: "cargo",
    x: 7,
    y: 6,
    embarked: { carrierId: large.id },
  });
  return { g, first };
}

test("batch placement agrees with authoritative fits for rotated hulls, reserved cells and enclosed cargo", () => {
  const { g, first } = fixture();
  const query = G.placementQuery(g);
  for (const angle of [0, 90])
    for (let y = -1; y < 19; y++)
      for (let x = -1; x < 25; x++) {
        assert.equal(
          query.fits(first, x, y, angle),
          G.fits(g, first, x, y, angle),
          `${x},${y}/${angle}`,
        );
      }
  const added = { ...structuredClone(first), id: "airdrop", x: 3, y: 10 };
  assert(query.fits(first, added.x, added.y));
  g.units.push(added);
  query.include(added);
  assert.equal(query.fits(first, added.x, added.y), false);
  assert.equal(query.fits(added, added.x, added.y), true);
});

test("separate movement searches see current reservations, deaths and restored destinations", () => {
  const { g, first } = fixture();
  const obstacle = g.units[1];
  Object.assign(obstacle, { x: 6, y: 4, pendingMove: { x: 4, y: 5 } });
  assert(!G.reachable(g, first).has("4,5"));
  obstacle.pendingMove = null;
  assert(G.reachable(g, first).has("4,5"));
  assert(!G.reachable(g, first).has("6,4"));
  obstacle.hp = 0;
  assert(G.reachable(g, first).has("6,4"));
});
