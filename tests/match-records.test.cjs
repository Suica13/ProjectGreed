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
test("record import rejects incompatible rules, invalid models, prototype keys and invalid turn indices", () => {
  const { archive } = record();
  for (const mutate of [
    (r) => (r.rules = "other"),
    (r) => (r.frames[0].turnStart = false),
    (r) => (r.frames[0].views.global.units[0].model = "missing"),
    (r) => (r.checkpoints[0].frame = -1),
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

test("older recordings retain turn navigation while discarding takeover state", () => {
  const { archive, g } = record();
  const imported = R.validate(G, archive);
  assert.deepEqual(imported.checkpoints, [{ frame: 0, round: g.round, team: g.team }]);
  assert.equal(JSON.stringify(imported.checkpoints).includes('"seed"'), false);
});

test("replay conversion saves the turn start with fresh seeds and leaves the record unchanged", () => {
  const { archive, first, g } = record();
  const later = R.clone(first);
  later.game.units[0].hp -= 100;
  archive.frames.push({ at: 1, views: { global: R.pack(first, later) } });
  const input = R.validate(G, archive),
    before = JSON.stringify(input);
  const save = R.saveFromReplay(G, input, 1, 987, 654);
  assert.equal(save.game.units[0].hp, g.units[0].hp);
  assert.equal(save.game.seed, 987);
  assert.equal(save.game.partSeed, 654);
  assert.equal(save.format, "ProjectGreed-save");
  assert.equal(R.validateSave(G, save).game.round, g.round);
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => R.saveFromReplay(G, { ...input, perspectives: ["team:0"] }, 0, 1, 2));
});
