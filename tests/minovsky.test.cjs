const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");

const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((prefab) => prefab.id === id).weaponKits[0].id,
});
const gameWith = (left, right) => {
  const game = G.create(false, 1701, [[entry(left)], [entry(right)]], false, {
    costLimit: 50000,
    unitCostLimit: 10000,
  });
  game.tiles = Array.from({ length: 40 }, () => Array(70).fill("plain"));
  return game;
};

test("native Minovsky dispensers create centered grid fields with EN, AP, cooldown and expiry", () => {
  const game = gameWith("BigTrayClass", "RGM_79"),
    ship = game.units[0],
    skill = G.unitSkills(ship).find((item) => item.type === "minovsky"),
    beforeEn = ship.en,
    beforeAp = ship.actionPoints,
    expectedCenter = G.center(ship);
  assert.equal(skill.radius, 9);
  assert.equal(skill.enCost, 450);
  const event = G.useSkill(game, ship, skill.id, ship.x, ship.y);
  assert.equal(ship.en, beforeEn - 450);
  assert.equal(ship.actionPoints, beforeAp - 2);
  assert.deepEqual({ x: game.minovskyFields[0].x, y: game.minovskyFields[0].y }, expectedCenter);
  assert.equal(event.radius, 9);
  assert(G.minovskyAt(game, ship));
  assert(G.minovskyCells(game).size > 200);
  assert(!G.canUseSkill(game, ship, skill.id));
  G.end(game);
  assert.equal(G.activeMinovskyFields(game).length, 1);
  G.end(game);
  assert.equal(G.activeMinovskyFields(game).length, 1);
  G.end(game);
  assert.equal(G.activeMinovskyFields(game).length, 1);
  G.end(game);
  assert.equal(G.activeMinovskyFields(game).length, 0);
});

test("a defender in particles gains multiplicative evasion and missile/mortar interference", () => {
  const game = gameWith("RX_75", "RGM_79"),
    attacker = game.units[0],
    target = game.units[1],
    model = G.modelOf(attacker),
    cannon = model.weapons.find((weapon) => weapon.category === "cannon"),
    missile = model.weapons.find((weapon) => weapon.category === "missile"),
    mortar = model.weapons.find((weapon) => weapon.special?.type === "mortar");
  Object.assign(attacker, { x: 5, y: 10 });
  Object.assign(target, { x: 10, y: 10, detectedBy: { 0: game.round } });
  const base = Object.fromEntries(
    [
      ["cannon", cannon],
      ["missile", missile],
      ["mortar", mortar],
    ].map(([name, weapon]) => [name, G.estimate(game, attacker, target, weapon).hit]),
  );
  const antiBefore = G.sensors.ranges(target, game).antiDetection || 0;
  game.minovskyFields = [{ id: "test", x: 10, y: 10, radius: 2, expiresRound: game.round + 2 }];
  const field = Object.fromEntries(
    [
      ["cannon", cannon],
      ["missile", missile],
      ["mortar", mortar],
    ].map(([name, weapon]) => [name, G.estimate(game, attacker, target, weapon).hit]),
  );
  const evasionAdjusted = (hit) => Math.max(0, 100 - (100 - hit) * 1.25);
  assert.equal(field.cannon, evasionAdjusted(base.cannon));
  assert.equal(field.missile, evasionAdjusted(base.missile) * 0.75);
  assert.equal(field.mortar, evasionAdjusted(base.mortar) * 0.75);
  assert.equal(G.sensors.ranges(target, game).antiDetection, antiBefore + 5);
  game.minovskyFields[0].x = attacker.x;
  assert.equal(
    G.estimate(game, attacker, target, cannon).hit,
    base.cannon,
    "the attacker being inside does not grant a defensive bonus to a target outside",
  );
});

test("both Guntanks expose one native mortar skill in their standard kit", () => {
  for (const id of ["RX_75", "RX_75R"]) {
    const model = Object.values(G.models).find(
      (candidate) => candidate.prefabId === id && candidate.kitId === "standard",
    );
    const mortars = model.weapons.filter((weapon) => weapon.special?.type === "mortar");
    assert.equal(mortars.length, 1, id);
    assert.deepEqual([mortars[0].min, mortars[0].max], [5, 8], id);
    assert.equal(mortars[0].en, 200, id);
    assert.equal(mortars[0].attack.strikes.length, 8, id);
  }
});
