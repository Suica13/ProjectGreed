const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  G = require("../shared/rules"),
  { createAttackPlanner } = require("../shared/attack-plans");

const entry = (id, kitId = null) => {
  const prefab = G.catalog.prefabs.find((candidate) => candidate.id === id);
  return { unitId: id, kitId: kitId || prefab.weaponKits[0].id };
};
function gameWith(left, right) {
  const game = G.create(false, 8128, [[entry(left)], [entry(right)]], false, {
    costLimit: 50000,
    unitCostLimit: 10000,
  });
  game.tiles = Array.from({ length: 40 }, () => Array(70).fill("plain"));
  Object.assign(game.units[0], { x: 5, y: 10 });
  Object.assign(game.units[1], { x: 8, y: 10 });
  return game;
}

test("supply providers expose one automatic aura without duplicate display mechanics", () => {
  for (const id of ["Type74", "BigTrayClass", "ColumbusClass", "MusaiClass"]) {
    const prefab = G.catalog.prefabs.find((candidate) => candidate.id === id);
    assert(prefab.stats.supplyAura, id);
    assert.equal(
      prefab.mechanics.filter((mechanic) => /^(?:SupplyPoint|AutoRepair)/.test(mechanic.id)).length,
      0,
      id,
    );
  }
});

test("LPC is pilot experience rather than a second escape skill", () => {
  const prefab = G.catalog.prefabs.find((candidate) => candidate.id === "RX_77_2");
  assert.equal(prefab.skills.filter((skill) => skill.type === "escape").length, 1);
  const lpc = prefab.mechanics.find((mechanic) => mechanic.id === "LPC");
  assert.equal(lpc.status, "not_applicable");
  assert.match(lpc.name, /1\.1/);
});

test("Pixy native stealth and anti-detection tags affect team radar", () => {
  const game = gameWith("RGM_79", "RX_78XX"),
    [observer, pixy] = game.units,
    sensors = G.models[pixy.model].sensors;
  Object.assign(observer, { x: 3, y: 10 });
  Object.assign(pixy, { x: 9, y: 10 });
  assert.equal(sensors.stealth, true);
  assert.equal(sensors.antiDetect, true);
  assert.equal(G.sensors.detected(game, observer.team, pixy), false);
  const saved = { stealth: sensors.stealth, antiDetect: sensors.antiDetect };
  sensors.stealth = false;
  sensors.antiDetect = false;
  try {
    assert.equal(G.sensors.detected(game, observer.team, pixy), true);
  } finally {
    Object.assign(sensors, saved);
  }
});

test("actionable reconnaissance skills do not retain duplicate provenance cards", () => {
  for (const id of ["Type74Kai", "Dash", "RB_79M", "Luggun", "MS_06E"]) {
    const prefab = G.catalog.prefabs.find((candidate) => candidate.id === id);
    const skillIds = new Set(
      prefab.skills
        .filter((skill) => ["Common_DetectArea", "Common_CameraGun"].includes(skill.id))
        .map((skill) => skill.id),
    );
    assert(skillIds.size, id);
    assert.equal(
      prefab.mechanics.filter((mechanic) =>
        [
          "special_Common_DetectArea",
          "Common_DetectArea",
          "special_Common_CameraGun",
          "Common_CameraGun",
        ].includes(mechanic.id),
      ).length,
      0,
      id,
    );
  }
});

test("hover movement and its ground loop are presented as one mechanic", () => {
  for (const id of ["Type74", "MiniTrayClass", "BigTrayClass", "RX_79_BD_1_EXAM"]) {
    const prefab = G.catalog.prefabs.find((candidate) => candidate.id === id);
    const hover = prefab.mechanics.filter((mechanic) =>
      /Hover|气垫/.test((mechanic.id || "") + " " + (mechanic.name || "")),
    );
    assert.equal(hover.length, 1, id);
    assert.equal(hover[0].id, "movement", id);
    assert.match(hover[0].name, /横越水域.*地面移动时循环/, id);
  }
});

test("explosive reactive armor applies an extra final 25 percent shell reduction", () => {
  const game = gameWith("RGM_79", "RX_78NT_1_FA"),
    [attacker, defender] = game.units,
    model = G.models[defender.model],
    weapon = G.modelOf(attacker).weapons.find((item) => item.type === "shell");
  assert.equal(model.shellFinalResistance, 25);
  const protectedDamage = G.estimate(game, attacker, defender, weapon).damage;
  model.shellFinalResistance = 0;
  try {
    const ordinaryDamage = G.estimate(game, attacker, defender, weapon).damage;
    assert(Math.abs(protectedDamage - ordinaryDamage * 0.75) <= weapon.shotCount + 1);
  } finally {
    model.shellFinalResistance = 25;
  }
});

test("OverBoost persists while embarked and drains on the next own turn", () => {
  const game = G.create(
      false,
      8128,
      [[entry("EMS_10"), entry("SamsonGroundTransportTruck")], [entry("RGM_79")]],
      false,
      { costLimit: 50000, unitCostLimit: 10000 },
    ),
    unit = game.units[0],
    carrier = game.units[1],
    skill = G.unitSkills(unit).find((candidate) => candidate.type === "overboost"),
    base = G.modelOf(unit),
    hp = unit.hp;
  game.tiles = Array.from({ length: 40 }, () => Array(70).fill("plain"));
  G.useSkill(game, unit, skill.id, unit.x, unit.y);
  assert.equal(G.modelOf(unit).move, base.move + 3);
  assert.equal(G.modelOf(unit).mobility, base.mobility * 1.15);
  unit.embarked = { carrierId: carrier.id, hangarId: "hangar_1" };
  G.end(game);
  assert.equal(unit.hp, hp, "activation turn does not drain");
  G.end(game);
  G.end(game);
  assert.equal(unit.hp, hp - Math.round((base.hp * 25) / 100));
  assert(unit.overBoost);
});

test("FullBoost lasts two own turns while embarked and cools down after expiry", () => {
  const game = G.create(
      false,
      8128,
      [[entry("MS_11"), entry("SamsonGroundTransportTruck")], [entry("RGM_79")]],
      false,
      { costLimit: 50000, unitCostLimit: 10000 },
    ),
    unit = game.units[0],
    carrier = game.units[1],
    skill = G.unitSkills(unit).find((candidate) => candidate.type === "fullboost"),
    base = G.modelOf(unit),
    en = unit.en,
    actionPoints = unit.actionPoints;
  assert.equal(skill.maxUses, undefined);
  game.tiles = Array.from({ length: 40 }, () => Array(70).fill("plain"));
  G.useSkill(game, unit, skill.id, unit.x, unit.y);
  assert.equal(unit.en, en - 250);
  assert.equal(unit.actionPoints, actionPoints);
  assert.equal(G.modelOf(unit).move, base.move + 2);
  assert.equal(G.modelOf(unit).mobility, base.mobility * 1.1);
  unit.embarked = { carrierId: carrier.id, hangarId: "hangar_1" };
  G.end(game);
  assert.equal(unit.fullBoost.remaining, 1);
  G.end(game);
  assert.equal(G.modelOf(unit).move, base.move + 2);
  G.end(game);
  assert.equal(unit.fullBoost, undefined);
  G.end(game);
  delete unit.embarked;
  assert.equal(G.canUseSkill(game, unit, skill.id), false, "the next own turn is cooldown");
  G.end(game);
  G.end(game);
  assert.equal(G.canUseSkill(game, unit, skill.id), true);
});

test("infantry squad members share one synchronized salvo", () => {
  for (const id of ["Army_Squad_EFSF_0079_N_G_A", "Army_Squad_ZEON_0079_N_G_A"]) {
    const model = Object.values(G.models).find((candidate) => candidate.prefabId === id);
    assert.equal(model.weapons.length, 1, id);
    const weapon = model.weapons[0];
    assert.equal(weapon.pairedChannels.length, 8, id);
    assert.equal(weapon.attack.strikes.filter((strike) => strike.at === 0).length, 8, id);
  }
});

test("MS-06C nuclear bombardment is a one-use ground skill", () => {
  const game = gameWith("MS_06C", "RGM_79"),
    [attacker, defender] = game.units,
    weapon = G.modelOf(attacker).weapons.find((item) => item.special?.type === "nuke");
  assert(weapon);
  assert.equal(weapon.maxUses, 1);
  assert.equal(weapon.special.radius, 3);
  assert(G.canUse(attacker, weapon));
  G.fight(game, attacker, defender, weapon, "defend", null, false);
  assert.equal(attacker.weaponUses[weapon.id], 1);
  assert.equal(G.canUse(attacker, weapon), false);
});

test("nuclear ground targeting expands one paid use across all ground victims in radius", () => {
  const game = G.create(
      false,
      991,
      [[entry("MS_06C")], [entry("RGM_79"), entry("RGM_79")]],
      false,
      { costLimit: 50000, unitCostLimit: 10000 },
    ),
    attacker = game.units[0],
    victims = game.units.slice(1),
    weapon = G.modelOf(attacker).weapons.find((item) => item.special?.type === "nuke"),
    room = { game };
  game.tiles = Array.from({ length: 40 }, () => Array(70).fill("plain"));
  Object.assign(attacker, { x: 5, y: 10 });
  Object.assign(victims[0], { x: 8, y: 10 });
  Object.assign(victims[1], { x: 9, y: 10 });
  const planner = createAttackPlanner(
    G,
    (() => {
      let id = 0;
      return () => "nuke-" + ++id;
    })(),
  );
  planner.reset(room);
  const beforeEn = attacker.en,
    beforeHp = victims.map((unit) => unit.hp),
    ground = G.groundTarget(game, attacker, 8, 10);
  planner.plan(room, attacker, ground, weapon, 0);
  planner.prepare(room);
  assert.equal(room.reactions.length, 2);
  while (room.reactions.length) planner.choose(room, room.reactions[0].id, "defend");
  const battles = planner.resolve(room);
  assert.equal(battles.length, 2);
  assert.equal(attacker.en, beforeEn - weapon.en);
  assert.equal(attacker.weaponUses[weapon.id], 1);
  assert.equal(new Set(battles.map((battle) => battle.b)).size, 2);
  assert(battles.every((battle) => battle.events[0].strikes.some((strike) => strike.executed)));
});

test("formation UI provides environment badges/filter and omits the cargo arrow", () => {
  const source = fs.readFileSync("client/formation.js", "utf8");
  assert.match(source, /formationEnvironment/);
  assert.match(source, /unit-summary-tag/);
  assert.doesNotMatch(source, /entry\.preload \? "\u2192 "/);
});
