const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const pilot = (stats = {}) => ({
  stats: {
    shooting: 100,
    melee: 100,
    defense: 100,
    speed: 100,
    accuracy: 100,
    reaction: 100,
    leadership: 100,
    awakening: 50,
    ...stats,
  },
});
function fixture(accuracy = 100, reaction = 100, speed = 100) {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  g.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 3, pilot: pilot({ accuracy }) });
  Object.assign(b, { x: 4, y: 3, pilot: pilot({ reaction, speed }) });
  const w = G.modelOf(a).weapons.find((w) => w.id === "EF_90mmMG") || G.modelOf(a).weapons[0];
  return { g, a, b, w };
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, actual + " != " + expected);
test("GM accuracy 140 versus reaction 200 yields 68 percent while evading", () => {
  const { g, a, b, w } = fixture(140, 200);
  near(G.estimate(g, a, b, w, "evade").hit, 68);
});
test("equal accuracy and reaction growth cancels before the final cap", () => {
  for (const value of [90, 100, 140, 200]) {
    const { g, a, b, w } = fixture(value, value);
    near(G.estimate(g, a, b, w, "evade").hit, 85);
  }
});
test("reaction and speed divide hit chance, including normal and counter attacks", () => {
  let { g, a, b, w } = fixture(100, 200);
  near(G.estimate(g, a, b, w).hit, 100 / 1.5);
  ({ g, a, b, w } = fixture(140, 200, 200));
  near(G.estimate(g, a, b, w, "evade").hit, 68 / 1.1);
  ({ g, a, b, w } = fixture(140, 200));
  near(G.estimate(g, a, b, w, "counter", true).hit, 60);
  near(G.estimate(g, a, b, w, "evade", true).hit, 48);
});
test("final chance remains bounded and 100 percent is still possible", () => {
  const { g, a, b, w } = fixture(200, 90);
  near(G.estimate(g, a, b, w, "evade").hit, 100);
  near(G.estimate(g, a, b, { ...w, hit: 0 }, "evade").hit, 0);
});
test("serialized game snapshots preserve the opposed pilot multipliers", () => {
  const f = fixture(140, 200),
    g = JSON.parse(JSON.stringify(f.g));
  near(G.estimate(g, g.units[0], g.units[1], f.w, "evade").hit, 68);
});
test("smoke applies before the final cap and particles never improve excess accuracy", () => {
  const { g, a, b, w } = fixture(200, 100);
  const field = { x: b.x, y: b.y, radius: 2, expiresRound: g.round + 2 };
  g.smokeFields = [field];
  near(G.estimate(g, a, b, w, "evade").hit, 95.625);
  g.minovskyFields = [field];
  near(G.estimate(g, a, b, w, "evade").hit, 95.625);
  a.pilot = pilot({ accuracy: 140 });
  b.pilot = pilot({ reaction: 200 });
  near(G.estimate(g, a, b, w, "evade").hit, (68 - (100 - 68) * 0.25) * 0.75);
});
test("resolved combat uses the same 68 percent chance as its preview", () => {
  const { g, a, b, w } = fixture(140, 200);
  b.hp = 1000000;
  b.shield = 0;
  const events = G.fight(g, a, b, w, "evade", null, false);
  const strikes = events.flatMap((event) => event.strikes || []);
  assert.ok(strikes.length > 0);
  for (const strike of strikes) near(strike.hitChance, 68);
});
