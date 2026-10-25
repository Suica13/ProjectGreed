const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog();
function runtime() {
  const context = { ART, game: { tiles: [["water"]] } };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/weapon-effects.js", "utf8") + ";globalThis.fx=WeaponEffects",
    context,
  );
  return context;
}
test("death selects native ground, space and water sheets without changing battle RNG", () => {
  const r = runtime(),
    u = { id: "u", model: "RGM_79__machine_gun", x: 0, y: 0 };
  assert.equal(r.fx.deathSequence({ ...u, environment: "space" }).effect, "Explosion_Space_1");
  assert.equal(r.fx.deathSequence(u).effect, "Explosion_Water_1");
  r.game.tiles[0][0] = "plain";
  assert.equal(r.fx.deathSequence(u).effect, "Explosion_Ground_1");
});
test("large ship death keeps ten native-cadence secondary explosions before its environment-specific main blast", () => {
  const r = runtime(),
    u = { id: "ship", model: "SalamisClass__standard", environment: "space", x: 0, y: 0 };
  const sequence = r.fx.deathSequence(u);
  assert.equal(sequence.events.length, 11);
  assert.equal(sequence.effect, "Common_Explosion_MA_Space_1");
  sequence.events.slice(0, 10).forEach((e, i) => {
    assert.equal(e.effect, "LargeUnitDie_1_Space");
    assert.equal(e.at, i * 0.2);
    assert.ok(Math.abs(e.x) <= 60 && Math.abs(e.y) <= 100);
  });
  assert.equal(sequence.events[10].at, 2);
  assert.equal(sequence.duration, 2 + ART.effects[sequence.effect].duration);
  assert.equal(JSON.stringify(sequence), JSON.stringify(r.fx.deathSequence(u)));
  assert.equal(r.fx.deathSequence(u, true).events.length, 1);
});
