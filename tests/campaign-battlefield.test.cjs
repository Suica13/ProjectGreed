const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  C = require("../shared/campaign.js");
const B = G.campaignBattlefield;
const scenario = G.catalog.scenarios.earth_0079_mid;
const ctx = {
  G,
  world: scenario.world,
  production: require("../shared/production-data.cjs"),
  development: require("../shared/development.js"),
};
function fixture() {
  const state = C.create(ctx, [{ seat: 0 }, { seat: 1 }]);
  const mapId = scenario.regions.canada_east.mapId;
  const formations = Array(10).fill(null);
  formations[0] = [{ unitId: "Type61", kitId: ctx.production.defaultKits.Type61 }];
  formations[1] = [{ unitId: "MS_06F", kitId: ctx.production.defaultKits.MS_06F }];
  const game = G.create(false, 1, formations, false, G.campaignRoomSettings({ mapId }));
  game.campaignBattlefield = B.create(G, state, "canada_east");
  return {
    state,
    game,
    unit: game.units[0],
    enemy: game.units[1],
    field: game.campaignBattlefield,
  };
}
test("all 43 regions reference editable 5v5 maps with one base, six posts and correctly directed neighbor gates", () => {
  assert.equal(Object.keys(scenario.regions).length, 43);
  for (const region of scenario.world.regions) {
    const entry = scenario.regions[region.id],
      map = G.getMap(entry.mapId),
      layout = entry.layout;
    assert.equal(map.playersPerTeam, 5);
    assert.equal(map.width, 57);
    assert.equal(map.height, 68);
    assert.equal(map.spawns.length, 10);
    assert.equal(layout.nodes.filter((n) => n.kind === "base").length, 1);
    assert.equal(layout.nodes.filter((n) => n.kind === "outpost").length, 6);
    assert.deepEqual(layout.gates.map((n) => n.region).sort(), [...region.links].sort());
    for (const gate of layout.gates) {
      assert(gate.x === 1 || gate.x === map.width - 2 || gate.y === 1 || gate.y === map.height - 2);
      const other = scenario.world.regions.find((r) => r.id === gate.region);
      const dx = ((other.center[0] - region.center[0] + 1800) % 1200) - 600,
        dy = other.center[1] - region.center[1];
      assert.equal(
        gate.side,
        Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "east" : "west") : dy >= 0 ? "south" : "north",
      );
    }
  }
  assert(Object.values(G.catalog.maps).filter((m) => m.scope !== "strategic").length >= 17);
});
test("capture ignores AP but still rejects air/cargo and a base capture wins", () => {
  const { game, unit, field } = fixture(),
    post = field.layout.nodes[1];
  unit.x = post.x;
  unit.y = post.y;
  unit.actionPoints = 9;
  field.owners[post.id] = 1;
  field.version++;
  unit.flying = true;
  assert.equal(B.canCapture(G, game, unit), null);
  unit.flying = false;
  unit.embarked = { carrierId: "test" };
  assert.equal(B.canCapture(G, game, unit), null);
  delete unit.embarked;
  unit.actionPoints = 0;
  B.capture(G, game, unit);
  assert.equal(unit.actionPoints, 0);
  assert.equal(field.owners[post.id], 0);
  assert.throws(() => B.capture(G, game, unit), /无法占领/);
  const base = field.layout.nodes[0];
  field.owners.base = 1;
  field.version++;
  unit.x = base.x;
  unit.y = base.y;
  unit.actionPoints = 5;
  B.capture(G, game, unit);
  assert.equal(game.winner, 0);
  assert.equal(field.capturedBaseTeam, 0);
});
test("connected routes grant 25 percent movement efficiency and disconnected posts cannot heal", () => {
  const { game, unit, field } = fixture(),
    base = field.layout.nodes[0],
    post = field.layout.nodes[1];
  unit.x = post.x;
  unit.y = post.y;
  game.units = [unit];
  assert(B.network(game).reached[0].has(post.id));
  assert.equal(
    G.movementCost(game, unit, post.x, post.y),
    G.terrainCost(game, unit, post.x, post.y) / 1.25,
  );
  const m = G.modelOf(unit);
  unit.hp = 1;
  unit.en = 0;
  B.heal(G, game);
  assert.equal(unit.hp, 1 + Math.round(m.hp * 0.15));
  assert.equal(unit.en, Math.ceil(m.en * 0.3));
  field.owners.base = 1;
  for (const gate of field.layout.gates) field.adjacentOwners[gate.region] = 1;
  field.version++;
  unit.hp = 1;
  unit.en = 0;
  B.heal(G, game);
  assert.equal(unit.hp, 1);
  assert.equal(unit.en, 0);
  assert.equal(
    G.movementCost(game, unit, post.x, post.y),
    G.terrainCost(game, unit, post.x, post.y),
  );
  field.owners.base = 0;
  field.version++;
  unit.x = base.x;
  unit.y = base.y;
  B.heal(G, game);
  assert.equal(unit.hp, 1 + Math.round(m.hp * 0.2));
  assert.equal(unit.en, Math.ceil(m.en * 0.4));
});
test("defenders deploy at posts/base while each attacking army can only deploy at its own approach", () => {
  const { game, unit, enemy, field } = fixture();
  const defender = B.deploymentCells(G, game, unit);
  for (const post of field.layout.nodes)
    assert(defender.some((c) => c.x === post.x && c.y === post.y));
  for (const gate of field.layout.gates) {
    const cells = B.deploymentCells(G, game, enemy, gate.region);
    assert(cells.length > 0);
    assert(cells.every((c) => Math.hypot(c.x - gate.x, c.y - gate.y) <= gate.deploymentRadius));
  }
  assert.equal(B.deploymentCells(G, game, enemy, "not_a_neighbor").length, 0);
  field.owners.base = 1;
  for (const gate of field.layout.gates) field.adjacentOwners[gate.region] = 1;
  field.version++;
  assert(
    B.deploymentCells(G, game, unit).some(
      (cell) => cell.x === field.layout.nodes[1].x && cell.y === field.layout.nodes[1].y,
    ),
  );
  enemy.campaignEntry = field.layout.gates[0].region;
  const allowed = new Set(B.deploymentCells(G, game, enemy).map((c) => G.key(c.x, c.y)));
  assert(G.deploymentCells(game, 1, enemy).every((c) => allowed.has(G.key(c.x, c.y))));
});
test("objective state survives JSON saves and forged objective layouts are rejected", () => {
  const { game, field } = fixture();
  B.validate(G, game);
  const copy = JSON.parse(JSON.stringify(game));
  B.validate(G, copy);
  copy.campaignBattlefield.layout.nodes[0].x++;
  assert.throws(() => B.validate(G, copy), /存档无效/);
  field.owners.base = 9;
  assert.throws(() => B.validate(G, game), /存档无效/);
});

test("regional battle deployment preserves each incoming army approach and checkpoint layout", () => {
  const { createCampaignRoom } = require("../shared/campaign-room.js");
  const Records = require("../shared/match-records.js");
  const players = [
    { id: "h", seat: 0 },
    { id: "o", seat: 1 },
  ];
  const state = C.create(ctx, players);
  state.units = [];
  const region = "canada_east",
    layout = scenario.regions[region].layout;
  const defender = C.addUnit(ctx, state, 0, region, "Type61");
  const attackers = layout.gates.slice(0, 2).map((gate) => {
    const army = C.addUnit(ctx, state, 1, region, "MS_06F");
    army.entryFrom = gate.region;
    return army;
  });
  state.phase = "encounters";
  state.encounters = [{ region, turn: 0, battleSave: null, roster: {}, settled: [] }];
  const room = {
    campaign: state,
    seats: Array(10).fill(null),
    hostId: "h",
    settings: G.campaignRoomSettings(),
    started: false,
  };
  // The commander has changed seats; its original logical seat still owns this army.
  players[0].seat = 2;
  room.seats[2] = players[0];
  room.seats[1] = players[1];
  const adapter = createCampaignRoom({
    G,
    Records,
    randomId: () => "battle",
    randomSeed: () => 1,
    members: () => players,
    planner: { reset() {}, resumeCharges() {} },
    log() {},
  });
  const preparation = adapter.preparation(room);
  const enter = {
    action: "campaign_enter",
    region,
    preparationId: preparation.id,
    mapId: preparation.mapId,
    delegate: false,
  };
  adapter.handle(room, players[0], enter);
  adapter.handle(room, players[1], enter);
  assert.equal(room.game.mapId, scenario.regions[region].mapId);
  assert.equal(room.phase, "deployment");
  for (const army of attackers) {
    const actor = room.game.units.find((unit) => unit.campaignId === army.id),
      gate = layout.gates.find((gate) => gate.region === army.entryFrom);
    assert(actor);
    assert(
      G.cells(actor).every(
        (cell) => Math.hypot(cell.x - gate.x, cell.y - gate.y) <= gate.deploymentRadius,
      ),
    );
  }
  assert(room.game.units.some((unit) => unit.campaignId === defender.id));
  const actor = room.game.units.find((unit) => unit.campaignId === defender.id);
  const post = layout.nodes.find((node) => node.kind === "outpost");
  assert.equal(B.deploymentSeat(room.game, actor), 2);
  assert.equal(room.game.deployment[2], false);
  G.deploy(room.game, 2, actor.id, post.x, post.y);
  assert.equal(actor.x, post.x);
  assert.equal(G.confirmDeployment(room.game, 2), false);
  assert.throws(
    () => G.deploy(room.game, 2, actor.id, layout.nodes[0].x, layout.nodes[0].y),
    /部署已确认/,
  );
  assert.equal(G.confirmDeployment(room.game, 1), true);
});
const testReuseFS = require("node:fs"),
  testReusePath = require("node:path");
test("scenario indices can reuse encounter terrain with a separate regional objective layout", (t) => {
  const serial = require("node:crypto").randomUUID();
  const assets = testReusePath.resolve("assets");
  const indexRef = "maps/strategy/.test-index-" + serial + ".json";
  const infoRef = "earth_0079_mid/.test-scenario-" + serial + ".json";
  const paths = [
    testReusePath.join(assets, indexRef),
    testReusePath.join(assets, "maps/strategy", infoRef),
  ];
  for (const filename of paths) assert(filename.startsWith(assets + testReusePath.sep));
  t.after(() => {
    for (const filename of paths)
      if (testReuseFS.existsSync(filename)) testReuseFS.unlinkSync(filename);
  });
  const info = JSON.parse(
    testReuseFS.readFileSync("assets/maps/strategy/earth_0079_mid/scenario.json", "utf8"),
  );
  info.regions.alaska = {
    map: "@encounter/military_base_5v5",
    layout: "local-battles/alaska_5v5.json",
  };
  testReuseFS.writeFileSync(paths[0], JSON.stringify({ scenarios: [infoRef] }));
  testReuseFS.writeFileSync(paths[1], JSON.stringify(info));
  const catalog = require("../tools/load-catalog.cjs").loadCatalog({
    catalogOverride: { ...require("../assets/unit-catalog.json"), scenarioIndex: indexRef },
  });
  assert.equal(catalog.scenarios.earth_0079_mid.regions.alaska.mapId, "military_base_5v5");
  assert.equal(catalog.scenarios.earth_0079_mid.regions.alaska.layout.regionId, "alaska");
  assert.equal(catalog.scenarios.earth_0079_mid.regions.alaska.layout.nodes.length, 7);
});
test("connected post maintenance is applied once on the incoming team turn", () => {
  const { game, unit, field } = fixture();
  const point = field.layout.nodes[1],
    model = G.modelOf(unit);
  unit.x = point.x;
  unit.y = point.y;
  unit.hp = 1;
  unit.en = 0;
  game.team = 1;
  G.end(game);
  assert.equal(unit.hp, 1 + Math.round(model.hp * 0.15));
  assert.equal(unit.en, Math.ceil(model.en * 0.3));
  const hp = unit.hp,
    en = unit.en;
  G.end(game);
  assert.equal(unit.hp, hp);
  assert.equal(unit.en, en);
});


test("objective capture and maintenance use exactly a 3 by 3 footprint", () => {
  const { game, unit, field } = fixture();
  const post = field.layout.nodes[1];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      unit.x = post.x + dx;
      unit.y = post.y + dy;
      assert.equal(B.nodeAt(G, game, unit)?.id === post.id, Math.abs(dx) <= 1 && Math.abs(dy) <= 1);
    }
  const legacy = structuredClone(game);
  for (const node of legacy.campaignBattlefield.layout.nodes)
    node.radius = node.kind === "base" ? 3 : 2;
  B.validate(G, legacy);
  assert.deepEqual(legacy.campaignBattlefield.layout, field.layout);
});

test("owned posts provide five-cell sight without units, supply or radar marking", () => {
  const { game, unit, enemy, field } = fixture();
  const post = field.layout.nodes[1];
  for (const node of field.layout.nodes) field.owners[node.id] = 1;
  for (const gate of field.layout.gates) field.adjacentOwners[gate.region] = 1;
  field.owners[post.id] = 0;
  field.version++;
  game.fogMode = "full";
  unit.hp = 0;
  enemy.x = post.x + 5;
  enemy.y = post.y;
  assert(G.sensors.visible(game, 0, enemy));
  assert(!G.sensors.detected(game, 0, enemy), "sight is not radar");
  assert(G.sensors.view(game, 0).visibleCells.includes(G.key(enemy.x, enemy.y)));
  enemy.x++;
  assert(!G.sensors.visible(game, 0, enemy));
  enemy.x--;
  field.owners[post.id] = 1;
  field.version++;
  assert(!G.sensors.visible(game, 0, enemy), "capture immediately transfers the objective's sight");
});


test("an enemy footprint inside a post blocks capture until it leaves or is destroyed",()=>{
 const {game,unit,enemy,field}=fixture(),post=field.layout.nodes[1];
 Object.assign(unit,{x:post.x,y:post.y,actionPoints:10});field.owners[post.id]=1;
 Object.assign(enemy,{x:post.x+1,y:post.y+1});
 assert.equal(B.canCapture(G,game,unit),null);
 const before=structuredClone(game);assert.throws(()=>B.capture(G,game,unit));assert.deepEqual(game,before);
 enemy.x=post.x+2;assert.equal(B.canCapture(G,game,unit)?.id,post.id);
 enemy.x=post.x+1;enemy.hp=0;assert.equal(B.canCapture(G,game,unit)?.id,post.id);
});
