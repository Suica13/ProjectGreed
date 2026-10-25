const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  fs = require("node:fs");
const model = (id) => Object.values(G.models).find((m) => m.prefabId === id);
const weapon = (id, key) =>
  Object.values(G.models)
    .filter((m) => m.prefabId === id)
    .flatMap((m) => m.weapons)
    .find((w) => w.id === key);
function duel(aid = "RGM_79", bid = "RGM_79") {
  const entry = (id) => ({ unitId: id, kitId: model(id).kitId });
  const g = G.create(false, 1, [[entry(aid)], [entry(bid)]], false, {
    costLimit: 99999,
    unitCostLimit: 10000,
    ...(aid === "SalamisClass" ? { mapId: "asteroid_crossing_1v1" } : {}),
  });
  g.tiles.forEach((r) => r.fill("plain"));
  const [a, b] = g.units;
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(b, { x: 12, y: 10, hp: 100000, shield: 0 });
  return { g, a, b };
}
test("native hull and shield maxima replace historical values and EN uses enMax", () => {
  assert.deepEqual(
    [model("RGM_79").hp, model("RGM_79").en, model("RGM_79").shield.hp],
    [21000, 750, 4000],
  );
  assert.equal(model("RGC_80").en, 900);
  assert.equal(model("SalamisClass").en, 4500);
  for (const p of G.catalog.prefabs) {
    assert.equal(p.nativeCombatRevision, 1);
    assert.ok(p.stats.hp > 0 && p.stats.en > 0);
  }
});
test("native firearms keep original payload, hit, EN and firing cadence without old balance multipliers", () => {
  const mg = weapon("RGM_79", "EF_90mmMG"),
    spray = weapon("RGM_79", "EF_BeamSprayGun"),
    rocket = weapon("RGM_79", "EF_HypeBazooka"),
    saber = weapon("RGM_79", "EF_BeamSaber_A"),
    vulcan = weapon("RGM_79", "Common_DoubleVulcan_MS");
  assert.deepEqual([mg.damagePerShot, mg.shotCount, mg.en, mg.hit], [725, 9, 20, 100]);
  assert.equal(mg.nativeTiming.duration, 1.4);
  assert.equal(mg.nativeTiming.cooldown, 2);
  assert.deepEqual([spray.damage, spray.shotCount, spray.en, spray.hit], [5000, 1, 25, 85]);
  assert.deepEqual([rocket.damage, rocket.shotCount, rocket.en], [8500, 1, 55]);
  assert.deepEqual([saber.damage, saber.shotCount, saber.en, saber.hit], [5000, 1, 0, 125]);
  assert.deepEqual([vulcan.shotCount, vulcan.en, vulcan.min, vulcan.max], [16, 0, 1, 2]);
  const { g, a, b } = duel();
  const before = a.en;
  G.fight(g, a, b, mg, "defend");
  assert.equal(a.en, before - 20);
});
test("native sniper skill restores its stronger AP payload and cost while keeping charged-turn mechanics", () => {
  const m = model("RGM_79_G_SP"),
    normal = m.weapons.find((w) => w.id === "EF_LongRangeBeamSniperRifle"),
    skill = m.weapons.find((w) => w.special?.type === "snipe");
  assert.equal(normal.damage, 10000);
  assert.equal(skill.damage, 35000);
  assert.equal(skill.en, 100);
  assert.equal(skill.special.delayOwnTurns, 1);
  assert.equal(skill.hitScale, 2);
});
test("wrist/head secondary range overrides and bomb aircraft exclusion work in both environments", () => {
  for (const p of G.catalog.prefabs)
    for (const [key, w] of Object.entries(p.weapons))
      if (key === "Common_DoubleVulcan_MS" || /HandMG|HandGun|ArmMG|ArmGL|ArmBR/.test(key))
        assert.deepEqual([w.min, w.max], [1, 2], p.id + key);
  const bomber = Object.values(G.models).find((m) =>
    m.weapons.some((w) => w.special?.type === "bomb"),
  );
  const { g, a, b } = duel(bomber.prefabId, "FF_X7");
  const w = G.modelOf(a).weapons.find((w) => w.special?.type === "bomb");
  for (const env of ["ground", "space"]) {
    g.environment = env;
    assert.equal(G.canAttack(g, a, b, w), false);
  }
  b.model = "RGM_79__machine_gun";
  assert.equal(G.canAttack(g, a, b, w), true);
});
test("AP payload ignores flat armor, uses quarter percentage armor and bypasses shield absorption", () => {
  const { g, a, b } = duel();
  const base = weapon("RGM_79_G_SP", "EF_LongRangeBeamSniperRifle"),
    w = {
      ...base,
      damageComponents: { beamAP: 4000 },
      damagePerShot: 4000,
      antiSize: { small: { damage: 1, accuracy: 1 } },
      attack: {
        ...base.attack,
        strikes: [{ ...base.attack.strikes[0], damageComponents: { beamAP: 4000 } }],
      },
    };
  const m = G.models[b.model],
    old = m.defenses;
  m.defenses = { ...old, beam: { flat: 99999, percent: 40 } };
  try {
    b.shield = 100000;
    const e = G.estimate(g, a, b, w);
    assert.equal(e.damage, 4320);
    assert.equal(e.shieldDamage, 0);
    assert.equal(e.blockedDamage, e.damage);
  } finally {
    m.defenses = old;
  }
});
test("broken ship modules reduce per-emission native EN without changing intact volleys", () => {
  const { a } = duel("SalamisClass"),
    w = G.modelOf(a).weapons.find((w) => w.id === "SalamisClass_Turret_BeamCannon");
  assert.equal(w.en, 240);
  assert.equal(G.weaponStats(w, a).en, 240);
  a.moduleHp[w.moduleIds[0]] = 0;
  assert.equal(G.weaponStats(w, a).en, 200);
});
test("native timing report covers hidden and visible weapons and preserves all statistics", () => {
  const report = JSON.parse(fs.readFileSync("tools/weapon-timing-report.json", "utf8"));
  assert.equal(
    report.length,
    G.catalog.prefabs.reduce((n, p) => n + Object.keys(p.weapons).length, 0),
  );
  for (const row of report) {
    assert.ok(row.firstShot <= row.lastShot && row.lastShot <= row.duration + 0.00001);
    assert.ok(row.cooldown >= 0 && row.projectiles > 0);
  }
});
