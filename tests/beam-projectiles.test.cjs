const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), { spawnSync } = require("node:child_process");
const G = require("../shared/rules"), Auto = require("../shared/automatic-fire");
const targets = [
  ["RX_78GP03D", "EF_RX_78GP03D_BeamCannon", 55, 16, 3],
  ["MA_08", "ZN_MA_08_BeamCannon", 55, 16, 3],
  ["AMX_014", "NZN_AMX_014_BR", 75, 16, 3],
  ["AMX_014", "NZN_AMX_014_BeamCannon", 150, 10, 2],
  ["FA_010A", "AEUG_FA_010A_BeamCannon", 150, 10, 2],
  ["FA_010S", "AEUG_FA_010S_MegaBeamCannon", 75, 16, 3],
];
function weapon(id, key) {
  return Object.values(G.models).filter(m => m.prefabId === id)
    .flatMap(m => m.weapons).find(w => w.id === key);
}
test("heavy beam families retain their native sheets and damage-carrier speed", () => {
  for (const [id, key, speed, frames, segments] of targets) {
    const w = weapon(id, key), sequence = w.projectile.sequence;
    assert.equal(w.nativePayload.ProjectileSpeed, speed);
    assert.equal(w.projectile.speed, speed * 0.1);
    assert.equal(sequence.clock, "flight");
    assert.equal(sequence.segments.length, segments);
    assert(sequence.segments.every(s => s.frames === frames && s.asset.startsWith("projectile-sequence/")));
    assert(sequence.length > 0);
    assert(Auto.flight(G, { x: 3, y: 3 }, { x: 6, y: 3 }, w) < 1);
  }
  assert(!weapon("RGM_79", "EF_BeamSprayGun").projectile.sequence);
});

test("segmented pulse samples frames once and ends with its damage carrier at every zoom", () => {
  const images = {}, context = { ART: G.catalog, SpriteRenderer: { images }, SpriteEffects: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("client/weapon-effects.js", "utf8") + ";globalThis.fx=WeaponEffects", context);
  for (const [id, key] of targets) {
    const w = structuredClone(weapon(id, key));
    delete w.muzzleEffects;
    for (const s of w.projectile.sequence.segments) images[s.asset] = { asset: s.asset };
    const frames = [];
    for (const scale of [0.2, 1, 3]) {
      const calls = [], transforms = [];
      const ctx = { save() {}, restore() {}, translate(x, y) { transforms.push([x,y]); }, rotate() {}, scale() {},
        drawImage(...args) { calls.push(args); } };
      const shot = { origin: { x: 40, y: 20 }, destination: { x: 40 + 400 * scale, y: 20 },
        at: 0.5, flight: 0.8, visibleUntil: 1.3 };
      context.fx.draw(ctx, w, { shots: [shot] }, 0.9, { scale }, null);
      assert.equal(calls.length, w.projectile.sequence.segments.length);
      assert(calls.every(args => args.length === 9), "Crop a frame instead of drawing the whole strip");
      frames.push(calls.map((args, i) => args[1] / w.projectile.sequence.segments[i].width));
      assert.deepEqual(transforms[0], [40, 20], "Sequence stays anchored to its muzzle");
      calls.length = 0;
      context.fx.draw(ctx, w, { shots: [shot] }, 1.31, { scale }, null);
      assert.equal(calls.length, 0, "Do not show a second ordinary bullet or a lingering beam");
    }
    assert.deepEqual(frames[0], frames[1]); assert.deepEqual(frames[1], frames[2]);
  }
});

test("native presentation refresh is idempotent for every imported beam", () => {
  const result = spawnSync("python", ["-c", `
import sys
sys.path.insert(0, 'tools')
from mod_source import ASSETS
from weapon_store import loads
from native_beam_projectiles import apply
count = 0
for path in (ASSETS/'units').glob('*/unit.json'):
    unit = loads(path.read_text(encoding='utf-8'))
    for weapon in unit['weapons'].values():
        if weapon.get('projectile', {}).get('sequence'):
            assert not apply(unit, weapon), unit['id']
            count += 1
assert count >= 52, count
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
