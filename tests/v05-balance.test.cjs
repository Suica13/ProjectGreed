const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id,
});
const make = (army, settings = {}) => {
  const g = G.create(false, 1, [army, [entry("RGM_79")]], false, {
    costLimit: 99999,
    unitCostLimit: 10000,
    ...settings,
  });
  g.tiles.forEach((r) => r.fill("plain"));
  return g;
};
test("all native Level prices use one quarter value and fixed category surcharges; system forms cannot be purchased", () => {
  for (const p of G.catalog.prefabs) {
    assert.equal(p.stats.cost, Math.max(25, Math.round(p.sourceStats.unitLevel / 100) * 25), p.id);
    for (const kit of p.weaponKits)
      assert.equal(G.models[p.id + "__" + kit.id].cost, p.stats.cost + kit.cost);
    if (p.formOnly) assert.throws(() => G.validateFormation([entry(p.id)]));
  }
  assert.equal(G.models.RGM_79__machine_gun.cost, 250);
  assert.equal(G.models.SalamisClass__standard.cost, 500);
});
test("weapon category ranges preserve melee adjacency and distinguish sniper, cannon and mortar", () => {
  for (const p of G.catalog.prefabs)
    for (const [id, w] of Object.entries(p.weapons)) {
      if (w.type === "melee") {
        assert.equal(w.min, 1);
        assert.equal(w.max, 1);
      } else if (w.category === "mortar") {
        assert.deepEqual([w.min, w.max], [5, p.stats.ship ? 9 : 8], id);
      } else if (["cannon", "sniper"].includes(w.category)) {
        assert.deepEqual(
          [w.min, w.max],
          [
            3,
            w.category === "sniper" ? (w.special?.type === "snipe" ? 9 : 6) : p.stats.ship ? 8 : 5,
          ],
          id,
        );
      } else assert.ok(w.max >= 1 && w.max <= 4, id);
      assert.ok(w.min <= w.max);
    }
});
test("ship footprints follow the explicit exceptions while sprite scales remain independent", () => {
  for (const p of G.catalog.prefabs.filter((p) => p.stats.ship))
    assert.deepEqual(
      p.stats.footprint,
      ["PegasusClass", "ZanzibarClass"].includes(p.id)
        ? { width: 3, height: 6 }
        : ["GallopClass", "MiniTrayClass"].includes(p.id)
          ? { width: 1, height: 2 }
          : { width: 2, height: 3 },
    );
  assert.equal(G.models.PegasusClass__standard.presentation.mapScale, 1);
});
test("ship destinations use centre coordinates including half-cell centres, move and undo retain full footprint legality", () => {
  const g = make([entry("SalamisClass")], { mapId: "asteroid_crossing_1v1" }),
    u = g.units[0];
  Object.assign(u, { x: 10, y: 10, angle: 90 });
  assert.deepEqual(G.center(u), { x: 11, y: 10.5 });
  const anchor = G.anchorAt(u, 13, 10.5);
  assert.deepEqual(anchor, { x: 12, y: 10 });
  G.move(g, u, anchor.x, anchor.y);
  assert.deepEqual(G.center(u), { x: 13, y: 10.5 });
  assert.equal(G.cells(u).length, 6);
  G.undo(g, u);
  assert.deepEqual(G.center(u), { x: 11, y: 10.5 });
});
test("four deployment rotations return an even-width hull to its original centre without cumulative drift", () => {
  const g = make([entry("SalamisClass")], { mapId: "asteroid_crossing_1v1" }),
    u = g.units[0];
  g.deployment = [false, false];
  Object.assign(u, { x: 4, y: 5, angle: 90 });
  const before = G.center(u);
  for (let i = 0; i < 4; i++) {
    assert.ok(G.canRotate(g, u, 1));
    G.rotate(g, u, 1);
    assert.ok(G.fits(g, u, u.x, u.y, u.angle, false, 0));
  }
  assert.deepEqual(G.center(u), before);
  assert.equal(u.moved, false);
});
test("EXAM and HADES use native form assets, consume quarter EN, drain only own phases and forcibly return after three", () => {
  const bases = G.catalog.prefabs.filter((p) => p.skills?.some((s) => s.type === "overdrive"));
  assert.equal(bases.length, 6);
  for (const p of bases) {
    const g = make([entry(p.id)]),
      u = g.units[0],
      m = G.modelOf(u),
      base = u.model,
      skill = G.unitSkills(u).find((s) => s.type === "overdrive");
    u.hp = Math.round(m.hp * 0.8);
    u.en = m.en;
    u.brokenParts = { leftArm: true };
    u.customName = "测试[X12]";
    const beforeHp = u.hp;
    assert.ok(G.canUseSkill(g, u, skill.id));
    G.useSkill(g, u, skill.id, u.x, u.y);
    assert.notEqual(u.model, base);
    assert.equal(u.hp, beforeHp);
    assert.equal(u.en, m.en * 0.75);
    assert.ok(G.modelOf(u).mobility >= m.mobility * 1.35);
    assert.ok(G.modelOf(u).accuracy >= m.accuracy * 1.2);
    assert.equal(u.acted, false);
    assert.deepEqual(u.brokenParts, { leftArm: true });
    assert.equal(u.customName, "测试[X12]");
    assert.equal(G.canUseSkill(g, u, skill.id), false);
    const snapshot = JSON.parse(JSON.stringify(g));
    assert.equal(snapshot.units[0].overdrive.remaining, 3);
    for (let tick = 1; tick <= 3; tick++) {
      G.end(g);
      assert.equal(u.hp, beforeHp - Math.round(m.hp * 0.1) * tick);
      assert.ok(Math.abs(u.en - m.en * (0.75 - 0.05 * tick)) < 1e-8);
      if (tick < 3) {
        assert.equal(u.overdrive.remaining, 3 - tick);
        const en = u.en;
        G.end(g);
        assert.equal(u.en, en);
      }
    }
    assert.equal(u.model, base);
    assert.equal(u.overdrive, undefined);
    assert.deepEqual(u.brokenParts, { leftArm: true });
    assert.equal(u.customName, "测试[X12]");
  }
});
test("insufficient activation EN and malformed skill targets leave the unit unchanged", () => {
  const g = make([entry("RX_79_BD_1")]),
    u = g.units[0],
    s = G.unitSkills(u).find((s) => s.type === "overdrive");
  u.en = 24;
  const before = JSON.stringify(u);
  assert.throws(() => G.useSkill(g, u, s.id, u.x, u.y));
  assert.equal(JSON.stringify(u), before);
  u.en = 100;
  assert.throws(() => G.useSkill(g, u, s.id, u.x + 1, u.y));
  assert.equal(u.en, 100);
});
test("supply is free, passive, non-stacking, team-only, bounded and never revives destroyed units", () => {
  const g = make([entry("Type74"), entry("Type74"), entry("RGM_79"), entry("RGM_79")]);
  const [a, b, c, d, enemy] = g.units;
  Object.assign(a, { x: 5, y: 5, en: 20 });
  Object.assign(b, { x: 5, y: 6, en: 20 });
  Object.assign(c, { x: 6, y: 5, hp: 100, en: 0 });
  Object.assign(d, { x: 7, y: 5, hp: 0, en: 0 });
  Object.assign(enemy, { x: 6, y: 6, en: 0, hp: 100 });
  const hp = G.modelOf(c).hp;
  G.end(g);
  assert.equal(c.en, 0);
  assert.equal(enemy.en, 0);
  G.end(g);
  assert.equal(c.hp, 100 + Math.round(hp * 0.05));
  assert.equal(c.en, G.modelOf(c).en * 0.1);
  assert.equal(a.en, 20 + G.modelOf(a).en * 0.1);
  assert.equal(b.en, 20 + G.modelOf(b).en * 0.1);
  assert.equal(d.hp, 0);
  assert.equal(enemy.en, 0);
  assert.equal(a.acted, false);
});
test("ordinary units receive no natural EN recovery, and overdrive damage can end a match", () => {
  const g = make([entry("RGM_79")]),
    u = g.units[0];
  u.en = 0;
  G.end(g);
  G.end(g);
  assert.equal(u.en, 0);
  const active = make([entry("RX_79_BD_1")]),
    actor = active.units[0],
    s = G.unitSkills(actor).find((s) => s.type === "overdrive");
  G.useSkill(active, actor, s.id, actor.x, actor.y);
  actor.hp = 1;
  G.end(active);
  assert.equal(actor.hp, 0);
  assert.equal(active.winner, 1);
});

test("undoing rotation retains the previous centre pivot across turns", () => {
  const g = make([entry("SalamisClass")], { mapId: "asteroid_crossing_1v1" }),
    u = g.units[0];
  Object.assign(u, { x: 10, y: 10, angle: 90 });
  G.rotate(g, u, 1);
  G.end(g);
  G.end(g);
  const original = { x: u.x, y: u.y, angle: u.angle, pivot: { ...u.rotationPivot } };
  G.rotate(g, u, 1);
  const target = { x: u.x, y: u.y, angle: u.angle };
  G.undo(g, u);
  assert.deepEqual(u.rotationPivot, original.pivot);
  G.rotate(g, u, 1);
  assert.deepEqual({ x: u.x, y: u.y, angle: u.angle }, target);
});
