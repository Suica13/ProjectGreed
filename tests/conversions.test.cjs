const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Parts = require("../shared/unit-parts.js");
const entry = (id) => ({
  unitId: id,
  kitId: Object.values(G.models).find((m) => m.prefabId === id).kitId,
  ...(G.catalog.prefabs.find((p) => p.id === id)?.requiredPilotId
    ? {
        customPilot: G.pilots.createAce(G.catalog.prefabs.find((p) => p.id === id).requiredPilotId),
      }
    : {}),
});
function pair(id) {
  const g = G.create(false, 1, [[entry(id)], [entry("RGM_79")]], false, {
    costLimit: 99999,
    unitCostLimit: 10000,
  });
  g.tiles.forEach((r) => r.fill("plain"));
  Object.assign(g.units[0], { x: 10, y: 10 });
  Object.assign(g.units[1], { x: 15, y: 10 });
  return { g, u: g.units[0], enemy: g.units[1] };
}
test("every ejection selects exactly one adjacent cell, rejecting self, diagonals and occupied cells", () => {
  for (const id of ["RX_78_1", "RX_78_2", "RX_75", "RX_77_2", "FA_78_1_NA", "MTank"]) {
    const { g, u } = pair(id === "FA_78_1_NA" ? "FA_78_1" : id);
    if (id === "FA_78_1_NA") {
      G.useSkill(g, u, "ExitUnit", u.x, u.y);
      u.acted = u.moved = false;
    }
    const skill = G.unitSkills(u).find((s) => s.type === "escape");
    assert.deepEqual([skill.minRange, skill.range], [1, 1]);
    const targets = G.skillTargets(g, u, skill.id);
    assert.equal(targets.length, 4, id);
    assert.ok(targets.every((c) => G.dist(u, c) === 1));
    for (const c of [
      { x: u.x, y: u.y },
      { x: u.x + 1, y: u.y + 1 },
      { x: u.x + 2, y: u.y },
    ])
      assert.throws(() => G.useSkill(g, u, skill.id, c.x, c.y));
  }
});
test("Magella separates a ground chassis from a fully restored flying top at the selected adjacent cell", () => {
  const { g, u } = pair("MTank"),
    oldId = u.id,
    beforeAP = G.actionPoints(u);
  u.hp = 1;
  u.en = 0;
  u.customName = "Tank";
  u.counterCount = 1;
  const e = G.useSkill(g, u, "ExitUnit", 11, 10),
    top = g.units.find((x) => x.id === e.resultId);
  assert.equal(u.id, oldId);
  assert.equal(u.model, "MTank_Chassis__standard");
  assert.equal(top.model, "MTank_Top__standard");
  assert.deepEqual([top.x, top.y], [11, 10]);
  assert.deepEqual([u.x, u.y], [10, 10]);
  for (const x of [u, top]) {
    assert.equal(x.hp, G.modelOf(x).hp);
    assert.equal(x.en, G.modelOf(x).en);
    assert.equal(x.ownerSeat, 0);
    assert.equal(x.acted, false);
    assert.equal(x.actionPoints, beforeAP - 1);
    assert.equal(x.counterCount, 1);
  }
  assert.equal(G.modelOf(top).movementType, "air");
  assert.equal(G.modelOf(u).movementType, "ground");
});
test("NT-1 FA and FA-78-1 purge in place, add native 35 percent resources and retain damaged parts and identity", () => {
  for (const [id, target] of [
    ["RX_78NT_1_FA", "RX_78NT_1"],
    ["FA_78_1", "FA_78_1_NA"],
  ]) {
    const { g, u } = pair(id),
      old = G.modelOf(u),
      count = g.units.length,
      beforeAP = G.actionPoints(u);
    u.hp = old.hp * 0.2;
    u.en = old.en * 0.1;
    u.brokenParts = { leftArm: true };
    u.customName = "Custom";
    u.counterCount = 1;
    const uid = u.id;
    assert.equal(G.unitSkills(u)[0].type, "armor_purge");
    G.useSkill(g, u, "ExitUnit", u.x, u.y);
    const next = G.modelOf(u);
    assert.equal(next.prefabId, target);
    assert.equal(u.hp, Math.round(next.hp * 0.55));
    assert.ok(Math.abs(u.en - next.en * 0.45) < 0.00001);
    assert.equal(u.id, uid);
    assert.equal(u.customName, "Custom");
    assert.deepEqual(u.brokenParts, { leftArm: true });
    assert.equal(u.counterCount, 1);
    assert.equal(u.acted, false);
    assert.equal(u.actionPoints, beforeAP - 1);
    assert.equal(g.units.length, count);
  }
});
test("FA-78-1's purged body can eject again with remaining AP and transformations cannot heal or reset spent actions", () => {
  const { g, u } = pair("FA_78_1");
  G.useSkill(g, u, "ExitUnit", 10, 10);
  assert.equal(G.canUseSkill(g, u, "ExitUnit"), true);
  G.end(g);
  G.end(g);
  const e = G.useSkill(g, u, "ExitUnit", 11, 10),
    craft = g.units.find((x) => x.id === e.resultId);
  assert.equal(craft.model, "FF_X7__standard");
  assert.equal(craft.hp, G.modelOf(craft).hp);
  const world = pair("YMT_05"),
    unit = world.u,
    id = unit.id;
  unit.hp = G.modelOf(unit).hp * 0.3;
  unit.en = G.modelOf(unit).en * 0.4;
  G.useSkill(world.g, unit, "Transform", 10, 10);
  assert.equal(G.modelOf(unit).prefabId, "YMT_05_ModeB");
  assert.equal(unit.id, id);
  assert.equal(unit.acted, true);
  assert.equal(G.canUseSkill(world.g, unit, "Transform"), false);
  assert.ok(Math.abs(unit.hp / G.modelOf(unit).hp - 0.3) < 0.0001);
  assert.ok(Math.abs(unit.en / G.modelOf(unit).en - 0.4) < 0.0001);
  G.end(world.g);
  G.end(world.g);
  G.useSkill(world.g, unit, "Transform", 10, 10);
  assert.equal(G.modelOf(unit).prefabId, "YMT_05");
});
test("head destruction immediately disables EXAM/HADES, retains damage, stops form weapons and prohibits reactivation", () => {
  const bases = G.catalog.prefabs.filter(
    (p) => !p.formOnly && p.skills?.some((s) => s.type === "overdrive"),
  );
  const original = Parts.applyHit;
  try {
    for (const base of bases) {
      const { g, u, enemy } = pair(base.id),
        skill = G.unitSkills(u).find((s) => s.type === "overdrive"),
        normal = u.model;
      G.useSkill(g, u, skill.id, u.x, u.y);
      const boosted = u.model,
        en = u.en;
      assert.notEqual(boosted, normal);
      g.team = enemy.team;
      Object.assign(enemy, { x: 12, y: 10, acted: false });
      u.shield = 0;
      Parts.applyHit = (game, target) => {
        if (target.brokenParts?.head) return null;
        target.brokenParts = { ...target.brokenParts, head: true };
        return "head";
      };
      const w = { ...G.modelOf(enemy).weapons[0], hit: 10000, damageComponents: { shell: 1000 } },
        hp = u.hp;
      const events = G.fight(g, enemy, u, w, "defend");
      assert.equal(u.model, normal, base.id);
      assert.equal(u.overdrive, undefined);
      assert.ok(u.hp < hp);
      assert.equal(u.en, en);
      assert.equal(u.brokenParts.head, true);
      assert.ok(events[0].strikes.some((s) => s.overdriveEnded && s.modelAfter === normal));
      assert.equal(events[0].targetModelAfter, normal);
      g.team = u.team;
      u.acted = false;
      assert.equal(G.canUseSkill(g, u, skill.id), false);
      assert.throws(() => G.useSkill(g, u, skill.id, u.x, u.y));
    }
  } finally {
    Parts.applyHit = original;
  }
});

test("head-broken active states are forcibly normalized at handoff without charging another upkeep", () => {
  const { g, u } = pair("RX_79_BD_1"),
    base = u.model,
    s = G.unitSkills(u).find((s) => s.type === "overdrive");
  G.useSkill(g, u, s.id, u.x, u.y);
  u.brokenParts = { head: true };
  const hp = u.hp,
    en = u.en;
  G.end(g);
  assert.equal(u.model, base);
  assert.equal(u.overdrive, undefined);
  assert.equal(u.hp, hp);
  assert.equal(u.en, en);
  assert.equal(g.turnEffects[0].expired, true);
});

test("any broken part immediately cancels flight and reversible forms, never purge or escape", () => {
  const original = Parts.applyHit;
  try {
    for (const id of ["MS_07H", "YMT_05", "RX_78NT_1_FA", "FA_78_1"]) {
      const { g, u, enemy } = pair(id),
        base = u.model;
      const skill = G.unitSkills(u).find((s) =>
        ["flight", "transform", "armor_purge"].includes(s.type),
      );
      assert(skill, id);
      G.useSkill(g, u, skill.id, u.x, u.y);
      const changed = u.model;
      g.team = enemy.team;
      Object.assign(enemy, { x: 12, y: 10, acted: false });
      u.shield = 0;
      Parts.applyHit = (game, target) => {
        target.brokenParts = { ...target.brokenParts, leftArm: true };
        return "leftArm";
      };
      const w = { ...G.modelOf(enemy).weapons[0], hit: 10000, damageComponents: { shell: 1000 } };
      const events = G.fight(g, enemy, u, w, "defend");
      if (skill.type === "armor_purge") assert.equal(u.model, changed);
      else {
        assert.equal(u.model, base);
        assert(!u.flying);
        assert(events[0].strikes.some((s) => s.formReverted));
      }
      assert(u.brokenParts.leftArm);
    }
  } finally {
    Parts.applyHit = original;
  }
});

test("EXAM and HADES drain 10 percent maximum HP; Pale Rider Cavalry drains 7.5 percent", () => {
  for (const base of G.catalog.prefabs.filter((p) =>
    p.skills?.some((s) => s.type === "overdrive" && ["EXAM", "HADES"].includes(s.id)),
  )) {
    const { g, u } = pair(base.id);
    const skill = G.unitSkills(u).find((s) => s.type === "overdrive");
    const percent = base.id === "RX_80PR_2" ? 7.5 : 10;
    assert.equal(skill.hpDrainPercent, percent, base.id);
    G.useSkill(g, u, skill.id, u.x, u.y);
    const before = u.hp,
      maximum = G.modelOf(u).hp;
    assert.equal(u.overdrive.hpDrainPercent, percent, base.id);
    G.end(g);
    assert.equal(u.hp, before - (skill.id === "EXAM" && G.pilots.hasPassive(u,"Pilot_ExamPilot_Trigger") ? 0 : G.roundDamage(maximum * percent / 100)), base.id);
    assert.equal(u.overdrive.remaining, skill.duration - 1);
  }
});

test("EXAM and HADES allow non-head damage and retain the form across hits and upkeep", () => {
  const original = Parts.applyHit;
  try {
    for (const base of G.catalog.prefabs.filter(
      (p) => !p.formOnly && p.skills?.some((s) => s.type === "overdrive"),
    )) {
      const { g, u, enemy } = pair(base.id);
      const skill = G.unitSkills(u).find((s) => s.type === "overdrive");
      u.brokenParts = { leftArm: true };
      assert(G.canUseSkill(g, u, skill.id), base.id);
      G.useSkill(g, u, skill.id, u.x, u.y);
      const active = u.model;
      g.team = enemy.team;
      Object.assign(enemy, { x: 12, y: 10, acted: false });
      u.shield = 0;
      Parts.applyHit = (game, target) => {
        target.brokenParts = { ...target.brokenParts, backpack: true };
        return "backpack";
      };
      G.fight(
        g,
        enemy,
        u,
        { ...G.modelOf(enemy).weapons[0], hit: 10000, damageComponents: { shell: 1000 } },
        "defend",
      );
      assert.equal(u.model, active);
      assert(u.overdrive);
      g.team = u.team;
      G.end(g);
      assert.equal(u.model, active);
      assert(u.overdrive);
      assert.equal(u.overdrive.remaining, skill.duration - 1);
    }
  } finally {
    Parts.applyHit = original;
  }
});

test("new native ejections preserve pilots, restore spawned hulls and remove the parent", () => {
  const space = Object.values(G.catalog.maps).find((m) => m.environment === "space").id;
  for (const [source, target, inSpace] of [
    ["RX_78_3", "FF_X7", false],
    ["RX_78GP01", "FF_X_II", false],
    ["RX_78GP01_FB", "FF_X_II_FB", true],
    ["RX_78GP03D", "RX_78GP03S", true],
    ["MSN_02", "MSN_02_Head", true],
  ]) {
    const g = G.create(false, 1, [[entry(source)], [entry("RGM_79")]], false, {
      costLimit: 99999,
      unitCostLimit: 99999,
      ...(inSpace ? { mapId: space } : {}),
    });
    const u = g.units[0],
      enemy = g.units[1];
    Object.assign(u, { x: 10, y: 10, hp: 1, en: 0 });
    Object.assign(enemy, { x: 30, y: 20 });
    if (!inSpace) g.tiles.forEach((row) => row.fill("plain"));
    u.pilot = G.pilots.createCustom("custom-ejection-test", "Pilot");
    const pilot = u.pilot,
      owner = G.ownerOf(u),
      skill = G.unitSkills(u).find((s) => s.type === "escape");
    assert.ok(skill, source);
    const point = G.skillTargets(g, u, skill.id)[0];
    assert.ok(point, source);
    const event = G.useSkill(g, u, skill.id, point.x, point.y);
    const spawned = g.units.find((s) => s.id === event.resultId);
    assert.ok(spawned, source);
    assert.equal(G.modelOf(spawned).prefabId, target);
    assert.equal(spawned.pilot, pilot);
    assert.equal(G.ownerOf(spawned), owner);
    assert.equal(spawned.hp, G.modelOf(spawned).hp);
    assert.equal(spawned.en, G.modelOf(spawned).en);
    assert.ok(!g.units.includes(u));
  }
});

test("new native armor purges preserve their pilot and use the existing in-place recovery contract", () => {
  for (const [source, target] of [
    ["RGM_79FP", "RGM_79C"],
    ["FA_78_3", "RX_78_7"],
  ]) {
    const { g, u } = pair(source);
    u.pilot = G.pilots.createCustom("custom-purge", "Pilot");
    const pilot = u.pilot;
    u.hp = G.modelOf(u).hp * 0.2;
    u.en = G.modelOf(u).en * 0.2;
    const skill = G.unitSkills(u).find((s) => s.type === "armor_purge");
    assert.ok(skill, source);
    G.useSkill(g, u, skill.id, u.x, u.y);
    assert.equal(G.modelOf(u).prefabId, target);
    assert.equal(u.pilot, pilot);
    assert.equal(g.units.length, 2);
    assert.equal(u.hp, Math.round(G.modelOf(u).hp * 0.55));
  }
});

test("purge and ejection cost exactly one AP, reject zero AP atomically and allow further combat", () => {
  for (const id of ["RX_78NT_1_FA", "RX_78_1"]) {
    for (const ap of [0, 1, 3]) {
      const { g, u, enemy } = pair(id),
        skill = G.unitSkills(u).find((s) => ["escape", "armor_purge"].includes(s.type));
      u.actionPoints = ap;
      const [x, y] = skill.type === "escape" ? [11, 10] : [10, 10];
      if (!ap) {
        const before = JSON.stringify(g);
        assert.equal(G.canUseSkill(g, u, skill.id), false);
        assert.throws(() => G.useSkill(g, u, skill.id, x, y));
        assert.equal(JSON.stringify(g), before);
        continue;
      }
      const e = G.useSkill(g, u, skill.id, x, y),
        next = g.units.find((v) => v.id === e.resultId);
      assert.equal(next.actionPoints, ap - 1);
      assert.equal(next.acted, ap === 1);
      assert.equal(next.moved, false);
      if (ap > 1) {
        Object.assign(enemy, { x: next.x + 2, y: next.y });
        assert(
          G.modelOf(next).weapons.some((w) => G.canAttack(g, next, enemy, w)),
          id,
        );
        assert(G.reachable(g, next).size > 1, id);
      }
    }
  }
});
