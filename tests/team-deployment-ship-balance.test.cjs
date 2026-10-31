const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
function fixture() {
  const entry = { unitId: "Type61", kitId: "standard" };
  const game = G.create(false, 17, [[entry], [entry], [entry], [entry]], false, {
    mapId: "crossroads_2v2",
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  game.deployment = [false, false, false, false];
  game.tiles.forEach((row) => row.fill("plain"));
  return game;
}
test("teammates share all friendly deployment zones but retain unit control and enemy boundaries", () => {
  const game = fixture(),
    [actor, , ally] = game.units,
    map = G.getMap(game.mapId),
    area = map.deploymentAreas[2],
    destination = { x: area.x + 3, y: area.y + 3 };
  assert(
    G.deploymentCells(game, 0, actor).some(
      (cell) => cell.x === destination.x && cell.y === destination.y,
    ),
  );
  assert.deepEqual(
    new Set(G.deploymentCells(game, 0).map((cell) => G.key(cell.x, cell.y))),
    new Set(G.deploymentCells(game, 2).map((cell) => G.key(cell.x, cell.y))),
  );
  G.deploy(game, 0, actor.id, destination.x, destination.y);
  assert.equal(actor.y, destination.y);
  assert.throws(() => G.deploy(game, 0, ally.id, destination.x + 1, destination.y));
  const enemy = map.deploymentAreas[1];
  assert.throws(() => G.deploy(game, 0, actor.id, enemy.x + 3, enemy.y + 3));
  assert.throws(() => G.deploy(game, 2, ally.id, destination.x, destination.y));
  G.confirmDeployment(game, 0);
  assert.throws(() => G.deploy(game, 0, actor.id, destination.x + 1, destination.y));
});
test("shared deployment still requires every ship footprint cell to remain inside friendly zones", () => {
  const game = fixture(),
    actor = game.units[0];
  actor.model = "MusaiClass__standard";
  actor.hp = G.modelOf(actor).hp;
  const area = G.getMap(game.mapId).deploymentAreas[2];
  G.deploy(game, 0, actor.id, area.x + 3, area.y + 3);
  assert.throws(() => G.deploy(game, 0, actor.id, area.x + area.width - 1, area.y + 3));
});
test("all ship hulls and weapon payloads use native baselines and the unified 75 percent policy", () => {
  for (const prefab of G.catalog.prefabs.filter(p => p.stats.ship)) {
    const federation = prefab.tags.includes("EFSF");
    assert.equal(prefab.stats.hp,Math.max(500,Math.round(prefab.sourceStats.hp * .7 * (federation ? 1.1 : 1) / 500) * 500),prefab.id);
    assert.equal(prefab.stats.mobility,Number((prefab.sourceStats.reaction * (federation ? 1.15 : 1)).toFixed(6)),prefab.id);
    for (const weapon of Object.values(prefab.weapons)) {
      assert.equal(weapon.shipDamageMultiplier,.75);
      for(const payload of [weapon,...weapon.attack.steps]) {
        const baseline=payload.shipDamageBeforeReduction;
        for(const [channel,value] of Object.entries(baseline.damageComponents || {}))
          assert.equal(payload.damageComponents[channel],Math.round(value * .75 / 25)*25,prefab.id);
      }
    }
    for(const model of Object.values(G.models).filter(m=>m.prefabId === prefab.id)) {
      assert.equal(model.hp,prefab.stats.hp);
      assert.equal(model.accuracy,Number((prefab.sourceStats.accuracy*.65*(federation ? 1.1 : 1)).toFixed(6)));
    }
  }
});
