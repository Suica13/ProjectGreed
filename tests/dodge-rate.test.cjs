const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog();
const context = vm.createContext({ ART, WeaponSequence: require("../shared/weapon-sequence.js") });
vm.runInContext(
  ["client/renderer.js", "client/sprite-effects.js", "client/weapon-effects.js"]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n") + "\nglobalThis.effects = WeaponEffects;",
  context,
);
const model = "RGM_79__machine_gun";
const source = { unit: { id: "a", model }, x: 100, y: 100, angle: 90, scale: 1 };
const target = { unit: { id: "b", model }, x: 600, y: 100, angle: -90, scale: 1 };
const vulcan = ART.models[model].weapons.find((weapon) => weapon.id === "Common_DoubleVulcan_MS");
function assertSpaced(times) {
  const sorted = [...times].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 1);
}

test("rapid missed volleys dodge at most once per second while every projectile keeps flying", () => {
  const plan = context.effects.plan(vulcan, source, target, { hit: false });
  assert.ok(plan.moves.length >= 2);
  assert.ok(plan.moves.length < plan.contacts.length);
  assertSpaced(plan.moves.map((move) => move.at));
  assert.equal(plan.shots.length, vulcan.attack.shots.length);
  assert.ok(plan.shots.every((shot) => shot.miss && shot.visibleUntil > shot.impactAt));
  assert.equal(plan.contacts.length, vulcan.attack.strikes.length);
});

test("overlapping attacks against one target share dodge cooldown; other targets remain independent", () => {
  const starts = [];
  const first = context.effects.plan(vulcan, source, target, { hit: false }, { start: 0, starts });
  const second = context.effects.plan(
    vulcan,
    source,
    target,
    { hit: false },
    { start: 0.1, starts },
  );
  assertSpaced(starts);
  assert.ok(second.moves.length < first.moves.length);
  const other = context.effects.plan(
    vulcan,
    source,
    target,
    { hit: false },
    { start: 0, starts: [] },
  );
  assert.equal(other.moves.length, first.moves.length);
});

test("simultaneous shotgun misses trigger one dodge and retain all eight pellets", () => {
  const shotgun = Object.values(ART.models)
    .flatMap((model) => model.weapons)
    .find((weapon) => weapon.projectile?.spreadDegrees > 0 && weapon.attack.shots.length === 8);
  assert.ok(shotgun);
  const plan = context.effects.plan(shotgun, source, target, { hit: false });
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.shots.length, 8);
});
