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
        for (const shot of plan.shots) {
          if (w.projectile?.motion === "bomb") assert.equal(shot.destination.x, shot.origin.x);
          else assert.equal(shot.destination.x, target.x);
        }
        assert.equal(r.fx.dodge(event, plan, plan.impacts[0], a, target).active, true);
        if (!["bomb", "mortar"].includes(w.projectile?.motion))
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
  assert.equal(plan.deathElectricEffect, "Stun_1");
  assert.ok(ART.effects[plan.deathElectricEffect].duration < plan.deathAt - plan.deathSoundAt);
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
    saber = ART.models.RGM_79L__beam_gun.weapons[1],
    plan = r.fx.plan(saber, source, target, { hit: true, damage: 1 });
  assert.equal(plan.actionSpeed, 1);
  assert.equal(plan.shots[0].at - plan.lead, 0.4);
  assert.ok(Math.abs(plan.shots[1].at - plan.lead - 1.3) < 1e-10);
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
  assert.ok(r.frames.includes(ART.presentation.deathElectricEffect));
  assert.ok(r.frames.every((id) => [ART.presentation.deathElectricEffect, "Explosion_Ground_1"].includes(id)));
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

test("map death sprite exists during electric delay and disappears on the first explosion frame", () => {
  const r = runtime(),
    draws = [];
  r.context.recordSprite = () => draws.push("sprite");
  vm.runInContext("SpriteRenderer.draw=recordSprite", r.context);
  r.sprites.draw = () => true;
  r.map.capture({
    networkId: "hide-at-explosion",
    events: [{ hit: true, before: 1, after: 0, to: "1-0" }],
  });
  r.map.draw({}, 0, () => ({ x: 100, y: 100 }), 64);
  assert.equal(draws.length, 1);
  const explosionAt = ART.presentation.deathDelay * 1000;
  r.map.draw({}, explosionAt - 0.01, () => ({ x: 100, y: 100 }), 64);
  assert.equal(draws.length, 2);
  r.map.draw({}, explosionAt, () => ({ x: 100, y: 100 }), 64);
  assert.equal(draws.length, 2);
  r.map.draw({}, explosionAt + 100, () => ({ x: 100, y: 100 }), 64);
  assert.equal(draws.length, 2);
  assert.equal(r.map.pending(), true);
});

test("Dom shotgun has eight simultaneous independent pellets, short range and a fixed fan in both facings", () => {
  const r = runtime(),
    model = "MS_09__bazooka",
    w = ART.models[model].weapons.find((w) => w.id === "ZN_MS_09_ChestBeam");
  assert.equal(ART.models[model].hp, 25000);
  assert.equal(ART.models.RGM_79_G__machine_gun.hp, 25000);
  assert.equal(w.hit, 95);
  assert.equal(w.min, 1);
  assert.equal(w.max, 1);
  assert.equal(w.damagePerShot, 400);
  assert.equal(w.shotCount, 8);
  assert.equal(w.damage, 3200);
  for (const reverse of [false, true]) {
    const a = {
        ...source,
        x: reverse ? 600 : 100,
        angle: reverse ? -90 : 90,
        unit: { id: "0-0", model },
      },
      b = { ...target, x: reverse ? 100 : 600 };
    const plan = r.fx.plan(w, a, b, { hit: true, damage: 1 }),
      miss = r.fx.plan(w, a, b, { hit: false });
    assert.equal(plan.shots.length, 8);
    assert.equal(new Set(plan.shots.map((s) => s.at)).size, 1);
    assert.equal(new Set(plan.shots.map((s) => s.destination.y)).size, 8);
    assert.ok(
      plan.shots.some((s) => s.destination.y > b.y) &&
        plan.shots.some((s) => s.destination.y < b.y),
    );
    assert.equal(
      JSON.stringify(plan.shots.map((s) => s.spreadY)),
      JSON.stringify(miss.shots.map((s) => s.spreadY)),
    );
  }
});

test("melee approaches across the divider before swinging, stays close for both strikes and returns home", () => {
  const r = runtime(),
    saber = ART.models.RGM_79L__beam_gun.weapons[1];
  for (const reverse of [false, true]) {
    const a = { ...source, x: reverse ? 750 : 250, arenaWidth: 1000 },
      b = { ...target, x: reverse ? 250 : 750 };
    const plan = r.fx.plan(saber, a, b, { hit: false });
    const start = r.fx.meleeMotion(plan, a, b, 0),
      first = r.fx.meleeMotion(plan, a, b, plan.shots[0].at),
      second = r.fx.meleeMotion(plan, a, b, plan.shots[1].at),
      end = r.fx.meleeMotion(plan, a, b, plan.duration);
    assert.ok(Math.abs(start.x) < 1e-10);
    assert.ok(Math.abs(end.x) < 1e-10);
    assert.ok(Math.abs(end.y) < 1e-10);
    assert.ok(reverse ? a.x + first.x < 500 : a.x + first.x > 500);
    assert.equal(first.x, second.x);
    assert.ok(plan.melee.retreatAt > plan.shots[1].at);
    assert.ok(plan.duration >= plan.melee.retreatAt + plan.melee.retreat);
    assert.equal(plan.actionSpeed, 1);
    assert.equal(saber.swingEffects.length, 2);
    for (const effect of saber.swingEffects) {
      assert.equal(ART.effects[effect].frames, 9);
      assert.ok(ART.assets[ART.effects[effect].asset]);
    }
  }
  for (const model of Object.values(ART.models))
    for (const weapon of model.weapons.filter(
      (w) => w.type === "melee" && w.id !== "Common_Cqb_A" && w.projectile?.motion !== "tether",
    ))
      assert.ok(weapon.swingEffects?.length);
});

test("Dom shotgun resolves eight independent hit rolls and spends EN once at adjacent range", () => {
  const G = require("../shared/rules.js"),
    g = G.create(false, 1, [
      [{ unitId: "MS_09", kitId: "bazooka" }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]),
    [a, b] = g.units;
  Object.assign(a, { x: 2, y: 4 });
  Object.assign(b, { x: 3, y: 4, hp: 100000, shield: 0 });
  g.tiles[4][2] = g.tiles[4][3] = g.tiles[4][4] = "plain";
  const w = G.modelOf(a).weapons.find((w) => w.id === "ZN_MS_09_ChestBeam");
  assert.equal(G.estimate(g, a, b, w).hit, 78.18749999999999);
  g.seed = 3; // This seed produces both hits and misses at the native accuracy.
  assert.equal(G.canAttack(g, a, { ...b, x: 4 }, w), false);
  const event = G.fight(g, a, b, w, "defend")[0];
  assert.equal(event.strikes.length, 8);
  assert.equal(event.shotCount, 8);
  assert.equal(a.en, ART.models[a.model].en - w.en);
  assert.ok(event.hitCount > 0 && event.hitCount < 8);
  assert.equal(event.damagePerShot, 400);
});

test("native low HP electricity loops five frames below 25 percent and stops at death or recovery", () => {
  const r = runtime(),
    e = ART.effects.Stun_1,
    frames = [];
  r.context.image = { width: 425, height: 85 };
  vm.runInContext("SpriteRenderer.images[ART.effects.Stun_1.asset]=image", r.context);
  const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      drawImage(...args) {
        frames.push(args[1]);
      },
    },
    u = { model: "RGM_79__machine_gun", hp: 1000 };
  const before = JSON.stringify(u);
  for (const t of [0, 0.21, 0.81, 1, 1.21])
    assert.equal(r.sprites.lowHp(ctx, u, 10, 20, 1, t), true);
  assert.deepEqual(frames, [0, 85, 85, 170, 340]);
  assert.equal(e.frames, 5);
  assert.equal(e.alpha, 0.85);
  assert.equal(e.fps, 7.5);
  assert.equal(e.duration, 2 / 3);
  for (const hp of [0, -1, 5250, 21000])
    assert.equal(r.sprites.lowHp(ctx, u, 10, 20, 1, 0, hp), false);
  assert.equal(r.sprites.lowHp(ctx, u, 10, 20, 1, 0, 5249), true);
  assert.equal(r.sprites.lowHp(ctx, { ...u, performance: 0.75 }, 10, 20, 1, 0, 4000), false);
  assert.equal(r.sprites.lowHp(ctx, { ...u, performance: 1.25 }, 10, 20, 1, 0, 4500), true);
  assert.equal(JSON.stringify(u), before);
  assert.equal(r.sounds.length, 0);
});

test("miss lifetimes stop at the first arena edge or two seconds for native projectiles", () => {
  const r = runtime();
  for (const [modelId, model] of Object.entries(ART.models))
    for (const w of model.weapons.filter((w) => w.projectile))
      for (const [dx, dy] of [
        [0, 128],
        [0, -128],
        [128, 0],
        [-128, 0],
        [128, 128],
        [-128, -128],
        [0, 512],
      ]) {
        const a = {
            unit: { id: "a", model: modelId },
            x: 800,
            y: 800,
            scale: (1.2 / ART.presentation.mapCellScale) * model.presentation.mapScale,
            angle: (Math.atan2(dx, -dy) * 180) / Math.PI,
            arenaWidth: 2048,
            arenaHeight: 2304,
          },
          b = {
            ...a,
            unit: { id: "b", model: modelId },
            x: 800 + dx,
            y: 800 + dy,
            angle: a.angle + 180,
          };
        const plan = r.fx.plan(w, a, b, { from: "a", to: "b", weapon: w.id, hit: false });
        assert.ok(Number.isFinite(plan.duration), modelId + "/" + w.id);
        for (const shot of plan.shots) {
          if (w.projectile.motion === "tether") {
            assert.equal(
              shot.visibleUntil,
              shot.impactAt +
                (w.projectile.tether.hold + w.projectile.tether.retract) / plan.actionSpeed,
            );
            continue;
          }
          if (["bomb", "mortar"].includes(w.projectile.motion)) {
            assert.equal(shot.visibleUntil, shot.impactAt);
            continue;
          }
          const margin = 64 * a.scale * w.projectile.scale + 16,
            progress = (shot.visibleUntil - shot.at) / shot.flight,
            x = shot.origin.x + (shot.destination.x - shot.origin.x) * progress,
            y = shot.origin.y + (shot.destination.y - shot.origin.y) * progress;
          assert.ok(
            x >= -margin - 1e-6 && x <= a.arenaWidth + margin + 1e-6,
            "exit remains inside horizontal bounds",
          );
          assert.ok(
            y >= -margin - 1e-6 && y <= a.arenaHeight + margin + 1e-6,
            "exit remains inside vertical bounds",
          );
          assert.ok(
            Math.min(
              Math.abs(x + margin),
              Math.abs(x - a.arenaWidth - margin),
              Math.abs(y + margin),
              Math.abs(y - a.arenaHeight - margin),
            ) < 1e-6 || Math.abs(shot.visibleUntil - shot.at - 2) < 1e-6,
            modelId + "/" + w.id + " finishes on a boundary or times out",
          );
          assert.ok(shot.visibleUntil - shot.at <= 2 + 1e-6);
          assert.ok(shot.visibleUntil >= Math.min(shot.impactAt, shot.at + 2));
        }
      }
});

test("ship death keeps its sprite through the complete multi-explosion sequence in battle and map effects", () => {
  const r = runtime();
  const ship = {
    ...target,
    unit: { ...target.unit, model: "SalamisClass__standard", environment: "space", hp: 1 },
  };
  const event = { hit: true, before: 1, after: 0, damage: 1 };
  const plan = r.fx.plan(weapon, source, ship, event);
  assert.equal(plan.deathHideAt, plan.deathEnd);
  assert.ok(plan.deathHideAt > plan.deathAt);
  assert.equal(
    r.fx.plan(weapon, source, target, event).deathHideAt,
    r.fx.plan(weapon, source, target, event).deathAt,
  );
  Object.assign(r.unit, ship.unit);
  const draws = [];
  r.context.recordSprite = () => draws.push("ship");
  vm.runInContext("SpriteRenderer.draw=recordSprite", r.context);
  r.sprites.draw = () => true;
  r.map.capture({ networkId: "ship-multi-explosion", events: [{ ...event, to: r.unit.id }] });
  const sequence = r.fx.deathSequence(r.unit),
    speed = ART.presentation.animationSpeed,
    delay = ART.presentation.deathDelay;
  r.map.draw({}, 0, () => ({ x: 100, y: 100 }), 64);
  assert.equal(draws.length, 1);
  for (const age of [0.01, sequence.events.at(-1).at, sequence.duration - 0.01]) {
    const before = draws.length;
    r.map.draw({}, (delay + age / speed) * 1000, () => ({ x: 100, y: 100 }), 64);
    assert.equal(draws.length, before + 1);
  }
  const before = draws.length;
  r.map.draw(
    {},
    (delay + (sequence.duration + 0.01) / speed) * 1000,
    () => ({ x: 100, y: 100 }),
    64,
  );
  assert.equal(draws.length, before);
  assert.equal(r.map.pending(), false);
});

test("mortar shells take twice as long and rotate along the arc in both directions", () => {
  const r = runtime();
  const [modelId, m] = Object.entries(ART.models).find(([, m]) =>
    m.weapons.some((w) => w.projectile?.motion === "mortar"),
  );
  const w = m.weapons.find((w) => w.projectile?.motion === "mortar");
  // Access the same private renderer instance used by WeaponEffects.
  vm.runInContext(
    "SpriteRenderer.images[" + JSON.stringify(w.projectile.asset) + "] = {width:8,height:16};",
    r.context,
  );
  for (const direction of [1, -1]) {
    const a = {
        ...source,
        unit: { ...source.unit, model: modelId },
        x: direction === 1 ? 100 : 600,
      },
      b = { ...target, x: direction === 1 ? 600 : 100 },
      event = { hit: true },
      plan = r.fx.plan(w, a, b, event),
      shot = plan.shots[0],
      dx = shot.destination.x - shot.origin.x,
      dy = shot.destination.y - shot.origin.y,
      previousFlight = Math.max(0.18, Math.min(0.45, Math.hypot(dx, dy) / 1800));
    assert.ok(Math.abs(shot.flight - previousFlight * 2) < 1e-9);
    const angles = [];
    for (const travel of [0.2, 0.5, 0.8]) {
      let angle, position;
      const ctx = {
        save() {},
        restore() {},
        translate(x, y) {
          position = { x, y };
        },
        rotate(value) {
          angle = value;
        },
        scale() {},
        drawImage() {},
      };
      // Isolate one shell so later firing steps do not overwrite the capture.
      r.fx.draw(ctx, w, { ...plan, shots: [shot] }, shot.at + shot.flight * travel, a, event);
      const tangent = Math.atan2(dy - Math.PI * 80 * a.scale * Math.cos(Math.PI * travel), dx);
      assert.ok(
        Math.abs(angle - tangent - Math.PI / 2 - ((w.projectile.rotation || 0) * Math.PI) / 180) <
          1e-9,
      );
      assert.ok(
        Math.abs(
          position.y - (shot.origin.y + dy * travel - Math.sin(Math.PI * travel) * 80 * a.scale),
        ) < 1e-9,
      );
      angles.push(angle);
    }
    assert.ok(Math.abs(angles[0] - angles[2]) > 0.1);
    assert.ok(plan.duration >= shot.impactAt);
  }
});

test("native heat rods and Ball K anchors extend, hold and retract from the animated hand even on Miss", () => {
  const r = runtime();
  for (const id of ["MS_07B", "MS_07B3", "RB_79K"]) {
    const model = Object.values(ART.models).find((m) => m.prefabId === id);
    const weapon = model.weapons.find((w) => w.projectile?.motion === "tether");
    assert.ok(weapon, id);
    assert.equal(weapon.type, "melee");
    assert.equal(weapon.min, 1);
    assert.equal(weapon.max, 2);
    assert.equal(weapon.swingEffects, undefined);
    assert.ok(ART.assets[weapon.projectile.asset]);
    const a = { ...source, unit: { ...source.unit, model: model.prefabId + "__" + model.kitId } },
      event = { hit: false, sourceDodgeSlot: 1 };
    const plan = r.fx.plan(weapon, a, target, event),
      shot = plan.shots[0];
    if (id === "RB_79K") {
      assert.equal(weapon.projectile.tether.mount.bone, "Body");
      assert.equal(weapon.projectile.tether.mount.offset.x, weapon.muzzle.offset.x);
      assert.equal(weapon.projectile.tether.mount.offset.y, weapon.muzzle.offset.y);
      const start = r.fx.tetherState(weapon, plan, shot, shot.at, a, event);
      assert.ok(Math.hypot(start.anchor.x - shot.origin.x, start.anchor.y - shot.origin.y) < 1e-9);
    }
    assert.equal(plan.melee, null);
    assert.ok(plan.duration < 3, "a missed tether must not fly to the edge of a large map");
    const extended = r.fx.tetherState(weapon, plan, shot, shot.at + shot.flight / 2, a, event);
    const held = r.fx.tetherState(weapon, plan, shot, shot.impactAt + 0.01, a, event);
    const returned = r.fx.tetherState(weapon, plan, shot, shot.visibleUntil - 0.001, a, event);
    assert.equal(extended.stage, "extend");
    assert.equal(held.stage, "contact");
    assert.equal(returned.stage, "retract");
    assert.ok(
      Math.hypot(returned.head.x - returned.anchor.x, returned.head.y - returned.anchor.y) < 2,
    );
    assert.equal(r.fx.tetherState(weapon, plan, shot, shot.visibleUntil + 0.01, a, event), null);
    const neutral = r.fx.plan(weapon, a, target, { hit: false, sourceDodgeSlot: 0 });
    const neutralState = r.fx.tetherState(
      weapon,
      neutral,
      neutral.shots[0],
      neutral.shots[0].impactAt + 0.01,
      a,
      { hit: false, sourceDodgeSlot: 0 },
    );
    assert.ok(
      Math.abs(held.anchor.y - neutralState.anchor.y - ART.presentation.dodgeDistance * a.scale) <
        1e-9,
    );
  }
});

test("slow missed volleys finish within two seconds of the last shot without shortening hit playback", () => {
  const r = runtime();
  const slow = { ...weapon, projectile: { ...weapon.projectile, speed: 0.01 } };
  const a = { ...source, arenaWidth: 100000, arenaHeight: 100000 };
  const miss = r.fx.plan(slow, a, target, { hit: false });
  for (const shot of miss.shots) {
    assert.ok(shot.flight > 2);
    assert.equal(shot.visibleUntil, shot.at + 2);
  }
  assert.ok(miss.contacts.every((contact) => contact.at <= miss.shots[contact.shotIndex].at + 2));
  assert.equal(miss.duration, miss.shots.at(-1).at + 2);
  assert.equal(miss.shots.length, weapon.attack.shots.length);
  const hit = r.fx.plan(slow, a, target, { hit: true, damage: 1 });
  assert.ok(hit.duration > miss.duration);
  for (const shot of hit.shots) assert.equal(shot.visibleUntil, shot.impactAt);
});

test("death electricity loops continuously until the first explosion frame", () => {
  const r = runtime(), calls = [];
  const effect = ART.effects[ART.presentation.deathElectricEffect];
  const wait = ART.presentation.deathDelay;
  r.sprites.draw = (...args) => { calls.push(args); return true; };
  assert.equal(r.sprites.deathElectric({}, 10, 20, 1, -0.01, wait), false);
  for (const time of [0, effect.duration, effect.duration * 2, wait - 0.0001]) {
    assert.ok(time < wait);
    assert.equal(r.sprites.deathElectric({}, 10, 20, 1, time, wait), true);
    const call = calls.at(-1);
    assert.equal(call[1], ART.presentation.deathElectricEffect);
    assert.ok(call[5] >= 0 && call[5] < effect.duration);
  }
  const count = calls.length;
  assert.equal(r.sprites.deathElectric({}, 10, 20, 1, wait, wait), false);
  assert.equal(r.sprites.deathElectric({}, 10, 20, 1, wait + 1, wait), false);
  assert.equal(calls.length, count);
});

test("queued map deaths keep electricity active throughout the wait and stop at explosion onset", () => {
  const r = runtime(), calls = [];
  vm.runInContext("SpriteRenderer.draw=()=>{}", r.context);
  r.sprites.draw = (...args) => { calls.push(args); return true; };
  r.map.capture({ networkId: "loop-until-explosion", events: [{ hit: true, before: 1, after: 0, to: "1-0" }] });
  const waitMs = ART.presentation.deathDelay * 1000;
  for (const time of [0, 500, 1000, waitMs - 0.01]) {
    const before = calls.length;
    r.map.draw({}, time, () => ({ x: 100, y: 100 }), 64);
    assert.ok(calls.slice(before).some((call) => call[1] === ART.presentation.deathElectricEffect));
  }
  calls.length = 0;
  r.map.draw({}, waitMs, () => ({ x: 100, y: 100 }), 64);
  assert.ok(!calls.some((call) => call[1] === ART.presentation.deathElectricEffect));
  assert.ok(calls.some((call) => call[1] === "Explosion_Ground_1"));
});
