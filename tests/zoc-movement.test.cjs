const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles = Array.from({ length: 12 }, () => Array(12).fill("rock"));
  for (let x = 0; x <= 5; x++) game.tiles[4][x] = "plain";
  for (let x = 4; x <= 6; x++) game.tiles[3][x] = "plain";
  const [a, b] = game.units;
  G.models.zoc_test = { ...G.models[a.model], move: 20 };
  Object.assign(a, { model: "zoc_test", x: 2, y: 4 });
  Object.assign(b, { x: 5, y: 4 });
  return { game, a, b };
}
test("entering the last adjacent cell costs one; continuing past it costs three", () => {
  const { game, a } = fixture(),
    route = G.reachable(game, a);
  assert.equal(route.get("3,4").cost, 1);
  assert.equal(route.get("4,4").cost, 2);
  assert.equal(route.get("4,3").cost, 5);
  assert.equal(route.get("5,3").cost, 6);
  assert.equal(route.get("6,3").cost, 9);
});
test("a unit already next to an enemy pays control cost when moving away", () => {
  const { game, a } = fixture();
  a.x = 4;
  assert.equal(G.reachable(game, a).get("4,3").cost, 3);
});
test("dead enemies and allies do not penalize passing; multiple enemies do not stack", () => {
  const { game, a, b } = fixture();
  game.units.push({ ...b, id: "other", x: 3, y: 3 });
  assert.equal(G.reachable(game, a).get("4,4").cost, 4);
  game.units.pop();
  b.hp = 0;
  assert.equal(G.reachable(game, a).get("4,3").cost, 3);
  b.hp = 1;
  b.team = a.team;
  assert.equal(G.reachable(game, a).get("4,3").cost, 3);
});
test("approaching preserves ordinary terrain costs and impassable terrain", () => {
  const { game, a } = fixture();
  game.tiles[4][4] = "rubble";
  assert.equal(G.reachable(game, a).get("4,4").cost, 3);
  game.tiles[4][4] = "rock";
  assert.equal(G.reachable(game, a).has("4,4"), false);
});
