const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js"),
  R = require("../shared/match-records.js");
function record() {
  const g = G.create(false, 123),
    settings = { ...G.defaultRoomSettings(), mapId: g.mapId };
  const archive = R.create(G, "test", settings, g.tiles),
    { seed, partSeed, tiles, ...publicGame } = g;
  const first = { game: { ...publicGame, tiles }, phase: "idle", log: ["first"], viewTeam: null };
  archive.perspectives = ["global"];
  archive.frames = [{ at: 0, turnStart: true, views: { global: R.pack(null, first) } }];
  const { tiles: ignored, ...privateGame } = g;
  archive.checkpoints = [{ frame: 0, game: R.clone(privateGame) }];
  return { archive, first, g };
}
test("record deltas preserve changed, removed and new units and prepend logs without mutating earlier frames", () => {
  const { archive, first } = record();
  const second = R.clone(first);
  second.game.units[0].hp -= 100;
  second.game.units.pop();
  second.log.unshift("second");
  archive.frames.push({ at: 1, views: { global: R.pack(first, second) } });
  assert.deepEqual(R.view(archive, 1, "global"), second);
  assert.deepEqual(R.view(archive, 0, "global"), first);
  assert.equal(archive.frames[1].views.global.units.length, 1);
  assert.deepEqual(archive.frames[1].views.global.log, { prepend: ["second"] });
  assert.equal(R.validate(G, archive).frames.length, 2);
});
test("record import rejects incompatible rules, invalid models, prototype keys and non-turn resume points", () => {
  const { archive } = record();
  for (const mutate of [
    (r) => (r.rules = "other"),
    (r) => (r.frames[0].turnStart = false),
    (r) => (r.checkpoints[0].game.units[0].model = "missing"),
    (r) => (r.checkpoints[0].game.seed = null),
    (r) => (r.frames[0].views.global.units[0].x = -1),
  ]) {
    const bad = R.clone(archive);
    mutate(bad);
    assert.throws(() => R.validate(G, bad));
  }
  const bad = JSON.parse(
    JSON.stringify(archive).replace('"format":', '"__proto__":{"polluted":true},"format":'),
  );
  assert.throws(() => R.validate(G, bad));
  assert.equal({}.polluted, undefined);
});
