const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");

function fixture(mode = "campaign", count = 1) {
  const entry = { unitId: "Type61", kitId: "standard" };
  const game = G.create(false, 84, [[entry], [entry]], false, { costLimit: 99999, unitCostLimit: 99999 });
  game.tiles = Array.from({ length: 28 }, () => Array(40).fill("plain"));
  const source = game.units[0], enemy = game.units[1];
  G.models.objective_routing_tank = { ...G.modelOf(source), move: 5, weapons: [] };
  const units = Array.from({ length: count }, (_, i) => ({ ...source, id: "ally-" + i,
    model: "objective_routing_tank", ownerSeat: 0, x: 7, y: 9 + i, moved: false, acted: false }));
  Object.assign(enemy, { x: 33, y: 12, model: "objective_routing_tank" });
  game.units = [...units, enemy]; game.team = 0; game.fogMode = "full";
  const post = { id: "post", kind: "outpost", x: 25, y: 12, owner: 1 };
  if (mode === "campaign") game.campaignBattlefield = {
    layout: { nodes: [{ id: "base", kind: "base", x: 34, y: 12 }, post], gates: [], links: [] },
    owners: { base: 1, post: 1 }, adjacentOwners: {}, defender: 1, version: 1,
  };
  else game.battlefield = { points: [post] };
  return { game, units, unit: units[0], enemy, post };
}
const strategy = (game, unit) => G.aiTactics.forUnit(G, game, unit, G.aiTactics.decide(G, game, unit));

for (const mode of ["campaign", "battlefield"]) {
  test(`${mode}: another player's nearby unit does not reserve the AI's occupation mission`, () => {
    const { game, units, post } = fixture(mode, 2);
    Object.assign(units[1], { ownerSeat: 2, x: post.x - 1, y: post.y });
    const own = strategy(game, units[0]);
    assert.equal(own.occupation, true);
    assert.equal(own.goal.id, post.id);
    const other = strategy(game, units[1]);
    assert.notEqual(other.goal.id, post.id, "two AI controllers do not duplicate a reserved mission");
  });

  test(`${mode}: only capable squads receive occupation missions, others keep advancing`, () => {
    const { game, units, enemy, post } = fixture(mode, 5);
    const air = units[4]; air.model = Object.keys(G.models).find((id) => id.startsWith("FF_B2__"));
    const decisions = units.map((unit) => strategy(game, unit));
    assert.equal(decisions.filter((d) => d.occupation && d.goal.id === post.id).length, 1);
    assert(!decisions[4].occupation);
    assert.equal(decisions[4].goal.id, enemy.id);
    assert(decisions.every((d) => d.state === "advance"));
    for (const unit of units) {
      const move = G.aiChoice(game, unit);
      assert(move && (move.x !== unit.x || move.y !== unit.y), unit.id + " must advance");
      assert(G.reachable(game, unit).has(G.key(move.x, move.y)));
    }
  });

  test(`${mode}: sustained detours reach the post instead of oscillating at a wall`, () => {
    const { game, unit, post } = fixture(mode);
    unit.x = 13; unit.y = 12;
    const mountain = G.terrain.mountain;
    G.terrain.mountain = { ...mountain, cost: Infinity };
    for (let y = 3; y < 25; y++) game.tiles[y][14] = "mountain";
    try {
      let arrived = false;
      for (let turn = 0; turn < 18; turn++) {
        game.round++;
        const move = mode === "battlefield" ? G.battlefieldMode.aiChoice(G, game, unit) : G.aiChoice(game, unit);
        assert(move && G.reachable(game, unit).has(G.key(move.x, move.y)));
        Object.assign(unit, { x: move.x, y: move.y });
        if (Math.max(Math.abs(unit.x - post.x), Math.abs(unit.y - post.y)) <= (mode === "battlefield" ? 2 : 1)) {
          arrived = true; break;
        }
      }
      assert(arrived, "must finish the detour, not return to the wall each turn");
    } finally { G.terrain.mountain = mountain; }
  });

  test(`${mode}: an inaccessible island post does not trap ground units at the shoreline`, () => {
    const { game, unit, post } = fixture(mode);
    G.models.objective_routing_tank.adaptability = { ...G.models.objective_routing_tank.adaptability, water: 0 };
    post.x = 20;
    for (let y = 0; y < game.tiles.length; y++) game.tiles[y][14] = "water";
    const reachable = { ...post, id: "reachable", x: 5, y: 22 };
    if (mode === "campaign") {
      game.campaignBattlefield.layout.nodes.push(reachable);
      game.campaignBattlefield.owners.reachable = 1;
    } else game.battlefield.points.push(reachable);
    // Force the nearer mission onto the isolated island.
    unit.x = 12; unit.y = 12;
    const before = Math.abs(unit.x - reachable.x) + Math.abs(unit.y - reachable.y);
    const move = G.aiChoice(game, unit);
    assert(move && move.x < 14 && Math.abs(move.x - reachable.x) + Math.abs(move.y - reachable.y) < before);
    assert(G.reachable(game, unit).has(G.key(move.x, move.y)));
  });
}

test("battlefield combat units approach a blocked 3x3 enemy base footprint", () => {
  const { game, unit, enemy } = fixture("battlefield");
  game.battlefield.points = [];
  // Reuse an actual facility's footprint and controller rather than a passable point.
  const battle = G.create(false, 1, Array(12).fill(null), false, { mode: "battlefield", mapId: G.battlefieldMode.defaultMapId });
  const base = battle.units.find((other) => other.team === 1 && other.facility?.type === "base");
  Object.assign(enemy, base, { x: 27, y: 12 });
  for (let i = 0; i < 10; i++) {
    game.round++;
    const move = G.aiChoice(game, unit);
    assert(move && G.reachable(game, unit).has(G.key(move.x, move.y)));
    Object.assign(unit, { x: move.x, y: move.y });
  }
  assert(G.dist(unit, enemy) <= 1, "large blocked target must have reachable approach seeds");
});

test("campaign base and post supply stops for living hostiles and resumes after they leave", () => {
  for (const kind of ["base", "outpost"]) {
    const { game, unit, enemy } = fixture();
    const node = { id: "site", kind, x: 15, y: 12 };
    game.campaignBattlefield.layout = { nodes: [node], gates: [], links: [] };
    game.campaignBattlefield.owners = { site: 0 };
    // Outposts need a connected friendly source.
    if (kind === "outpost") {
      game.campaignBattlefield.layout.nodes.push({ id: "base", kind: "base", x: 2, y: 2 });
      game.campaignBattlefield.owners.base = 0;
      game.campaignBattlefield.layout.links.push({ a: "site", b: "base" });
    }
    Object.assign(unit, { x: 14, y: 12, hp: 1, en: 0 });
    Object.assign(enemy, { x: 16, y: 12 });
    G.campaignBattlefield.heal(G, game);
    assert.equal(unit.hp, 1); assert.equal(unit.en, 0);
    enemy.x = 20;
    G.campaignBattlefield.heal(G, game);
    assert(unit.hp > 1 && unit.en > 0);
    unit.hp = 1; unit.en = 0; enemy.x = 16; enemy.hp = 0;
    G.campaignBattlefield.heal(G, game);
    assert(unit.hp > 1 && unit.en > 0, "dead hostiles must not interrupt supply");
  }
});

test("battlefield supply checks each whole control zone independently, including airborne enemies", () => {
  const battle = G.create(false, 1, Array(12).fill(null), false, { mode: "battlefield", mapId: G.battlefieldMode.defaultMapId });
  const { game, unit, enemy } = fixture("battlefield");
  const base = { ...battle.units.find((other) => other.team === 0 && other.facility?.type === "base"), x: 15, y: 12 };
  const point = game.battlefield.points[0]; point.owner = 0; point.x = 28; point.y = 12;
  const distant = { ...unit, id: "distant", x: 27, y: 12, hp: 1, en: 0 };
  game.units.push(base, distant);
  Object.assign(unit, { x: 12, y: 13, hp: 1, en: 0 });
  Object.assign(enemy, { x: 20, y: 13, flying: true });
  G.battlefieldMode.heal(G, game);
  assert.equal(unit.hp, 1); assert.equal(unit.en, 0);
  assert(distant.hp > 1 && distant.en > 0, "another uncontested post still supplies");
  enemy.x = 21;
  G.battlefieldMode.heal(G, game);
  assert(unit.hp > 1 && unit.en > 0, "outside the circular base control zone does not block");
  distant.hp = 1; distant.en = 0; enemy.x = 30; enemy.y = 14;
  G.battlefieldMode.heal(G, game);
  assert.equal(distant.hp, 1); assert.equal(distant.en, 0, "post corners are in the square control zone");
});
