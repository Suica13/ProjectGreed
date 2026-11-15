const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const Conversion = require("../shared/conversion-rules.cjs");
const Codec = require("../tools/weapon-store.cjs");
const Adjustments = require("../shared/catalog-adjustments.cjs");
const { applyWeaponBalance } = require("../tools/weapon-balance.cjs");

test("every MA uses the reduced HP baseline before editor offsets, including kits", () => {
  const rules = Conversion.read();
  const library = require("../assets/weapons.json").definitions;
  const adjustments = Adjustments.read();
  let count = 0;
  for (const prefab of G.catalog.prefabs.filter(p => p.unitTags?.includes("MA"))) {
    const raw = Codec.expandPrefab(require(`../assets/units/${prefab.id}/unit.json`), library);
    const expected = Math.max(1, Math.ceil(raw.stats.hp * rules.units.hp * 0.75));
    applyWeaponBalance(raw, rules);
    assert.equal(raw.stats.hp, expected, prefab.id);
    const snapshot = structuredClone(raw);
    applyWeaponBalance(raw, rules);
    assert.deepEqual(raw, snapshot, prefab.id + " repeated conversion");
    const finalHP = expected + (adjustments.units[prefab.id]?.["/stats/hp"] ?? 0);
    assert.equal(prefab.stats.hp, finalHP, prefab.id + " final HP");
    for (const kit of prefab.weaponKits)
      assert.equal(G.models[prefab.id + "__" + kit.id].hp, finalHP, prefab.id + " kit HP");
    count++;
  }
  assert(count >= 10);
  const normal = { stats: { hp: 10000 }, unitTags: ["MS"], weapons: {}, skills: [] };
  Conversion.globals(normal, rules);
  assert.equal(normal.stats.hp, 10000);
});

test("battlefield splits formations evenly without separating squad members", () => {
  const entry = { unitId: "Type61", kitId: "standard" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  const [source, enemy] = game.units;
  const allies = Array.from({ length: 8 }, (_, i) => ({ ...source,
    id: "split-" + i, squadId: "squad-" + Math.floor(i / 2), x: 5, y: 5 + i,
  }));
  Object.assign(enemy, { x: 35, y: 10, facility: { type: "base" } });
  game.units = [...allies, enemy];
  game.battlefield = { points: [{ id: "post", x: 12, y: 10, owner: 1 }] };
  const decisions = allies.map(unit => G.aiTactics.forUnit(G, game, unit, G.aiTactics.decide(G, game, unit)));
  assert.equal(decisions.filter(d => d.occupation).length, 4);
  assert.equal(decisions.filter(d => d.goal.id === enemy.id).length, 4);
  for (let i = 0; i < allies.length; i += 2)
    assert.equal(decisions[i].goal.id, decisions[i + 1].goal.id);
});
