const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog(),
  WeaponSequence = require("../shared/weapon-sequence.js");
function runtime() {
  const draws = [],
    context = {
      ART,
      WeaponSequence,
      SpriteEffects: { sound: () => null, draw: (...args) => draws.push(args) },
    };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/renderer.js", "utf8") +
      "\n" +
      fs.readFileSync("client/weapon-effects.js", "utf8") +
      "\nglobalThis.fx=WeaponEffects;globalThis.renderer=SpriteRenderer;",
    context,
  );
  return { ...context, draws };
}
function fixture(model, id) {
  const r = runtime(),
    w = ART.models[model].weapons.find((w) => w.id === id),
    source = { unit: { id: "a", model }, x: 100, y: 200, angle: 90, scale: 2 },
    target = { unit: { id: "b", model }, x: 600, y: 240, angle: -90, scale: 2 },
    event = { hit: false, sourceDodgeSlot: 1 };
  return { ...r, w, source, target, event, plan: r.fx.plan(w, source, target, event) };
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}
test("every ranged weapon resolves native muzzle sprites for each selected barrel; melee retains its swing effects", () => {
  for (const p of ART.prefabs)
    for (const [id, w] of Object.entries(p.weapons)) {
      if (w.type === "melee") {
        assert.equal(w.muzzleEffects, undefined);
        continue;
      }
      assert.ok(w.muzzleEffects.length > 0, p.id + ":" + id);
      for (const effect of w.muzzleEffects) {
        const e = ART.effects[effect];
        assert.match(ART.assets[e.asset], /^data:image\/png;base64,/);
        assert.ok(e.duration > 0);
        assert.deepEqual(e.sounds, []);
      }
      const compiled = WeaponSequence.compile(w);
      for (const index of compiled.attack.muzzleIndices) assert.ok(w.muzzleEffects[index]);
    }
  assert.equal(ART.effects.MG_Fire_1.frames, 2);
  assert.equal(ART.effects.BZ_Fire_1.frames, 5);
  assert.equal(ART.effects.Beam_Fire_1_Pink_S.frames, 5);
});
test("attached flash follows animated muzzle, dodge offset, facing and the actual map pose without moving bullets", () => {
  for (const angle of [90, -90, 0, 180]) {
    const f = fixture("RGM_79__machine_gun", "EF_90mmMG");
    f.source.angle = angle;
    f.plan = f.fx.plan(f.w, f.source, f.target, f.event);
    const original = JSON.stringify(f.plan.shots),
      t = f.plan.shots[0].at + 0.01;
    const pose = f.fx.firingPose(f.w, f.source, f.event, t * f.plan.actionSpeed);
    f.fx.drawMuzzle({}, f.w, f.plan, t, f.source, f.event);
    let origin = f.renderer.muzzle(
      f.source.unit.model,
      f.w,
      { ...f.source, ...pose },
      pose.clip,
      pose.time,
      0,
    );
    near(f.draws[0][2], origin.x);
    near(f.draws[0][3], origin.y);
    near(f.draws[0][6], ((angle - 90) * Math.PI) / 180);
    f.draws.length = 0;
    pose.x += 40;
    pose.y -= 30;
    f.fx.drawMuzzle({}, f.w, f.plan, t, f.source, f.event, pose);
    origin = f.renderer.muzzle(
      f.source.unit.model,
      f.w,
      { ...f.source, ...pose },
      pose.clip,
      pose.time,
      0,
    );
    near(f.draws[0][2], origin.x);
    near(f.draws[0][3], origin.y);
    assert.equal(JSON.stringify(f.plan.shots), original);
  }
});
test("alternating head vulcan uses both muzzles and simultaneous scatter pellets emit one flash", () => {
  const f = fixture("RGM_79__machine_gun", "Common_DoubleVulcan_MS");
  const origins = [];
  for (const index of [0, 1]) {
    const plan = { ...f.plan, shots: [f.plan.shots[index]] };
    f.draws.length = 0;
    f.fx.drawMuzzle({}, f.w, plan, plan.shots[0].at + 0.001, f.source, f.event);
    assert.equal(f.draws.length, 1);
    origins.push(f.draws[0][3]);
  }
  assert.notEqual(origins[0], origins[1]);
  const scatter = fixture("MS_09__bazooka", "ZN_MS_09_ChestBeam");
  assert.equal(scatter.plan.shots.length, 8);
  scatter.fx.drawMuzzle(
    {},
    scatter.w,
    scatter.plan,
    scatter.plan.shots[0].at + 0.01,
    scatter.source,
    scatter.event,
  );
  assert.equal(scatter.draws.length, 1);
});
test("detached bazooka flashes stay at the original muzzle and finish before the timeline ends", () => {
  const f = fixture("RGM_79__bazooka", "EF_HypeBazooka"),
    shot = f.plan.shots[0];
  f.fx.drawMuzzle({}, f.w, f.plan, shot.at - 0.001, f.source, f.event);
  assert.equal(f.draws.length, 0);
  f.fx.drawMuzzle({}, f.w, { ...f.plan, shots: [shot] }, shot.at + 0.1, f.source, f.event, {
    x: 999,
    y: 999,
  });
  near(f.draws[0][2], shot.origin.x);
  near(f.draws[0][3], shot.origin.y);
  const last = f.plan.shots.at(-1),
    duration = ART.effects[f.w.muzzleEffects[0]].duration / ART.presentation.animationSpeed;
  assert.ok(f.plan.duration > last.at + duration);
  f.draws.length = 0;
  f.fx.drawMuzzle({}, f.w, f.plan, last.at + duration + 0.01, f.source, f.event);
  assert.equal(f.draws.length, 0);
});
