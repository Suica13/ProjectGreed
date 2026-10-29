const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules.js");
const expected = { MAN_03: 4, MAN_08: 5, MSN_02: 2, MS_06Z: 2, MSN_01: 2 };
function fixture(id = "MAN_08") {
  const m = Object.values(G.models).find((m) => m.prefabId === id);
  const g = G.create(
    false,
    1,
    [[{ unitId: id, kitId: m.kitId }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  g.environment = "space";
  const [a, b] = g.units;
  Object.assign(a, {
    x: 8,
    y: 8,
    en: 100000,
    pilot: {
      stats: {
        shooting: 100,
        melee: 100,
        defense: 100,
        speed: 100,
        accuracy: 100,
        reaction: 100,
        leadership: 100,
        awakening: 75,
      },
    },
  });
  Object.assign(b, { x: 11, y: 8, hp: 1000000, shield: 0 });
  return { g, a, b, w: m.weapons.find((w) => w.remote) };
}
test("native remote salvos keep original counts, gates and every kit; consume EN and AP once", () => {
  for (const [id, count] of Object.entries(expected)) {
    const { g, a, b, w } = fixture(id);
    assert.equal(w.remote.units.length, count);
    assert.equal(w.attack.shots.length, count * 2);
    assert.equal(w.damagePerShot, G.roundDamage(w.nativePayload.BeamDamage));
    assert.equal(w.actionCost, 3);
    assert.deepEqual(w.pilotRequirements, [{ stat: "awakening", operator: ">=", value: 75 }]);
    for (const m of Object.values(G.models).filter((m) => m.prefabId === id))
      assert.ok(m.weapons.some((x) => x.id === w.id));
    a.pilot.stats.awakening = 74;
    assert.equal(G.canAttack(g, a, b, w), false);
    assert.equal(G.canCounter(g, a, b, w), false);
    a.pilot.stats.awakening = 75;
    assert.equal(G.canAttack(g, a, b, w), true);
    assert.equal(G.canCounter(g, a, b, w), true);
    assert.deepEqual(G.attackQueue(g, a, b, [w]), { ap: 3, en: w.en });
    assert.throws(() => G.attackQueue(g, a, b, [w, w]));
    const en = a.en,
      units = g.units.length;
    const events = G.fight(g, a, b, w, "evade", null, false);
    assert.equal(a.en, en - w.en);
    assert.equal(g.units.length, units);
    assert.equal(events[0].strikes.filter((s) => s.executed !== false).length, count * 2);
    assert.equal(new Set(events[0].strikes.map((s) => s.shotIndex)).size, count * 2);
  }
});
test("wired hands lose only the broken arm volley, and both broken arms prohibit launch", () => {
  for (const id of ["MSN_02", "MSN_01", "MS_06Z"]) {
    const { g, a, b, w } = fixture(id);
    a.brokenParts = { leftArm: true };
    assert.equal(G.canUse(a, w), true);
    assert.equal(G.availableStrikes(a, w).length, 2);
    const events = G.fight(g, a, b, w, "evade", null, false);
    assert.equal(events[0].strikes.filter((s) => s.executed !== false).length, 2);
    a.brokenParts.rightArm = true;
    assert.equal(G.canUse(a, w), false);
  }
});
test("psychommu damage scales with native awakening while INCOM bypasses only this extra modifier", () => {
  const { g, a, b, w } = fixture();
  a.pilot.stats.awakening = 100;
  const base = G.estimate(g, a, b, w, "evade");
  a.pilot.stats.awakening = 150;
  const grown = G.estimate(g, a, b, w, "evade");
  const incom = { ...w, remote: { ...w.remote, kind: "incom", awakeningScale: 0 } };
  const fixed = G.estimate(g, a, b, incom, "evade");
  assert.ok(grown.damage > fixed.damage);
  assert.ok(grown.hit > fixed.hit);
  assert.ok(Math.abs(grown.damage / fixed.damage - 1.125) < 0.01);
  assert.ok(base.damage > 0);
});
function fx() {
  const context = vm.createContext({
    ART: {
      presentation: {
        animationSpeed: 2,
        meleeAnimationSpeed: 2,
        dodgeDistance: 12,
        projectileSpeed: 1,
      },
      effects: {},
      models: G.models,
    },
    SpriteRenderer: {
      images: {},
      muzzle: (_model, _weapon, source) => ({ x: source.x, y: source.y }),
    },
    WeaponSequence: require("../shared/weapon-sequence.js"),
  });
  vm.runInContext(
    fs.readFileSync("client/weapon-effects.js", "utf8") + ";globalThis.fx=WeaponEffects",
    context,
  );
  return context.fx;
}
test("remote paths are deterministic, staggered, stop to fire twice and preserve a half-second pause", () => {
  for (const id of Object.keys(expected)) {
    const { a, b, w } = fixture(id),
      api = fx();
    const source = { unit: a, x: 0, y: 0, angle: 90, scale: 1 },
      target = { unit: b, x: 300, y: 0, scale: 1 };
    const paths = api.remotePaths(w, source, target, { id: "salvo" });
    assert.equal(
      JSON.stringify(paths),
      JSON.stringify(api.remotePaths(w, source, target, { id: "salvo" })),
    );
    assert.notEqual(
      JSON.stringify(paths),
      JSON.stringify(api.remotePaths(w, source, target, { id: "another" })),
    );
    for (const [i, path] of paths.entries()) {
      assert.ok(Math.abs(path.launch - i * 0.13) < 1e-8);
      for (const shot of path.shots) {
        assert.equal(api.remoteState(path, w.remote, shot + 0.01).moving, false);
        assert.equal(api.remoteState(path, w.remote, shot + 0.49).moving, false);
      }
      const middle = api.remoteState(path, w.remote, path.launch + 0.3);
      assert.ok(Math.abs(middle.x - (path.origin.x + path.points[0].x) / 2) < 1e-8);
      assert.equal(api.remoteState(path, w.remote, path.end + 0.01), null);
      assert.ok(
        Math.hypot(
          api.remoteState(path, w.remote, path.end).x - source.x,
          api.remoteState(path, w.remote, path.end).y - source.y,
        ) < 0.001,
      );
    }
    const plan = api.plan(w, source, target);
    assert.equal(plan.shots.length, expected[id] * 2);
    assert.ok(plan.duration >= paths.at(-1).end);
    for (const shot of plan.shots) {
      const remote = plan.remotes[shot.remoteIndex];
      assert.equal(api.remoteState(remote, w.remote, shot.at).moving, false);
      assert.equal(
        JSON.stringify(shot.origin),
        JSON.stringify(remote.points[Math.floor(shot.index / paths.length)]),
      );
    }
  }
});

test("remote counterattacks use the same independent shot sequence and spend one salvo of EN", () => {
  const { g, a, b, w } = fixture("MAN_08");
  g.team = b.team;
  a.hp = 1000000;
  const gun = G.modelOf(b).weapons.find((w) => w.min <= G.dist(a, b) && w.max >= G.dist(a, b));
  const before = a.en;
  const events = G.fight(g, b, a, gun, "counter", w.id, true);
  const remote = events.find((e) => e.from === a.id && e.weapon === w.id);
  assert.ok(remote);
  assert.equal(remote.strikes.length, 10);
  assert.equal(a.en, before - w.en);
});
