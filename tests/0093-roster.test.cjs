const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  E = require("../shared/economy.js"),
  D = require("../shared/development.js");
const production = require("../shared/production-data.cjs");
const roster = [
  "RGM_89",
  "AMS_119",
  "RGZ_91",
  "RGZ_91B",
  "MSN_03",
  "MSN_04",
  "RX_93",
  "RX_93_Test",
];
const entry = (id) => ({
  unitId: id,
  kitId: G.catalog.prefabs.find((p) => p.id === id).defaultKit,
});
function battle(id) {
  const prefab = G.catalog.prefabs.find((p) => p.id === id);
  const g = G.create(
    false,
    2718,
    [[entry(prefab.formOnly ? prefab.formOf : id)], [entry("RGM_79")]],
    false,
    { costLimit: 99999, unitCostLimit: 99999, fogMode: "disabled" },
  );
  g.deployment = null;
  g.tiles.forEach((row) => row.fill("plain"));
  Object.assign(g.units[0], { x: 8, y: 8 });
  Object.assign(g.units[1], { x: 13, y: 8 });
  if (prefab.formOnly) {
    const model = id + "__" + prefab.defaultKit;
    Object.assign(g.units[0], { model, hp: G.models[model].hp, en: G.models[model].en });
  }
  return g;
}
test("0093 roster is faction/era tagged, grantable counted stock without research or permit sales", () => {
  for (const id of roster) {
    const p = G.catalog.prefabs.find((p) => p.id === id);
    assert.equal(p.source.split("/")[0], "GW_BattleUniverse_DLC_0093");
    assert.deepEqual(p.tags, [
      id.startsWith("AMS") || id.startsWith("MSN") ? "NEO_ZEON" : "EFSF",
      "0093T1",
    ]);
    assert(!p.formOnly);
    assert.equal(p.production.enabled, false);
    assert(G.models[production.baseModels[id]]);
    assert.equal(E.licenseOffer(id), null);
    assert(!E.purchaseLicense(id, "PMC"));
    assert(!D.allows("PMC", id));
    assert.deepEqual(E.normalizeStock({ inventory: { [id]: 2 } }).inventory, { [id]: 2 });
    assert.equal(G.stockPlan([entry(id)], { inventory: { [id]: 1 } }).missing.length, 0);
  }
});
test("MK-II Flying Armor uses native air compatibility instead of 25% ground movement", () => {
  const g = battle("RX_178_AEUG_FlyingArmor"),
    u = g.units[0],
    m = G.modelOf(u, g);
  assert.equal(m.movementType, "air");
  assert.equal(G.environmentOf(g, u), "air");
  assert.equal(G.adaptationOf(g, u), 1);
  assert(m.move >= 6);
  assert(
    [...G.reachable(g, u).values()].some(
      (cell) => Math.abs(cell.x - u.x) + Math.abs(cell.y - u.y) >= 6,
    ),
  );
});
test("new 0093 beam cannons carry segmented artwork and the actual damage projectile speed", () => {
  for (const [id, key, speed] of [
    ["RGZ_91", "EF_RGZ_91_BWS_HighBeamCannon", 75],
    ["RGZ_91B", "EF_RGZ_91B_HighBeamCannon", 75],
    ["MSN_04", "NZN_MSN_04_HighBeamCannon", 75],
  ]) {
    const w = Object.values(G.models)
      .filter((m) => m.prefabId === id)
      .flatMap((m) => m.weapons)
      .find((w) => w.id === key);
    assert(w);
    assert.equal(w.nativePayload.ProjectileSpeed, speed);
    assert.equal(w.projectile.speed, speed * 0.1);
    assert.equal(w.projectile.sequence.segments.length, 3);
    assert.equal(w.projectile.sequence.color, id === "MSN_04" ? "Green" : "Yellow");
    assert(w.projectile.sequence.segments.every((s) => s.frames === 16 && s.asset));
  }
});
test("0093 combat loads valid firing chains and resolves with server authority", () => {
  for (const id of roster) {
    const g = battle(id),
      [u, target] = g.units;
    target.x = 11;
    // Test actual native firing sequences without part RNG ending the fixture prematurely.
    const m = G.modelOf(target);
    G.models.roster_target = {
      ...m,
      hp: 1000000,
      partsBreakable: false,
      modules: [],
      shield: { hp: 0 },
      weapons: [],
    };
    Object.assign(target, { model: "roster_target", hp: 1000000, shield: 0 });
    const weapon = G.automaticWeapons(g, u, target)[0];
    assert(weapon, id + " has a ranged weapon");
    const before = u.en;
    let sequence = 0;
    const battles = G.resolveAutomatic(
      { game: g, matchId: "0093" },
      [
        {
          intent: {
            attacker: u.id,
            target: target.id,
            targetSquad: [target.id],
            weapon: weapon.id,
            weapons: [weapon.id],
          },
          response: "defend",
        },
      ],
      () => String(++sequence),
    );
    assert(battles.length, id);
    assert(u.en <= before);
    assert(target.hp < 1000000, id);
  }
});
test("Re-GZ Custom transforms both ways without healing; BWS ejection retains its native recovery", () => {
  for (const [id, target] of [
    ["RGZ_91B", "RGZ_91B_MA"],
    ["RGZ_91B_MA", "RGZ_91B"],
    ["RGZ_91_MA", "RGZ_91"],
  ]) {
    const g = battle(id),
      u = g.units[0];
    u.hp = Math.floor(u.hp * 0.5);
    u.en = Math.floor(u.en * 0.5);
    const skill = G.unitSkills(u).find((s) => s.source?.unitId === target);
    assert(skill, id);
    assert.equal(skill.source.inheritResources, true);
    assert.equal(skill.source.hpRecoveryPercent, id === "RGZ_91_MA" ? 35 : 0);
    G.useSkill(g, u, skill.id, u.x, u.y);
    assert.equal(G.modelOf(u).prefabId, target);
  }
});
