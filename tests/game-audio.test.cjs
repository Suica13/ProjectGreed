const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const G = require("../shared/rules.js");
function runtime() {
  const played = [];
  const context = {
    ART: G.catalog,
    Rules: G,
    WeaponAudio: { unlock: () => Promise.resolve(), play: (s) => played.push(s.asset) },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/game-audio.js", "utf8") + "\nglobalThis.audio = GameAudio;",
    context,
  );
  return { audio: context.audio, played };
}
const snapshot = (phase, round = 1, team = 0) => ({
  started: phase !== "waiting",
  phase,
  matchId: "match-1",
  connected: [true, true, true, true],
  game: {
    round,
    team,
    units: [
      { id: "a", ownerSeat: 0 },
      { id: "b", ownerSeat: 1 },
      { id: "ally", ownerSeat: 2 },
    ],
  },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("native game notifications are embedded OGG assets and play once for start and own team turns", async () => {
  for (const key of [
    "gameStartSound",
    "turnSound",
    "underAttackSound",
    "lockonSound",
    "infoSound",
    "selectUnitSound",
    "selectWeaponSound",
    "changeEquipmentSound",
  ]) {
    const sound = G.catalog.presentation[key];
    assert.ok(sound.duration > 0);
    assert.equal(
      Buffer.from(G.catalog.sounds[sound.asset].split(",")[1], "base64").subarray(0, 4).toString(),
      "OggS",
    );
  }
  const r = runtime();
  r.audio.receive(snapshot("waiting"), 0, false);
  r.audio.receive(snapshot("assembly"), 0, true);
  r.audio.receive(snapshot("assembly"), 0, true);
  await flush();
  assert.deepEqual(r.played, []);
  r.audio.receive(snapshot("deployment"), 0, true);
  r.audio.receive(snapshot("idle"), 0, true);
  r.audio.receive(snapshot("idle"), 0, true);
  r.audio.receive(snapshot("idle", 2, 1), 0, true);
  r.audio.receive(snapshot("idle", 3, 0), 0, true);
  await flush();
  assert.deepEqual(r.played, [
    "presentation/gameStartSound",
    "presentation/turnSound",
    "presentation/turnSound",
  ]);
});

test("attack cues follow owner seats, deduplicate snapshots, ignore spectators, and do not replay on reconnect", async () => {
  for (const [seat, expected] of [
    [0, "presentation/lockonSound"],
    [1, "presentation/underAttackSound"],
    [2, null],
    [null, null],
  ]) {
    const r = runtime();
    r.audio.receive(snapshot("idle"), seat, false);
    const attack = snapshot("reaction");
    attack.lastEvent = { type: "attack", id: "attack-1", attacker: "a", target: "b" };
    r.audio.receive(attack, seat, true);
    r.audio.receive(attack, seat, true);
    r.audio.receive(attack, seat, false);
    r.audio.receive(attack, seat, true);
    await flush();
    assert.deepEqual(r.played, expected ? [expected] : []);
  }
  const r = runtime();
  r.audio.receive(snapshot("waiting"), 0, false);
  r.audio.receive(snapshot("assembly"), 0, true);
  r.audio.receive(snapshot("deployment"), 0, true);
  r.audio.reset();
  await flush();
  assert.deepEqual(r.played, []);
});
