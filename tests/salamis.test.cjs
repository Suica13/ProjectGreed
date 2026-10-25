const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js"),
  Parts = require("../shared/unit-parts.js");
const ship = { unitId: "SalamisClass", kitId: "standard" },
  gm = { unitId: "RGM_79", kitId: "machine_gun" };
function pair(deployment = false) {
  const g = G.create(false, 3, [[ship], [gm], null, null], deployment, {
    mapId: "orbital_debris_2v2",
    unitCostLimit: 2000,
  });
  for (const row of g.tiles) row.fill("plain");
  const [a, b] = g.units;
  Object.assign(a, { x: 10, y: 10, angle: 0 });
  Object.assign(b, { x: 20, y: 20 });
  return { g, a, b, m: G.modelOf(a) };
}
test("Salamis imports its native sixteen independently damageable modules and five complete weapon groups", () => {
  const { a, m } = pair();
  assert.equal(m.ship, true);
  assert.equal(m.hp, 60000);
  assert.equal(m.mobility, 50);
  assert.equal(m.accuracy, 115.5);
  assert.equal(m.cost, 500);
  assert.equal(m.modules.length, 16);
  assert.deepEqual(
    m.weapons.map((w) => w.shotCount),
    [6, 16, 4, 40, 20],
  );
  assert.equal(m.modules.filter((m) => m.id.includes("BeamCannon")).length, 6);
  assert.equal(m.modules.find((m) => m.id.includes("BeamCannon")).hp, 9000);
  assert.equal(m.modules.find((m) => m.id.includes("_AA_")).hp, 3500);
  assert.equal(m.modules.find((m) => m.id.includes("_MS_")).hp, 7500);
  assert.equal(Object.keys(a.moduleHp).length, 16);
  assert.equal(
    m.weapons.some((w) => w.type === "melee"),
    false,
  );
  assert.deepEqual(
    G.planFormation([ship], 3000, { environment: "ground", unitCostLimit: 2000 }).reasons,
    { 0: "not_allowed" },
  );
  assert.deepEqual(
    G.planFormation([ship], 3000, { environment: "space", unitCostLimit: 2000 }).disabled,
    [],
  );
  assert.throws(() => G.create(false, 1, [[ship], [gm]], false, { unitCostLimit: 2000 }));
});
test("every footprint cell is selectable and blocks enemies; range uses closest occupied edges", () => {
  const { g, a, b, m } = pair();
  assert.equal(G.cells(a).length, 6);
  assert.deepEqual(G.dimensions(a), { width: 2, height: 3 });
  for (const c of G.cells(a)) assert.equal(G.at(g, c.x, c.y), a);
  assert.equal(G.at(g, 13, 16), undefined);
  Object.assign(b, { x: 8, y: 11 });
  assert.equal(G.dist(a, b), 2);
  assert.equal(G.movementCost(g, b, 9, 11), 3);
  assert.equal(G.reachable(g, b).has("10,11"), false);
  const gun = m.weapons[0];
  Object.assign(a, { angle: 90 });
  Object.assign(b, { x: 17, y: 10 });
  assert.equal(G.dist(a, b), 5);
  assert.equal(G.inRange(a, b, gun), true);
  b.x = 21;
  assert.equal(G.inRange(a, b, gun), false);
});
test("ships cannot squeeze through a one-cell channel or end over a friendly unit", () => {
  const { g, a, b } = pair();
  Object.assign(a, { x: 5, y: 5, angle: 0 });
  for (let y = 0; y < g.tiles.length; y++) {
    g.tiles[y][4] = "rock";
    g.tiles[y][6] = "rock";
  }
  assert.equal(G.fits(g, a, 5, 6), false);
  assert.equal(G.reachable(g, a).has("5,6"), false);
  for (const row of g.tiles) row.fill("plain");
  Object.assign(b, { team: a.team, x: 8, y: 5 });
  assert.equal(G.fits(g, a, 8, 5), false);
  assert.equal(G.fits(g, a, 8, 5, a.angle, true), true);
});
test("rotation checks its swept square, consumes movement, preserves fire heading and can be undone only into a free footprint", () => {
  const { g, a, b } = pair();
  g.tiles[12][12] = "rock";
  const before = JSON.stringify(a);
  assert.equal(G.canRotate(g, a, 1), false);
  assert.throws(() => G.rotate(g, a, 1));
  assert.equal(JSON.stringify(a), before);
  g.tiles[12][12] = "plain";
  G.rotate(g, a, 1);
  assert.equal(a.angle, 90);
  assert.equal(a.moved, true);
  assert.deepEqual(G.dimensions(a), { width: 3, height: 2 });
  assert.equal(G.canRotate(g, a, -1), false);
  G.faceTarget(a, b);
  assert.equal(a.angle, 90);
  assert.ok(Number.isFinite(a.aimAngle));
  Object.assign(b, { x: 11, y: 12, team: 0 });
  assert.equal(G.canUndo(g, a), false);
  Object.assign(b, { x: 20, y: 20 });
  assert.equal(G.canUndo(g, a), true);
  G.undo(g, a);
  assert.equal(a.angle, 0);
  assert.equal(a.moved, false);
});
test("deployment validates all six cells and permits turning inside the expanded strip", () => {
  const { g, a } = pair(true);
  const anchor = G.deploymentCells(g, 0).find((c) => G.fits(g, a, c.x, c.y, 0, false, 0));
  assert.ok(anchor);
  Object.assign(a, { ...anchor, angle: 0 });
  assert.equal(G.canRotate(g, a, 1), true);
  G.rotate(g, a, 1);
  assert.deepEqual(G.dimensions(a), { width: 3, height: 2 });
  assert.equal(a.moved, false);
  const area = G.getMap(g.mapId).deploymentAreas[0];
  assert.throws(() => G.deploy(g, 0, a.id, area.x + area.width - 1, a.y));
  G.confirmDeployment(g, 0);
});

test("native module damage accompanies hull damage, disables only that module and persists through snapshots", () => {
  const { g, a, m, b } = pair();
  const gun = m.weapons[0],
    module = m.modules.find((m) => gun.moduleIds.includes(m.id));
  const full = G.availableStrikes(a, gun).length;
  let found = false;
  for (let seed = 0; seed < 10000; seed++) {
    const copy = structuredClone(a),
      local = { partSeed: seed };
    const part = Parts.applyHit(local, copy, m, 10000, 1);
    if (part === module.id) {
      Object.assign(a, copy);
      found = true;
      break;
    }
  }
  assert.ok(found);
  assert.equal(a.moduleHp[module.id], 0);
  assert.equal(a.brokenParts[module.id], true);
  assert.equal(G.availableStrikes(a, gun).length, full - 1);
  assert.equal(G.canUse(a, gun), true);
  for (const id of gun.moduleIds) a.moduleHp[id] = 0;
  assert.equal(G.canUse(a, gun), false);
  assert.equal(G.canUse(a, m.weapons[1]), true);
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy.units[0].moduleHp, a.moduleHp);
  assert.equal(G.models[a.model].modules[0].hp, 9000);
});
test("turret firing arcs filter volleys while attacks never rotate the hull footprint", () => {
  const { g, a, b, m } = pair();
  Object.assign(a, { angle: 90 });
  Object.assign(b, { x: 17, y: 11, hp: 100000, shield: 0 });
  const gun = m.weapons[0];
  const available = G.availableStrikes(a, gun, b).length;
  assert.ok(available > 0 && available < 6);
  const before = G.cells(a);
  const en = a.en;
  const events = G.fight(g, a, b, gun, "defend");
  assert.equal(a.angle, 90);
  assert.deepEqual(G.cells(a), before);
  assert.equal(a.en, en - gun.en);
  assert.equal(events[0].strikes.filter((s) => s.executed).length, available);
  assert.ok(events[0].strikes.some((s) => !s.executed));
});

test("ship AI uses the same legal rotation action to improve turret bearing instead of moving through rocks", () => {
  const { g, a, b } = pair();
  g.tiles.forEach((row) => row.fill("rock"));
  Object.assign(a, { angle: 180 });
  Object.assign(b, { x: 11, y: 6 });
  for (let y = 10; y <= 15; y++) for (let x = 10; x <= 15; x++) g.tiles[y][x] = "plain";
  g.tiles[b.y][b.x] = "plain";
  const choice = G.aiChoice(g, a);
  assert.ok([-1, 1].includes(choice.rotation));
  assert.equal(G.canRotate(g, a, choice.rotation), true);
  G.rotate(g, a, choice.rotation);
  const weapon = G.modelOf(a).weapons.find((w) => w.id === choice.weapon);
  assert.equal(G.canAttack(g, a, b, weapon), true);
});
