const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog(),
  WeaponSequence = require("../shared/weapon-sequence.js");
function runtime() {
  const unit = { id: "1-0", model: "RGM_79__beam_spray", x: 9, y: 4, hp: 0 };
  const sounds = [],
    frames = [];
  const context = {
    ART,
    WeaponSequence,
    UnitModels: ART.models,
    getUnit: () => unit,
    pageView: "game",
    byId: () => ({ hidden: true }),
    WeaponAudio: { play: (s) => sounds.push(s) },
    BattleScene: { settings: () => ({ mapScale: 1 }) },
  };
  vm.createContext(context);
  vm.runInContext(
    ["client/renderer.js", "client/sprite-effects.js", "client/weapon-effects.js"]
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n") +
      "\nglobalThis.fx=WeaponEffects;globalThis.sprites=SpriteEffects;globalThis.map=MapEffects;",
    context,
  );
  return { ...context, sounds, frames, unit, context };
}
const model = "RGM_79__machine_gun",
  weapon = ART.models[model].weapons[0];
const source = { unit: { id: "0-0", model }, x: 100, y: 100, angle: 90, scale: 1 },
  target = { unit: { id: "1-0", model }, x: 600, y: 100, angle: -90, scale: 1 };
test("Miss keeps the same trajectory and triggers dodge for every defense stance", () => {
  const r = runtime();
  for (const m of Object.values(ART.models))
    for (const w of m.weapons) {
      const a = { ...source, unit: { ...source.unit, model: m.prefabId + "__" + m.kitId } };
      for (const response of ["counter", "defend", "evade"]) {
        const event = { hit: false, response },
          plan = r.fx.plan(w, a, target, event);
        for (const shot of plan.shots) assert.equal(shot.destination.x, target.x);
        assert.equal(r.fx.dodge(event, plan, plan.impacts[0], a, target).active, true);
        assert.ok(plan.cues.every((c) => c.sound === w.sound));
      }
    }
});

test("all original hit and death sprite sheets and sound variants resolve and play one frame sequence", () => {
  const r = runtime();
  for (const [id, frames] of [
    ["MG_Hit_1", 2],
    ["MG_Hit_1_S", 2],
    ["Explosion_Hit_1", 5],
    ["Beam_Hit_1_S_Pink", 6],
    ["Cqb_Hit_1", 5],
    ["Explosion_Ground_1", 10],
  ]) {
    const effect = ART.effects[id];
    assert.equal(effect.frames, frames);
    assert.ok(ART.assets[effect.asset]);
    assert.equal(r.sprites.frame(id, 0), 0);
    assert.equal(r.sprites.frame(id, effect.duration - 0.001), frames - 1);
    assert.equal(r.sprites.frame(id, effect.duration), null);
    for (const sound of effect.sounds)
      assert.equal(
        Buffer.from(ART.sounds[sound.asset].split(",")[1], "base64").subarray(0, 4).toString(),
        "OggS",
      );
  }
});
test("bullet flight is exactly twice as long, while Step and skeletal playback use 85 percent speed", () => {
  const r = runtime();
  const slow = r.fx.plan(weapon, source, target);
  assert.equal(slow.shots[0].at, 0.3 / 0.85);
  try {
    ART.presentation.projectileSpeed = 1;
    const normal = r.fx.plan(weapon, source, target);
    assert.equal(slow.shots[0].flight, normal.shots[0].flight * 2);
  } finally {
    ART.presentation.projectileSpeed = 0.5;
  }
});
test("missed bullets remain visible beyond the target and leave the arena; hit bullets stop at contact", () => {
  const r = runtime();
  vm.runInContext(
    `SpriteRenderer.images[${JSON.stringify(weapon.projectile.asset)}]={width:8,height:8}`,
    r.context,
  );
  const a = { ...source, arenaWidth: 800, arenaHeight: 400 },
    miss = r.fx.plan(weapon, a, target, { hit: false }),
    hit = r.fx.plan(weapon, a, target, { hit: true, damage: 1 });
  const xs = [],
    ctx = {
      save() {},
      restore() {},
      translate(x) {
        xs.push(x);
      },
      rotate() {},
      scale() {},
      drawImage() {},
    };
  const shot = miss.shots[0],
    past = shot.impactAt + shot.flight * 0.25;
  assert.ok(shot.visibleUntil > shot.impactAt);
  r.fx.draw(ctx, weapon, miss, past, a, { hit: false });
  assert.ok(xs.some((x) => x > target.x));
  xs.length = 0;
  r.fx.draw(ctx, weapon, hit, hit.shots[0].impactAt + 0.001, a, { hit: true });
  // Later shots may already be in flight, but the first shot has disappeared after its hit.
  assert.ok(xs.every((x) => x <= target.x));
  xs.length = 0;
  r.fx.draw(ctx, weapon, miss, miss.shots.at(-1).visibleUntil + 0.001, a, { hit: false });
  assert.equal(xs.length, 0);
});
test("hit sounds use arrival times, misses produce no hit cues, and death finishes before battle can close", () => {
  const r = runtime(),
    event = { hit: true, response: "defend", before: 6525, after: 0, damage: 6525 };
  const plan = r.fx.plan(weapon, source, target, event);
  assert.equal(plan.cues.length, 20);
  assert.equal(
    plan.cues.find((c) => c.sound === ART.presentation.deathSound).at,
    plan.deathSoundAt,
  );
  assert.ok(plan.deathAt - plan.deathSoundAt >= ART.presentation.deathSound.duration);
  assert.equal(plan.cues[9].at, plan.impacts[0]);
  assert.ok(plan.deathAt > plan.impacts.at(-1));
  assert.ok(plan.duration > plan.deathAt + ART.effects[plan.deathEffect].duration / 0.85);
  assert.equal(r.fx.plan(weapon, source, target, { ...event, hit: false }).cues.length, 9);
  assert.equal(r.fx.health(event, plan, plan.duration, 6525), 0);
});
test("dodges move from the current position between bounded lanes and retain the final lane", () => {
  const r = runtime(),
    event = {
      hit: false,
      from: "a",
      to: "b",
      weapon: weapon.id,
      targetDodgeSlot: 0,
      strikes: weapon.attack.strikes.map((step, index) => ({
        ...step,
        hit: false,
        executed: true,
        damage: 0,
        dodgeTo: [-1, 0, 1, 0, -1, 0, 1, 0, -1][index],
      })),
    },
    plan = r.fx.plan(weapon, source, target, event);
  assert.equal(r.fx.position(plan, 0), 0);
  for (let i = 0; i < plan.moves.length; i++) {
    const move = plan.moves[i];
    assert.ok(Math.abs(move.from - (i ? plan.moves[i - 1].to : 0)) < 1e-8);
    assert.equal(r.fx.dodge(event, plan, move.at, source, target).time, 0);
    assert.ok(r.fx.dodge(event, plan, move.at + 0.001, source, target).active);
    if (i > 0)
      assert.ok(
        Math.abs(r.fx.position(plan, move.at - 1e-7) - r.fx.position(plan, move.at + 1e-7)) < 1e-5,
      );
  }
  for (let t = 0; t < plan.duration; t += 0.003)
    assert.ok(Math.abs(r.fx.position(plan, t)) <= 1 + 1e-8);
  assert.equal(r.fx.position(plan, plan.duration), -1);
  const hitPlan = r.fx.plan(weapon, source, target, { hit: true, damage: 1, targetDodgeSlot: 1 });
  assert.equal(r.fx.position(hitPlan, hitPlan.duration), 1);
  assert.equal(r.fx.dodge({ hit: true }, hitPlan, 0.5, source, target).active, false);
  const counter = r.fx.plan(weapon, { ...source, unit: target.unit }, target, {
    hit: true,
    damage: 1,
    sourceDodgeSlot: -1,
  });
  const normal = r.fx.plan(weapon, { ...source, unit: target.unit }, target, {
    hit: true,
    damage: 1,
  });
  assert.equal(
    counter.shots[0].origin.y,
    normal.shots[0].origin.y - ART.presentation.dodgeDistance * source.scale,
  );
});

test("melee steps and bone sampling use normal speed while shooting keeps 85 percent speed", () => {
  const r = runtime(),
    saber = ART.models.RGM_79__machine_gun.weapons[1],
    plan = r.fx.plan(saber, source, target, { hit: true, damage: 1 });
  assert.equal(plan.actionSpeed, 1);
  assert.equal(plan.shots[0].at, 0.6);
  assert.equal(plan.shots[1].at, 1.3);
  assert.equal(r.fx.plan(weapon, source, target).actionSpeed, 0.85);
});

test("map death effects queue after battle and deduplicate each battle/unit, including repeated snapshots", () => {
  const r = runtime(),
    view = { networkId: "battle-1", events: [{ hit: true, before: 5000, after: 0, to: "1-0" }] };
  r.map.capture(view);
  r.map.capture(view);
  assert.equal(r.map.pending(), true);
  assert.equal(r.sounds.length, 0);
  let completed = 0;
  r.map.after(() => completed++);
  const draw = r.sprites.draw;
  vm.runInContext("SpriteRenderer.draw=()=>{}", r.context);
  r.sprites.draw = (...args) => {
    r.frames.push(args[1]);
    return true;
  };
  r.map.draw({}, 0, () => ({ x: 100, y: 100 }), 64);
  r.map.draw({}, 500, () => ({ x: 100, y: 100 }), 64);
  assert.equal(r.sounds.length, 1);
  assert.ok(r.frames.every((id) => id === "Explosion_Ground_1"));
  r.map.draw({}, 2000, () => ({ x: 100, y: 100 }), 64);
  assert.equal(r.sounds.length, 2);
  r.map.draw({}, 4000, () => ({ x: 100, y: 100 }), 64);
  assert.equal(r.map.pending(), false);
  assert.equal(completed, 1);
  r.map.capture({ ...view });
  assert.equal(r.map.pending(), false);
  r.map.capture({ ...view, networkId: "battle-2" });
  assert.equal(r.map.pending(), true);
  r.map.reset();
  assert.equal(r.map.pending(), false);
  r.sprites.draw = draw;
});
