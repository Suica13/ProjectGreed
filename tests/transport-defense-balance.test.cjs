const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function pair() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" },
    g = G.create(false, 123, [[entry], [entry]], false, { fogMode: "disabled" });
  g.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 3, pilot: null });
  Object.assign(b, { x: 4, y: 3, pilot: null });
  const w = {
    ...G.modelOf(a).weapons[0],
    hitScale: 0.4,
    min: 0,
    max: 30,
    category: "beamRifle",
    special: undefined,
  };
  return { g, a, b, w };
}
test("Minovsky evasion is 15 percent for the emitting team, without granting it to enemies or stacking", () => {
  const { g, a, b, w } = pair(),
    base = G.estimate(g, a, b, w).hit,
    field = { x: b.x, y: b.y, radius: 2, team: b.team, expiresRound: g.round + 2 };
  const squad = G.squadEvasion(g, b),
    expected = Math.round(base - (100 - base - squad) * 0.15);
  // Forecasts round to whole percentages after the fixed squad-evasion subtraction.
  g.minovskyFields = [field];
  assert(Math.abs(G.estimate(g, a, b, w).hit - expected) <= 1);
  assert(G.minovskyAt(g, b, b.team));
  assert(!G.minovskyAt(g, b, a.team));
  const first = G.estimate(g, a, b, w).hit;
  g.minovskyFields.push({ ...field });
  near(G.estimate(g, a, b, w).hit, first);
  g.minovskyFields = [{ ...field, team: a.team }];
  near(G.estimate(g, a, b, w).hit, base);
  assert(G.minovskyAt(g, b), "sensor and interference region still exists");
  const anti = G.sensors.ranges(b, g).antiDetection;
  g.minovskyFields = [];
  near(anti, G.sensors.ranges(b, g).antiDetection + 5);
  const missile = { ...w, category: "missile" };
  g.minovskyFields = [{ ...field, team: a.team }];
  assert(
    Math.abs(G.estimate(g, a, b, missile).hit - Math.round((base + squad) * 0.75 - squad)) <= 1,
  );
  g.minovskyFields = [{ ...field, expiresRound: g.round }];
  near(G.estimate(g, a, b, w).hit, base);
});
test("new Minovsky fields serialize their friendly team for network and saved-game use", () => {
  const entry = (id) => ({ unitId: id, kitId: "standard" }),
    g = G.create(false, 99, [
      [entry("BigTrayClass")],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]),
    ship = g.units[0];
  const skill = G.unitSkills(ship).find((s) => s.type === "minovsky");
  assert(skill);
  G.useSkill(g, ship, skill.id, ship.x, ship.y);
  assert.equal(g.minovskyFields[0].team, ship.team);
  const restored = JSON.parse(JSON.stringify(g));
  assert(G.minovskyAt(restored, restored.units[0], ship.team));
  assert(!G.minovskyAt(restored, restored.units[0], 1 - ship.team));
});
test("light transports use requested hull HP in every kit and stationary deployed form", () => {
  const ids = [
    "Medea",
    "FatUncle",
    "MedeaKai",
    "FatUncleKai",
    "Medea_DeployState",
    "FatUncle_DeployState",
    "MedeaKai_DeployState",
    "FatUncleKai_DeployState",
    "VTOLTransport",
    "VTOLTransport_DeployState",
    "VoLPHAU",
  ];
  for (const id of ids) {
    const models = Object.values(G.models).filter((m) => m.prefabId === id);
    assert(models.length, id);
    for (const m of models) {
      assert.equal(m.hp, id.includes("Kai") ? 35000 : 25000, id);
      assert.equal(
        m.move,
        id.endsWith("_DeployState") ? 0 : id.includes("Kai") || id === "VoLPHAU" ? 8 : 7,
        id,
      );
    }
  }
});
test("smoke reduces ranged accuracy by ten percent on both teams without stacking, and leaves melee unchanged", () => {
  const { g, a, b, w } = pair(),
    base = G.estimate(g, a, b, w).hit,
    squad = G.squadEvasion(g, b),
    melee = { ...w, type: "melee" },
    meleeBefore = G.estimate(g, a, b, melee).hit;
  const field = { x: b.x, y: b.y, radius: 2, expiresRound: g.round + 2 };
  g.smokeFields = [field];
  const smoke = G.estimate(g, a, b, w).hit;
  assert(Math.abs(smoke - Math.round((base + squad) * 0.9 - squad)) <= 1);
  assert(smoke < base);
  g.smokeFields.push({ ...field });
  assert.equal(G.estimate(g, a, b, w).hit, smoke);
  assert.equal(G.estimate(g, a, b, melee).hit, meleeBefore);
  b.team = a.team;
  assert(G.smokeAt(g, b));
  g.smokeFields = [];
  const friendlyBase = G.estimate(g, a, b, w).hit;
  g.smokeFields = [field];
  assert(G.estimate(g, a, b, w).hit < friendlyBase);
});
