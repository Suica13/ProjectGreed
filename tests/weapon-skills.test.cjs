const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  { createAttackPlanner } = require("../shared/attack-plans");
const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id,
});
function fixture(id = "RGC_80", count = 9) {
  const game = G.create(false, 2, [[entry(id)], Array(count).fill(entry("RGM_79"))], false, {
    costLimit: 99999,
    unitCostLimit: 10000,
  });
  game.tiles.forEach((r) => r.fill("plain"));
  const a = game.units[0];
  Object.assign(a, { x: 10, y: 10 });
  game.units
    .slice(1)
    .forEach((u, i) =>
      Object.assign(u, { x: 15 + (i % 3), y: 9 + Math.floor(i / 3), hp: 100000, shield: 0 }),
    );
  const room = { game, matchId: "m" };
  let n = 0;
  const planner = createAttackPlanner(G, () => String(++n));
  planner.reset(room);
  return { game, a, b: game.units[5] || game.units[1], room, planner };
}
test("categories have exact requested ranges and original native shooting/melee coefficients", () => {
  for (const p of G.catalog.prefabs) {
    for (const w of Object.values(p.weapons)) {
      let expected = {
        melee: [1, 1],
        sniper: [3, 6],
        mortar: [5, 8],
        bomb: [1, 2],
        bazooka: [2, 4],
        cannon: [3, 5],
        beam_rifle: [2, 3],
        beam_gun: [2, 3],
        machine_gun: [2, 3],
        missile: [3, 4],
      }[w.category];
      if (w.special?.type === "snipe") expected = [3, 9];
      if (p.stats.ship && ["cannon", "mortar"].includes(w.category))
        expected = [expected[0], expected[1] + 1];
      if (p.stats.ship && /_Turret_AA(?:_|$)/.test(w.sourceName || "")) {
        assert.equal(w.rangeRole, "ship_anti_air");
        assert.deepEqual([w.min, w.max], [1, 2], p.id + "/" + w.id);
      } else if (w.rangeRole === "short_secondary") assert.deepEqual([w.min, w.max], [1, 2]);
      else if (expected) assert.deepEqual([w.min, w.max], expected, p.id + "/" + w.name);
    }
    assert.equal(p.attackBonuses.shooting, p.sourceStats.shooting - 100);
    assert.equal(p.attackBonuses.melee, p.sourceStats.melee - 100);
  }
});
test("mortar samples distinct nine-grid cells, groups responses, forbids counters and pays EN once", () => {
  const { game, a, b, room, planner } = fixture(),
    w = G.modelOf(a).weapons.find((w) => w.special?.type === "mortar");
  assert.ok(w);
  const before = a.en;
  planner.plan(room, a, b, w, 0);
  const requests = planner.prepare(room);
  assert.equal(requests.length, 3);
  assert.equal(
    new Set(requests.flatMap((r) => r.attacks).map((i) => G.key(i.impactCell.x, i.impactCell.y)))
      .size,
    3,
  );
  assert.equal(a.en, before);
  for (const r of requests) {
    assert.deepEqual(
      planner.counterOptions(
        room,
        a,
        game.units.find((u) => u.id === r.target),
        r,
      ).ids,
      [],
    );
    assert.throws(() =>
      planner.choose(room, r.id, "counter", G.models.RGM_79__machine_gun.weapons[0].id),
    );
    planner.choose(room, r.id, "defend");
  }
  const battles = planner.resolve(room);
  assert.equal(battles.length, 3);
  assert.equal(a.en, before - w.en);
  assert.equal(
    battles.reduce((n, b) => n + b.events[0].strikes.length, 0),
    3,
  );
  assert.ok(battles.every((b) => b.events.length === 1));
});
test("empty mortar cells create bounded visual records without adding game units or charging extra EN", () => {
  const { game, a, b, room, planner } = fixture("RGC_80", 1);
  Object.assign(b, { x: 16, y: 10 });
  let selected = false;
  const w = G.modelOf(a).weapons.find((w) => w.special?.type === "mortar");
  planner.plan(room, a, b, w, 0);
  const r = planner.prepare(room);
  for (const request of r) planner.choose(room, request.id, "evade");
  const beforeUnits = game.units.length,
    battles = planner.resolve(room);
  assert.equal(battles.length, w.shotCount);
  assert.ok(battles.some((b) => b.events[0].empty));
  assert.equal(game.units.length, beforeUnits);
  assert.equal(a.en, G.modelOf(a).en - w.en);
  assert.ok(battles.filter((b) => b.events[0].empty).every((b) => b.actors[1].visualOnly));
});
test("sniper charging waits for next own phase, restores native skill damage and doubles computed hit", () => {
  const { game, a, b, room, planner } = fixture("RGM_79_G_SP", 1);
  Object.assign(b, { x: 14, y: 10 });
  const m = G.modelOf(a),
    skill = m.weapons.find((w) => w.special?.type === "snipe"),
    normal = m.weapons.find((w) => w.id === skill.special.baseWeapon);
  assert.ok(skill.damage > normal.damage);
  assert.equal(skill.en, 100);
  assert.equal(
    G.estimate(game, a, b, skill).hit,
    Math.min(100, G.estimate(game, a, b, { ...skill, hitScale: 1 }).hit * 2),
  );
  planner.plan(room, a, b, skill, 0);
  assert.equal(planner.prepare(room).length, 0);
  assert.equal(planner.resolve(room).length, 0);
  assert.equal(a.en, G.modelOf(a).en);
  assert.ok(a.snipeOrder);
  G.end(game);
  assert.equal(a.plan, undefined);
  G.end(game);
  planner.resumeCharges(room);
  assert.equal(room.plans.length, 1);
  assert.equal(room.plans[0].charged, true);
  const r = planner.prepare(room);
  assert.equal(r.length, 1);
  planner.choose(room, r[0].id, "evade");
  const battles = planner.resolve(room);
  assert.equal(battles.length, 1);
  assert.equal(a.en, G.modelOf(a).en - skill.en);
  assert.equal(a.snipeOrder, undefined);
});
test("sniper target that leaves range cancels the prepared shot without paying firing EN", () => {
  const { game, a, b, room, planner } = fixture("RGM_79_G_SP", 1);
  Object.assign(b, { x: 14, y: 10 });
  const skill = G.modelOf(a).weapons.find((w) => w.special?.type === "snipe");
  planner.plan(room, a, b, skill, 0);
  planner.prepare(room);
  planner.resolve(room);
  G.end(game);
  b.x = 25;
  G.end(game);
  planner.resumeCharges(room);
  assert.equal(room.plans.length, 0);
  assert.equal(a.acted, false);
  assert.equal(a.en, G.modelOf(a).en);
});

test("ship mortar exhausts all nine cells before redrawing and destroyed turrets do not fire", () => {
  const { game, a, b, room, planner } = fixture("BigTrayClass"),
    w = G.modelOf(a).weapons.find((w) => w.special?.type === "mortar");
  Object.assign(a, { x: 9, y: 10, angle: 90 });
  const broken = w.moduleIds[0];
  a.moduleHp[broken] = 0;
  const usable = G.availableStrikes(a, w, b).length;
  assert.ok(usable < w.attack.strikes.length);
  assert.ok(usable >= 9);
  planner.plan(room, a, b, w, 0);
  const requests = planner.prepare(room),
    shots = [...requests.flatMap((r) => r.attacks), ...room.emptyImpacts].sort(
      (a, b) => a.order - b.order,
    );
  assert.equal(shots.length, usable);
  for (let i = 0; i < shots.length; i += 9)
    assert.equal(
      new Set(shots.slice(i, i + 9).map((s) => G.key(s.impactCell.x, s.impactCell.y))).size,
      Math.min(9, shots.length - i),
    );
  for (const r of requests) planner.choose(room, r.id, "defend");
  const battles = planner.resolve(room);
  assert.equal(battles.length, usable);
  assert.equal(a.en, G.modelOf(a).en - w.en);
  assert.ok(battles.every((b) => b.events[0].strikes.every((s) => s.moduleId !== broken)));
});

test("charged sniper projectiles use ordinary sniper flight speed rather than native marker speed", () => {
  for (const m of Object.values(G.models))
    for (const w of m.weapons.filter((w) => w.special?.type === "snipe")) {
      const base = m.weapons.find((b) => b.id === w.special.baseWeapon);
      assert.equal(w.projectile.speed, base.projectile.speed, m.prefabId + "/" + w.id);
      assert.ok(w.projectile.speed > 1);
    }
});

test("sniper weapons use four AP and charged range is 150 percent of ordinary range", () => {
  let count = 0;
  for (const p of G.catalog.prefabs)
    for (const w of Object.values(p.weapons)) {
      if (w.category !== "sniper") continue;
      count++;
      assert.equal(w.actionCost, 4, p.id + "/" + w.name);
      if (w.special?.type === "snipe") {
        const base = p.weapons[w.special.baseWeapon];
        assert.equal(w.max, Math.ceil(base.max * 1.5));
        assert.equal(w.min, base.min);
      } else assert.deepEqual([w.min, w.max], [3, 6]);
    }
  assert.ok(count > 0);
});

test("sniper planning enforces the new range edges and spends four AP for either mode", () => {
  const { game, a, b, planner, room } = fixture("RGM_79_G_SP", 1);
  const weapons = G.modelOf(a).weapons,
    ordinary = weapons.find((w) => w.category === "sniper" && !w.special),
    charged = weapons.find((w) => w.special?.type === "snipe");
  Object.assign(b, { x: 16, y: 10 });
  assert.equal(G.canAttack(game, a, b, ordinary), true);
  planner.plan(room, a, b, ordinary, 0);
  assert.equal(a.actionPoints, 1);
  planner.cancel(room, a);
  b.x = 17;
  assert.equal(G.canAttack(game, a, b, ordinary), false);
  b.x = 19;
  assert.equal(G.canAttack(game, a, b, charged), true);
  planner.plan(room, a, b, charged, 0);
  assert.equal(a.actionPoints, 1);
  planner.cancel(room, a);
  b.x = 20;
  assert.equal(G.canAttack(game, a, b, charged), false);
});
