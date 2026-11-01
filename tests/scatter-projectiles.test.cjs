const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules.js"),
  ART = G.catalog,
  WeaponSequence = require("../shared/weapon-sequence.js");
const clusterModel = Object.values(G.models).find(
  (m) => m.prefabId === "RMS_099" && m.weapons.some((w) => w.projectile?.cluster),
);
const rocket = clusterModel.weapons.find((w) => w.projectile?.cluster);
function runtime() {
  const ctx = {
    ART,
    WeaponSequence,
    SpriteRenderer: { muzzle: () => ({ x: 100, y: 100 }), images: {} },
    SpriteEffects: { sound: () => null },
    game: { tiles: [] },
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync("client/weapon-effects.js", "utf8") + ";globalThis.fx=WeaponEffects",
    ctx,
  );
  return ctx.fx;
}
function source(model = clusterModel) {
  return {
    unit: { id: "a", model: model.prefabId + "__" + model.kitId },
    x: 100,
    y: 100,
    angle: 90,
    scale: 1,
  };
}
const target = { unit: { id: "b", model: "RGM_79__machine_gun" }, x: 600, y: 100, scale: 1 };
test("cluster bazookas retain one carrier and twelve native independently adjudicated fragments", () => {
  for (const m of Object.values(G.models))
    for (const w of m.weapons)
      if (w.projectile?.cluster) assert(w.name.includes("扩散火箭筒"), w.id);
  assert.equal(rocket.shotCount, 13);
  assert.equal(rocket.attack.strikes.filter((s) => s.clusterRole === "carrier").length, 1);
  const fragments = rocket.attack.strikes.filter((s) => s.clusterRole === "fragment");
  assert.equal(fragments.length, 12);
  assert(fragments.every((s) => s.accuracy === 95));
  assert(fragments.every((s) => s.partBreakModifier === 1.5 && s.targetModifiers.air === 1.25));
  assert.equal(rocket.nativeTiming.projectiles, 1);
  assert.equal(rocket.nativeTiming.secondaryProjectiles, 12);
  const entry = { unitId: "RMS_099", kitId: clusterModel.kitId },
    enemy = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 123, [[entry], [enemy]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  game.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = game.units;
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 12, y: 10, hp: 1000000, shield: 0 });
  const result = G.fight(game, a, b, rocket, "defend");
  assert.equal(result[0].strikes.length, 13);
  assert(result[0].strikes.every((s) => s.executed));
});
test("carrier splits along its route; fragments share that point without extra firing sounds", () => {
  const fx = runtime(),
    plan = fx.plan(rocket, source(), target, { hit: true, damage: 1000 });
  const carrier = plan.shots.find((s) => !s.isFragment),
    fragments = plan.shots.filter((s) => s.isFragment);
  assert.equal(fragments.length, 12);
  assert(carrier.splitPoint.x > 100 && carrier.splitPoint.x < 600);
  assert.equal(carrier.visibleUntil, carrier.splitAt);
  for (const shot of fragments) {
    assert.equal(shot.origin.x, carrier.splitPoint.x);
    assert.equal(shot.at, carrier.splitAt);
    assert(shot.impactAt > carrier.splitAt);
  }
  assert.equal(plan.cues.filter((c) => c.sound === rocket.sound).length, 1);
  assert(new Set(fragments.map((s) => s.destination.y)).size > 1);
});
test("ordinary shotgun spreads straight from muzzle, including vertically aimed shots", () => {
  const m = Object.values(G.models).find(
    (m) => m.prefabId === "MS_18E" && m.weapons.some((w) => w.sourceName === "ZN_ShotgunKai"),
  );
  const w = m.weapons.find((w) => w.sourceName === "ZN_ShotgunKai"),
    fx = runtime();
  assert(w.projectile.spreadDegrees > 0);
  assert(!w.projectile.cluster);
  const plan = fx.plan(w, source(m), { ...target, x: 100, y: 600 }, { hit: true, damage: 1000 });
  assert(plan.shots.every((s) => s.origin.x === 100 && s.origin.y === 100));
  assert(new Set(plan.shots.map((s) => Math.round(s.destination.x))).size > 1);
  assert(plan.shots.every((s) => !s.isFragment));
});
test("0087 rifle and caliber names agree across weapons and kit localization", () => {
  for (const p of ART.prefabs.filter((p) => p.tags.includes("0087")))
    for (const kit of p.weaponKits) {
      const w = p.weapons[kit.weapons[0]];
      if (!w) continue;
      if (/\d+mmMG/.test(w.sourceName)) {
        assert(w.name.includes("机枪"));
        if (p.weaponKits.length > 1)
          assert((kit.localization?.zh?.name || kit.name).includes("机枪"), p.id);
      }
      if (
        /(?:BeamRifle|_BR(?:_|$))/.test(w.sourceName) &&
        !/(?:Arm|Double|Hand)_?BR/.test(w.sourceName)
      )
        assert(w.name.includes("光束步枪"), p.id + "/" + w.sourceName);
    }
});
