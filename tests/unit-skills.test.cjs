const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const Parts = require("../shared/unit-parts.js");
const SkillSchema = require("../shared/unit-skills.js");
function pair() {
  const game = G.create(false, 1, [
    [{ unitId: "RX_78_1", kitId: "beam_rifle", customName: "白色一号" }],
    [{ unitId: "MS_06F", kitId: "machine_gun" }],
  ]);
  game.tiles = game.tiles.map((row) => row.map(() => "plain"));
  const [unit, enemy] = game.units;
  Object.assign(unit, { x: 4, y: 5 });
  Object.assign(enemy, { x: 15, y: 10 });
  return { game, unit, enemy };
}
function withSkill(skill, run) {
  const model = G.models.RX_78_1__beam_rifle,
    saved = model.skills;
  model.skills = [skill];
  try {
    run();
  } finally {
    model.skills = saved;
  }
}
const result = (unitId, kitId, overrides = {}) => ({
  unitId,
  kitId,
  inheritResources: true,
  hpRecoveryPercent: 0,
  enRecoveryPercent: 0,
  shieldRecoveryPercent: 0,
  repairAllParts: false,
  ...overrides,
});

test("RX-78-1 keeps native reaction, accuracy, arm-aware melee Steps, kit mounts and the core fighter's weapons", () => {
  const m = G.models.RX_78_1__beam_rifle;
  assert.equal(m.hp, 35000);
  assert.equal(m.shield.hp, 6000);
  assert.equal(m.mobility, 134);
  assert.equal(m.accuracy, 124);
  assert.equal(m.partStructuralStrength, 124);
  for (const kit of ["machine_gun", "bazooka", "beam_rifle"])
    assert.equal(G.models["RX_78_1__" + kit].weapons[0].shotCount, kit === "machine_gun" ? 8 : 1);
  const saber = m.weapons.find((w) => w.id === "EF_BeamSaber_AF_Fast_A");
  assert.equal(saber.shotCount, 2);
  assert.equal(saber.attack.animations.filter((a) => a.clip).length, 2);
  assert.deepEqual(
    saber.attack.strikes.map((s) => s.damageMultiplier),
    [1, 1],
  );
  assert.equal(
    m.weapons.some((w) => w.id === "EF_BeamSaber_Double_AALDF"),
    false,
  );
  const twin = m.hiddenWeapons.find((w) => w.id === "EF_BeamSaber_Double_AALDF");
  assert.ok(twin.reasons.includes("pilot_skill"));
  assert.ok(twin.requirements.some((r) => r.greaterThan === 145));
  const core = G.models.FF_X7__standard;
  assert.equal(core.movementType, "air");
  assert.equal(core.partsBreakable, false);
  const art = G.catalog.units.find((u) => u.id === "FF_X7__standard");
  assert.ok(art.decals.some((l) => l.name === "BoostLoop" && l.visibleWhen.thrustActive));
  assert.equal(core.hp, 8500);
  assert.deepEqual(
    core.weapons.map((w) => w.shotCount),
    [8, 2],
  );
  assert.ok(core.weapons.every((w) => w.requiredParts.length === 0));
});

test("native ejection removes RX-78-1, creates one fully restored craft at the selected cell and preserves ownership and identity", () => {
  const { game, unit } = pair();
  unit.performance = 1.25;
  unit.hp = 100;
  unit.en = 0;
  unit.shield = 0;
  unit.brokenParts = { head: true, leftArm: true, backpack: true };
  unit.counterCount = 1;
  unit.origin = { x: 3, y: 5 };
  const event = G.useSkill(game, unit, "ExitUnit", 5, 5);
  assert.equal(
    game.units.some((u) => u.id === unit.id),
    false,
  );
  assert.equal(game.units.length, 2);
  const craft = game.units.find((u) => u.id === event.resultId);
  assert.equal(craft.model, "FF_X7__standard");
  assert.equal(craft.customName, "白色一号");
  assert.equal(craft.ownerSeat, 0);
  assert.equal(craft.team, 0);
  assert.equal(craft.environment, "ground");
  assert.equal(craft.performance, 1.25);
  assert.equal(craft.hp, G.modelOf(craft).hp);
  assert.equal(craft.en, G.modelOf(craft).en);
  assert.deepEqual(craft.brokenParts, {});
  assert.deepEqual([craft.x, craft.y], [5, 5]);
  assert.equal(craft.acted, true);
  assert.equal(craft.moved, true);
  assert.equal(craft.origin, null);
  assert.equal(craft.counterCount, 1, "ejection does not refresh counter availability");
  assert.equal(craft.skillUses["RX_78_1/ExitUnit"], 1);
  assert.equal(event.effect, "Light_75_NotAttached");
  assert.ok(G.catalog.sounds[event.sound.asset]);
  assert.equal(G.canUseSkill(game, unit, "ExitUnit"), false);
  assert.equal(G.canUseSkill(game, craft, "ExitUnit"), false);
  const snapshot = JSON.parse(JSON.stringify(game));
  assert.deepEqual(
    snapshot.units.find((u) => u.id === craft.id),
    JSON.parse(JSON.stringify(craft)),
  );
});

test("ejection validates range, occupancy, phase, use count and pending plans before any mutation", () => {
  const { game, unit, enemy } = pair();
  Object.assign(enemy, { x: 5, y: 5 });
  for (const [x, y] of [
    [5, 5],
    [8, 5],
    [-1, 5],
    [4.5, 5],
  ]) {
    const before = JSON.stringify(game);
    assert.throws(() => G.useSkill(game, unit, "ExitUnit", x, y));
    assert.equal(JSON.stringify(game), before);
  }
  for (const patch of [
    { acted: true },
    { hp: 0 },
    { plan: { targetId: enemy.id } },
    { skillUses: { "RX_78_1/ExitUnit": 1 } },
  ]) {
    const copy = JSON.parse(JSON.stringify(game));
    Object.assign(copy.units[0], patch);
    assert.deepEqual(G.skillTargets(copy, copy.units[0], "ExitUnit"), []);
  }
  game.deployment = [false, false];
  assert.equal(G.canUseSkill(game, unit, "ExitUnit"), false);
  game.deployment = null;
  game.team = 1;
  assert.equal(G.canUseSkill(game, unit, "ExitUnit"), false);
  game.team = 0;
  game.winner = 0;
  assert.equal(G.canUseSkill(game, unit, "ExitUnit"), false);
});

test("aircraft crosses ground mountains and water with normal costs while occupancy and space asteroids still block", () => {
  const { game, unit, enemy } = pair();
  game.tiles[5][5] = "water";
  G.useSkill(game, unit, "ExitUnit", 5, 5);
  const craft = game.units.find((u) => u.model === "FF_X7__standard");
  Object.assign(craft, { moved: false, acted: false, x: 1, y: 1 });
  game.tiles = Array.from({ length: 18 }, () => Array(24).fill("rock"));
  game.tiles[1][1] = "plain";
  game.tiles[1][2] = "water";
  assert.equal(G.reachable(game, craft).get("3,1").cost, 2);
  assert.equal(G.reachable(game, { ...craft, model: "RGM_79__machine_gun" }).has("3,1"), false);
  Object.assign(enemy, { x: 3, y: 1 });
  assert.equal(G.reachable(game, craft).has("3,1"), false);
  Object.assign(enemy, { x: 15, y: 10 });
  G.move(game, craft, 3, 1);
  assert.equal(craft.x, 3);
  assert.equal(G.canUndo(game, craft), true);
  G.undo(game, craft);
  game.environment = craft.environment = "space";
  assert.equal(G.reachable(game, craft).has("3,1"), false);
  craft.hp = 100;
  assert.equal(Parts.applyHit(game, craft, G.modelOf(craft), 8000, 100), null);
  assert.deepEqual(craft.brokenParts, {});
});

test("armor-purge configuration restores an added percentage, optionally retains damage, and never spawns a second unit", () => {
  const { game, unit } = pair();
  const skill = structuredClone(G.unitSkills(unit)[0]);
  skill.source = {
    mode: "transform",
    ...result("RGM_79", "machine_gun", {
      hpRecoveryPercent: 35,
      enRecoveryPercent: 35,
    }),
  };
  delete skill.spawn;
  unit.hp = G.modelOf(unit).hp * 0.2;
  unit.en = 25;
  unit.brokenParts = { leftArm: true };
  withSkill(skill, () => {
    SkillSchema.validate([skill]);
    assert.deepEqual(G.skillTargets(game, unit, skill.id), [{ x: 4, y: 5 }]);
    const event = G.useSkill(game, unit, skill.id, 4, 5);
    assert.equal(event.resultId, unit.id);
    assert.equal(game.units.length, 2);
    assert.equal(unit.model, "RGM_79__machine_gun");
    assert.equal(unit.hp, Math.round(G.modelOf(unit).hp * 0.55));
    assert.equal(unit.en, (25 / 900 + 0.35) * G.modelOf(unit).en);
    assert.deepEqual(unit.brokenParts, { leftArm: true });
    assert.equal(unit.shield, 0, "repairing resources does not restore a broken shield arm");
  });
});

test("configuration supports an independent ejected unit while retaining and repairing the original body", () => {
  const { game, unit } = pair();
  const skill = structuredClone(G.unitSkills(unit)[0]);
  skill.source = { mode: "keep", ...result("RX_78_1", "beam_rifle", { repairAllParts: true }) };
  skill.spawn = result("FF_X7", "standard", {
    inheritResources: false,
    hpRecoveryPercent: 25,
    enRecoveryPercent: 50,
    repairAllParts: true,
  });
  unit.hp = 7000;
  unit.en = 10;
  unit.brokenParts = { head: true, leftLeg: true };
  withSkill(skill, () => {
    assert.ok(!G.skillTargets(game, unit, skill.id).some((c) => c.x === unit.x && c.y === unit.y));
    const event = G.useSkill(game, unit, skill.id, 5, 5);
    const craft = game.units.find((u) => u.id === event.resultId);
    assert.equal(game.units.length, 3);
    assert.equal(unit.hp, 7000);
    assert.equal(unit.en, 10);
    assert.deepEqual(unit.brokenParts, {});
    assert.equal(craft.hp, Math.round(G.modelOf(craft).hp * 0.25));
    assert.equal(craft.en, G.modelOf(craft).en * 0.5);
    assert.ok(unit.acted && craft.acted);
    assert.deepEqual(G.skillTargets(game, unit, skill.id), []);
  });
});

test("skill schema rejects implicit recovery, malformed ranges and a disappearing body without a replacement", () => {
  const skill = structuredClone(G.models.RX_78_1__beam_rifle.skills[0]);
  SkillSchema.validate([skill]);
  for (const mutate of [
    (s) => delete s.spawn.repairAllParts,
    (s) => delete s.spawn.hpRecoveryPercent,
    (s) => (s.spawn.enRecoveryPercent = 101),
    (s) => (s.range = -1),
    (s) => (s.maxUses = 0),
    (s) => delete s.spawn,
  ]) {
    const invalid = structuredClone(skill);
    mutate(invalid);
    assert.throws(() => SkillSchema.validate([invalid]));
  }
});

test("available ejection prevents automatic end of a moved, damaged and otherwise exhausted unit's turn", () => {
  const { game, unit } = pair();
  Object.assign(unit, {
    moved: true,
    en: 0,
    brokenParts: { head: true, leftArm: true, rightArm: true, backpack: true },
  });
  assert.equal(G.hasActions(game), true);
  unit.skillUses = { "RX_78_1/ExitUnit": 1 };
  assert.equal(G.hasActions(game), false);
});
