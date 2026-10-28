const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const models = Object.entries(G.models).filter(([,m]) => m.weapons.some(w => w.pilotRequirements?.some(r => r.stat === "melee"))).map(([modelId,m]) => ({...m,modelId}));
function unit(model, value = 200) {
  return { id: "pilot-test", model: model.modelId, hp: model.hp, en: 100000, shield: 10000,
    x: 10, y: 10, pilot: { stats: { shooting: 100, melee: value, defense: 100,
      speed: 100, accuracy: 100, reaction: 100, leadership: 80, awakening: 60 } } };
}
test("all native pilot weapons enforce strict source thresholds and remain in every compatible kit", () => {
  const unique = new Set();
  for (const model of models) for (const w of model.weapons.filter(w => w.pilotRequirements?.some(r => r.stat === "melee"))) {
    unique.add(model.prefabId + "/" + w.id);
    const threshold = model.prefabId === "RX_81AS" ? 165 : 145;
    assert.deepEqual(w.pilotRequirements, [{ stat: "melee", operator: ">", value: threshold }]);
    const u = unit(model, threshold);
    assert.equal(G.canUse(u, w), false, model.id + "/" + w.id);
    u.pilot.stats.melee++;
    assert.equal(G.canUse(u, w), true, model.id + "/" + w.id);
    u.pilot.stats.melee = 90;
    assert.equal(G.canUse(u, w), false);
  }
  assert.equal(unique.size, 30);
});
test("pilot gates cannot bypass shield, energy or broken native arms", () => {
  for (const model of models) for (const w of model.weapons.filter(w => w.pilotRequirements?.some(r => r.stat === "melee"))) {
    const u = unit(model);
    if (w.requiresShield) {
      u.shield = 0;
      assert.equal(G.canUse(u, w), false);
      u.shield = 10000;
    }
    u.en = 0;
    if (w.en > 0) assert.equal(G.canUse(u, w), false);
    u.en = 100000;
    u.brokenParts = { leftArm: true, rightArm: true };
    assert.equal(G.canUse(u, w), false, model.id + "/" + w.id);
  }
});
test("attack and counter planning share actual assigned-pilot eligibility", () => {
  const m = models.find(m => m.prefabId === "RX_78_2");
  const g = G.create(false, 1, [[{unitId:m.prefabId,kitId:m.kitId}],
    [{unitId:"RGM_79",kitId:"machine_gun"}]], false, {costLimit:99999,unitCostLimit:10000});
  g.tiles.forEach(row => row.fill("plain"));
  const [u, target] = g.units;
  Object.assign(u, unit(m,145), {id:u.id,team:0});
  Object.assign(target,{x:11,y:10});
  const w = m.weapons.find(w => w.pilotRequirements);
  assert.equal(G.canAttack(g,u,target,w),false);
  assert.equal(G.canCounter(g,u,target,w),false);
  assert.throws(() => G.attackQueue(g,u,target,[w]));
  assert.throws(() => G.counterQueue(g,u,target,[w]));
  u.pilot.stats.melee = 146;
  assert.equal(G.canAttack(g,u,target,w),true);
  assert.equal(G.canCounter(g,u,target,w),true);
  assert.doesNotThrow(() => G.attackQueue(g,u,target,[w]));
  assert.doesNotThrow(() => G.counterQueue(g,u,target,[w]));
});
