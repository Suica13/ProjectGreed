const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const formation = [{ unitId: "RGM_79", kitId: "machine_gun" }];
function duel() {
  const g = G.create(false, 1, [formation, formation]);
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 4, hp: 100000, shield: 0 });
  Object.assign(b, { x: 4, y: 4, hp: 100000, shield: 0 });
  return { g, a, b, w: G.models[a.model].weapons[0] };
}
test("counter attacks multiply final hit chance by 0.75 without penalizing the initiating attack", () => {
  const { g, a, b, w } = duel();
  g.tiles[a.y][a.x] = "forest";
  const normal = G.estimate(g, b, a, w),
    counter = G.estimate(g, b, a, w, "counter", true);
  assert.equal(counter.hit, normal.hit * 0.75);
  assert.equal(counter.damage, normal.damage);
  const incoming = G.estimate(g, a, b, w),
    events = G.fight(g, a, b, w, "counter", w.id);
  assert.equal(events.length, 2);
  for (const strike of events[0].strikes) assert.equal(strike.hitChance, incoming.hit);
  for (const strike of events[1].strikes) assert.equal(strike.hitChance, counter.hit);
});
test("remaining actions count legal movement and affordable in-range attacks, excluding dead or finished units", () => {
  const { g, a, b } = duel();
  assert.equal(G.hasActions(g), true);
  a.moved = true;
  assert.equal(G.hasActions(g), true);
  a.en = 0;
  assert.equal(G.hasActions(g), true, "native free head vulcan remains usable");
  a.brokenParts = { head: true };
  assert.equal(G.hasActions(g), false);
  a.brokenParts = {};
  a.moved = false;
  assert.equal(G.hasActions(g), true);
  a.acted = true;
  assert.equal(G.hasActions(g), false);
  a.acted = false;
  a.moved = true;
  a.en = 100;
  b.x = 22;
  assert.equal(G.hasActions(g), false);
  a.moved = false;
  for (const [x, y] of [
    [1, 4],
    [3, 4],
    [2, 3],
    [2, 5],
  ])
    g.tiles[y][x] = "rock";
  assert.equal(G.hasActions(g), false);
  a.hp = 0;
  assert.equal(G.hasActions(g), false);
});
test("each team handoff increments the turn and refreshes only the incoming team", () => {
  const { g, a, b } = duel();
  a.en = b.en = 0;
  a.acted = b.acted = true;
  a.moved = b.moved = true;
  G.end(g);
  assert.deepEqual([g.team, g.round, a.en, b.en, a.acted, b.acted], [1, 2, 0, 0, true, false]);
  G.end(g);
  assert.deepEqual([g.team, g.round, a.en, b.en, a.acted], [0, 3, 0, 0, false]);
});
