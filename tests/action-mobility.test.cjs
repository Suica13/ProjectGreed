const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const G = require("../shared/rules.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");

test("native turn policy compresses 0079/0087 AP and preserves each unit's movement on refresh", () => {
  const code = `
import sys, json, copy
sys.path.insert(0, "tools")
from unit_action_mobility import action_points, apply
from mod_source import ASSETS, MOD, load
for turn, expected in [(1.5,10),(1.75,10),(2,10),(2.25,11),(3.75,12),(4,12),(3,12),(.5,10)]:
 assert action_points(turn)==expected,(turn,expected)
assert action_points(.2,True)==10
for path in (ASSETS/"units").glob("*/unit.json"):
 p=json.loads(path.read_text(encoding="utf-8"));before=copy.deepcopy(p)
 ref=p["source"].split("/",1);root=MOD/ref[0]
 apply(p,load(root/ref[1],root=root))
 assert p==before,p["id"]
print("policy verified")
`;
  const result = spawnSync("python", ["-c", code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("all models use converted AP, retain tactical movement and keep deployed budgets usable", () => {
  for (const p of G.catalog.prefabs) {
    assert.ok(p.stats.actionPoints >= 10, p.id);
    if (p.stats.ship) assert.equal(p.stats.actionPoints, 10, p.id);
    for (const m of Object.values(G.models).filter((m) => m.prefabId === p.id)) {
      assert.equal(m.actionPoints, p.stats.actionPoints, m.id);
      assert.equal(m.move, p.sourceStats.mobilityMoveTarget, p.id);
    }
    if (p.stats.deployed) {
      const parent = G.catalog.prefabs.find((base) => base.id === p.formOf);
      assert.equal(p.stats.actionPoints, parent.stats.actionPoints, p.id);
      assert.equal(p.stats.move, 0, p.id);
    }
  }
});

for (const [unitId, ap] of [
  ["RGM_79", 10],
  ["RX_78_2", 10.5],
  ["RX_78NT_1", 13],
])
  test(`${unitId} starts and refills at ${ap} AP before proportional pilot mobility, independent from reaction`, () => {
    const prefab = G.catalog.prefabs.find((p) => p.id === unitId);
    const entry = { unitId, kitId: prefab.weaponKits[0].id };
    const g = G.create(false, 1, [[entry], [{ unitId: "RGM_79", kitId: "machine_gun" }]], false, {
      costLimit: 99999,
      unitCostLimit: 99999,
    });
    const u = g.units[0];
    assert.equal(u.actionPoints, ap);
    for (const value of [0, 50, 100, 150, 200]) {
      u.pilot = { stats: { ...G.pilots.baseStats(), speed: value, reaction: value } };
      const base = G.models[u.model];
      const expected =
        Math.round(
          base.actionPoints *
            Math.max(1, 1 + (base.speed - 100) * 0.005) *
            Math.max(0.5, 1 + (value - 100) * 0.004) *
            2,
        ) / 2;
      assert.equal(G.actionBudget(u), expected);
      G.end(g);
      G.end(g);
      assert.equal(u.actionPoints, expected);
    }
    const [a, b] = g.units;
    a.pilot = { stats: G.pilots.baseStats() };
    G.end(g);
    G.end(g);
    g.tiles.forEach((row) => row.fill("plain"));
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 12, y: 10, shield: 0 });
    const weapon = G.modelOf(a).weapons.find(
      (w) => w.actionCost === 4 && w.min <= 2 && w.max >= 2 && !w.pilotRequirements,
    );
    assert.ok(weapon);
    const planner = createAttackPlanner(G, () => "ap-test"),
      room = { game: g, matchId: "ap" };
    planner.reset(room);
    const queue = Array(Math.floor(ap / 4)).fill(weapon);
    planner.plan(room, a, b, queue, 0);
    assert.equal(a.actionPoints, ap % 4);
    assert.throws(() => planner.plan(room, a, b, [...queue, weapon], 0));
    planner.cancel(room, a);
    assert.equal(a.actionPoints, ap);
  });
