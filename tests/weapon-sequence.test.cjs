const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog(),
  WeaponSequence = require("../shared/weapon-sequence.js");
const context = { ART, WeaponSequence };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("client/renderer.js", "utf8") +
    "\n" +
    fs.readFileSync("client/sprite-effects.js", "utf8") +
    "\n" +
    fs.readFileSync("client/weapon-effects.js", "utf8") +
    "\nglobalThis.renderer=SpriteRenderer;globalThis.effects=WeaponEffects;",
  context,
);
const { renderer, effects } = context,
  model = "RGM_79__machine_gun";
const weapon = (id) =>
  ART.models[model].weapons.find((w) => w.id === id) ||
  Object.values(ART.models)
    .flatMap((m) => m.weapons)
    .find((w) => w.id === id);
function near(a, b) {
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
}
test("MOD Steps preserve 9-round MG, 16-round alternating vulcan, one-shot weapons and saber double hit", () => {
  assert.deepEqual(weapon("EF_90mmMG").attack.shots, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1]);
  assert.equal(weapon("EF_90mmMG").damagePerShot, 725);
  assert.equal(weapon("EF_90mmMG").damage, 9 * 725);
  assert.equal(weapon("Common_DoubleVulcan_MS").shotCount, 16);
  assert.equal(weapon("Common_DoubleVulcan_MS").attack.shots.at(-1), 1.5);
  assert.deepEqual(weapon("EF_BeamSprayGun").attack.shots, [0.25, 0.65, 1.05]);
  near(weapon("EF_BeamSprayGun").damage, 5000);
  near(weapon("EF_BeamSprayGun").damagePerShot, 5000 / 3);
  assert.deepEqual(weapon("EF_HypeBazooka").attack.shots, [0.35, 0.35]);
  assert.equal(weapon("EF_HypeBazooka").damage, 7200);
  assert.equal(weapon("EF_BeamSaber_A").shotCount, 2);
  assert.equal(weapon("EF_BeamSaber_A").hitsPerShot, 1);
  assert.equal(WeaponSequence.pose(weapon("EF_BeamSaber_A"), 1.3).clip, "Common_Melee_F");
  assert.equal(WeaponSequence.pose(weapon("EF_90mmMG"), 0.29).clip, null);
  assert.equal(WeaponSequence.pose(weapon("EF_90mmMG"), 0.3).clip, "Common_Shoot_A");
  assert.equal(WeaponSequence.pose(weapon("EF_90mmMG"), 0.4).clip, "Common_Shoot_A_FA");
  near(WeaponSequence.pose(weapon("EF_90mmMG"), 0.45).time, 0.05);
  assert.throws(() =>
    WeaponSequence.compile({
      ...weapon("EF_90mmMG"),
      attack: { steps: [{ delay: -1, shots: 1 }] },
    }),
  );
  assert.doesNotMatch(
    JSON.stringify(ART.prefabs),
    /memory\.|self\.|equipmentIndex|basePositionFromLegEnd/,
  );
});
test("layer visibility uses named kit and held weapon; no primary from another kit is visible", () => {
  for (const [id, primary, layer] of [
    ["beam_spray", "EF_BeamSprayGun", "EF_BeamSprayGun"],
    ["machine_gun", "EF_90mmMG", "EF_90mmMG"],
    ["bazooka", "EF_HypeBazooka", "EF_HypeBazooka"],
  ]) {
    const model = "RGM_79__" + id;
    const held = renderer.visibleLayers(model, primary).map((l) => l.name);
    assert.ok(held.includes(layer));
    assert.ok(!held.includes(layer + "_NotUsing"));
    assert.ok(!held.includes("EF_BeamSaber_A"));
    const saber = renderer.visibleLayers(model, "EF_BeamSaber_A").map((l) => l.name);
    assert.ok(saber.includes(layer + "_NotUsing"));
    assert.ok(saber.includes("EF_BeamSaber_A"));
    assert.ok(!saber.includes(layer));
    const unrelated = ["EF_BeamSprayGun", "EF_90mmMG", "EF_HypeBazooka"].filter(
      (name) => name !== layer,
    );
    assert.ok(held.every((name) => !unrelated.includes(name)));
  }
});

test("vulcan is animation-free and does not change the held weapon in authoritative combat", () => {
  const G = require("../shared/rules.js"),
    entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[entry], [entry]]),
    [a, b] = g.units;
  a.x = 2;
  a.y = 3;
  b.x = 4;
  b.y = 3;
  const w = G.models[a.model].weapons.find((w) => w.id === "Common_DoubleVulcan_MS");
  for (const time of [0, 0.3, 1.5]) {
    assert.equal(WeaponSequence.pose(w, time).clip, null);
    assert.equal(WeaponSequence.pose(w, time).time, 0);
  }
  const held = a.heldWeapon,
    events = G.fight(g, a, b, w, "defend");
  assert.equal(a.heldWeapon, held);
  assert.equal(events[0].heldWeapon, held);
  assert.equal(a.en, 94);
});
test("muzzle matches original barrelX/Y and follows the weapon animation, both facings and unequal scales", () => {
  for (const id of ["EF_BeamSprayGun", "EF_90mmMG", "EF_HypeBazooka"]) {
    const w = weapon(id),
      m = Object.keys(ART.models).find((key) => ART.models[key].weapons.some((v) => v.id === id));
    for (const angle of [90, -90])
      for (const scale of [0.4, 2]) {
        const actor = { x: 100, y: 80, angle, scale };
        const first = renderer.muzzle(m, w, actor, "neutral", 0, 0),
          second = renderer.muzzle(m, w, actor, "neutral", 0, 1),
          point = w.muzzle.pairSpacing
            ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
            : first;
        const sign = angle === 90 ? 1 : -1;
        near(point.x, 100 + sign * w.source.barrelY * scale);
        near(point.y, 80 + sign * w.source.barrelX * scale);
      }
  }
  const actor = { x: 0, y: 0, angle: 90, scale: 1 };
  const point = renderer.muzzle(model, weapon("EF_90mmMG"), actor, "Common_Shoot_A", 0);
  near(point.x, 26);
  near(point.y, 7.5);
  const a = renderer.muzzle(model, weapon("Common_DoubleVulcan_MS"), actor, "neutral", 0, 0),
    b = renderer.muzzle(model, weapon("Common_DoubleVulcan_MS"), actor, "neutral", 0, 1);
  near(a.x, b.x);
  near(a.y - b.y, 6);
});
test("each Step creates one texture projectile and HP presentation reaches only the authoritative result", () => {
  const source = { unit: { id: "a", model }, x: 100, y: 80, angle: 90, scale: 2 },
    target = { unit: { id: "b", model }, x: 800, y: 120, angle: -90, scale: 0.6 };
  const w = weapon("EF_90mmMG"),
    event = { hit: true, damage: 6525 },
    plan = effects.plan(w, source, target, event);
  assert.equal(plan.shots.length, 9);
  assert.equal(plan.impacts.length, 9);
  assert.equal(effects.health(event, plan, 0, 21000), 21000);
  assert.equal(effects.health(event, plan, plan.impacts[0] + 0.001, 21000), 21000 - 725);
  assert.equal(effects.health(event, plan, plan.duration, 21000), 21000 - 6525);
  assert.equal(
    effects.health(
      { ...event, hit: false },
      effects.plan(w, source, target, { ...event, hit: false }),
      plan.duration,
      21000,
    ),
    21000,
  );
  assert.ok(ART.assets[w.projectile.asset].startsWith("data:image/png;base64,"));
  assert.equal(plan.shots[0].origin.x, 152);
  assert.equal(plan.shots[0].origin.y, 95);
});
