const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog();
function runtime() {
  let engineClock;
  const starts = [],
    gains = [],
    stops = [];
  class AudioContext {
    constructor() {
      engineClock = this;
      this.currentTime = 10;
      this.state = "running";
      this.destination = {};
    }
    decodeAudioData(bytes) {
      assert.ok(bytes.byteLength > 0);
      return Promise.resolve({ bytes });
    }
    createGain() {
      const gain = { gain: { value: 0 }, connect() {}, disconnect() {} };
      gains.push(gain);
      return gain;
    }
    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start(at) {
          starts.push({ at, node: this });
        },
        stop() {
          stops.push(this);
        },
      };
    }
  }
  const context = {
    ART,
    atob,
    Uint8Array,
    window: { AudioContext, addEventListener() {} },
    document: { addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/weapon-audio.js", "utf8") +
      "\nglobalThis.audio=WeaponAudio;globalThis.clock=()=>context;",
    context,
  );
  return { ...context, starts, gains, stops, clock: () => engineClock };
}
const weapon = (id) =>
  Object.values(ART.models)
    .flatMap((m) => m.weapons)
    .find((w) => w.id === id);
test("original OGG references, volumes and original weapon identifiers are embedded offline", () => {
  assert.equal(Object.keys(ART.sounds).filter((key) => key.startsWith("RGM_79/")).length, 5);
  assert.equal(ART.presentation.sfxVolume, 0.5);
  for (const [id, name, file, volume] of [
    ["EF_BeamSprayGun", "光束喷枪", "BeamSprayGun_1.ogg", 0.6],
    ["EF_90mmMG", "90mm机枪", "MachineGun_1.ogg", 0.3],
    ["EF_HypeBazooka", "火箭筒", "Bazooka_1.ogg", 0.4],
    ["EF_BeamSaber_A", "光束军刀", "BeamSaber_1.ogg", 0.5],
    ["Common_DoubleVulcan_MS", "头部火神炮", "Vulcan_1.ogg", 0.2],
  ]) {
    const w = weapon(id);
    assert.equal(w.id, id);
    assert.equal(w.sourceName, id);
    assert.equal(w.name, name);
    assert.ok(w.sound.file.endsWith(file));
    assert.equal(w.sound.volume, volume);
    const data = Buffer.from(ART.sounds[w.sound.asset].split(",")[1], "base64");
    assert.equal(data.subarray(0, 4).toString(), "OggS");
  }
});
test("sound clock schedules every MG Step once, uses original volume, and cancels on skip/seek", async () => {
  const r = runtime();
  await r.audio.unlock();
  const owner = {};
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0);
  assert.equal(r.starts.length, 9);
  assert.deepEqual(
    r.starts.map((s) => Math.round((s.at - 10) * 10) / 10),
    [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1],
  );
  assert.ok(r.gains.every((g) => g.gain.value === 0.075));
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0.01);
  assert.equal(r.starts.length, 9);
  r.audio.stop();
  assert.equal(r.stops.length, 9);
  r.audio.sync({}, 0, weapon("Common_DoubleVulcan_MS"), 0);
  assert.equal(r.starts.length, 25);
  r.audio.stop();
  assert.equal(r.stops.length, 25);
  r.audio.sync({}, 0, weapon("EF_90mmMG"), 1.6);
  assert.equal(r.starts.length, 25);
});
test("quick playback and counter attacks get distinct sound schedules without replaying snapshots", async () => {
  const r = runtime();
  await r.audio.unlock();
  const owner = {};
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0, 2);
  assert.equal(r.starts[0].at, 10.15);
  assert.ok(r.starts.every((s) => s.node.playbackRate.value === 2));
  r.audio.sync(owner, 1, weapon("EF_HypeBazooka"), 0);
  assert.equal(r.stops.length, 9);
  assert.equal(r.starts.length, 11);
  assert.equal(r.starts.at(-1).at, 10.75);
  r.audio.sync(owner, 1, weapon("EF_HypeBazooka"), 0.01);
  assert.equal(r.starts.length, 11);
});

test("a battle can start while sounds decode without losing its sound schedule", async () => {
  const r = runtime(),
    owner = {},
    loading = r.audio.unlock();
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0);
  await loading;
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0);
  assert.equal(r.starts.length, 9);
});

test("quick battle muting cancels queued cues and keeps map sounds independent", async () => {
  const r = runtime();
  await r.audio.unlock();
  const owner = {};
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0);
  assert.equal(r.starts.length, 9);
  r.audio.setBattleMuted(true);
  assert.equal(r.stops.length, 9);
  const cues = [
    { at: 0, sound: weapon("EF_90mmMG").sound },
    { at: 0.2, sound: ART.presentation.deathSound },
    { at: 0.4, sound: Object.values(ART.effects)[0].sounds[0] },
  ];
  r.audio.sync(owner, 1, weapon("EF_HypeBazooka"), 0, 1, cues);
  r.audio.play(weapon("EF_HypeBazooka").sound, 10, 1, "battle");
  assert.equal(r.starts.length, 9);
  r.audio.play(ART.presentation.moveSound);
  assert.equal(r.starts.length, 10);
  r.audio.setBattleMuted(false);
  r.audio.sync(owner, 0, weapon("EF_90mmMG"), 0.8);
  assert.equal(r.starts.length, 14);
  assert.ok(r.starts.slice(10).every((s) => s.at >= 10));
});

test("natural counter completion preserves the playing last shot, cancels future cues and keeps skip/mute effective", async () => {
  const r = runtime();
  await r.audio.unlock();
  r.audio.sync({}, 1, weapon("EF_HypeBazooka"), 0);
  const [first, last] = r.starts;
  r.clock().currentTime = last.at;
  r.audio.releaseBattle();
  r.audio.stopBattle();
  assert.equal(r.stops.includes(first.node), false);
  assert.equal(r.stops.includes(last.node), false);
  r.audio.setBattleMuted(true);
  assert.ok(r.stops.includes(last.node));
  const q = runtime();
  await q.audio.unlock();
  q.audio.sync({}, 1, weapon("EF_HypeBazooka"), 0);
  q.clock().currentTime = q.starts[0].at;
  q.audio.releaseBattle();
  assert.equal(q.stops.includes(q.starts[0].node), false);
  assert.equal(q.stops.includes(q.starts[1].node), true);
  q.audio.stop();
  assert.equal(q.stops.includes(q.starts[0].node), true);
});

test("battle effects are halved again while map and interface audio keep their current level", async () => {
  const r = runtime();
  await r.audio.unlock();
  const sound = weapon("EF_90mmMG").sound;
  r.audio.play(sound, undefined, 1, "battle");
  r.audio.play(sound, undefined, 1, "map");
  assert.equal(r.gains[0].gain.value, r.gains[1].gain.value * 0.5);
});
