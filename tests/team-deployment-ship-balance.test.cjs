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
test("Musai and Falmer hulls and beam payloads are reduced 15 percent with ceiling rounding to multiples of 500", () => {
  for (const [id, hp, beam] of [
    ["MusaiClass", 59000, 4500],
    ["FalmerClass", 69500, 4000],
  ]) {
    const prefab = G.catalog.prefabs.find((prefab) => prefab.id === id);
    assert.equal(prefab.stats.hp, hp);
    const weapon = Object.values(prefab.weapons).find((weapon) => weapon.type === "beam");
    assert.equal(weapon.damagePerShot, beam);
    assert.equal(weapon.damageComponents.beam, beam);
    for (const step of weapon.attack.steps)
      if (step.damageComponents) assert.equal(step.damageComponents.beam, beam);
    for (const model of Object.values(G.models).filter((model) => model.prefabId === id))
      assert.equal(model.hp, hp);
    const shell = Object.values(prefab.weapons)
      .filter((weapon) => weapon.type === "shell")
      .map((weapon) => weapon.damagePerShot);
    assert.deepEqual(shell, [1000, 1250]);
  }
});
