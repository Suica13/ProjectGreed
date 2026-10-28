const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
function fixture(id = "RGM_79") {
  const m = Object.values(G.models).find((m) => m.prefabId === id);
  const g = G.create(
    false,
    1,
    [[{ unitId: id, kitId: m.kitId }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  const [a, b] = g.units;
  Object.assign(a, { x: 4, y: 8 });
  Object.assign(b, { x: 10, y: 8, hp: 100000, shield: 0 });
  return { g, a, b };
}
test("beam screen is a four-AP half-EN ground skill and lasts two complete turn cycles", () => {
  const { g, a } = fixture("PublicClass"),
    skill = G.unitSkills(a).find((s) => s.type === "beam_diffusion");
  assert.ok(skill);
  assert.ok(!G.modelOf(a).weapons.some((w) => w.id === "EF_PublicClass_BeamDiffusionMS"));
  const en = a.en,
    ap = G.actionPoints(a),
    target = { x: 6, y: 8 };
  assert.ok(G.skillTargets(g, a, skill.id).some((c) => c.x === 6 && c.y === 8));
  const event = G.useSkill(g, a, skill.id, target.x, target.y);
  assert.equal(a.en, en - G.modelOf(a).en * 0.5);
  assert.equal(a.actionPoints, ap - 4);
  assert.equal(event.targetEffect, true);
  assert.equal(g.beamDiffusionFields[0].radius, 4);
  for (let i = 0; i < 3; i++) {
    G.end(g);
    assert.equal(g.beamDiffusionFields.length, 1);
  }
  G.end(g);
  assert.equal(g.beamDiffusionFields.length, 0);
});
test("beam ray checks intersections, edges and expiration without stacking or reducing other channels", () => {
  const { g, a, b } = fixture();
  const field = { x: 7, y: 8, radius: 1, expiresRound: g.round + 4 };
  g.beamDiffusionFields = [field, field];
  assert.equal(G.beamDiffusionFactor(g, a, b), 0.5);
  field.y = 9;
  assert.equal(G.beamDiffusionFactor(g, a, b), 0.5);
  field.y = 9.01;
  assert.equal(G.beamDiffusionFactor(g, a, b), 1);
  field.y = 8;
  const original = G.modelOf(a).weapons[0];
  for (const channel of ["beam", "beamAP", "shell", "meleeBeam"]) {
    const w = {
      ...original,
      type: channel.startsWith("melee") ? "melee" : "beam",
      damageComponents: { [channel]: 10000 },
      attack: {
        ...original.attack,
        strikes: [
          {
            ...original.attack.strikes[0],
            damageComponents: { [channel]: 10000 },
            damageMultiplier: 1,
          },
        ],
      },
    };
    g.beamDiffusionFields = [];
    const full = G.estimate(g, a, b, w).damage;
    g.beamDiffusionFields = [field];
    const reduced = G.estimate(g, a, b, w).damage;
    assert.ok(
      Math.abs(reduced - full * (["beam", "beamAP"].includes(channel) ? 0.5 : 1)) <= 1,
      channel,
    );
  }
  field.expiresRound = g.round;
  assert.equal(G.beamDiffusionFactor(g, a, b), 1);
});
test("all native camera guns share 10-15 range, three AP and a three-tile sight/radar area", () => {
  const cameraModels = Object.values(G.models).filter((m) =>
    m.skills.some((s) => s.reconMode === "camera"),
  );
  assert.ok(cameraModels.length);
  for (const model of cameraModels) {
    const skill = model.skills.find((s) => s.reconMode === "camera");
    assert.deepEqual(
      [skill.minRange, skill.range, skill.actionCost, skill.areaSight, skill.areaRadar],
      [10, 15, 3, 3, 3],
    );
  }
  const { g, a, b } = fixture(cameraModels[0].prefabId);
  g.fogMode = "full";
  Object.assign(a, { x: 2, y: 8 });
  Object.assign(b, { x: 17, y: 8 });
  const skill = G.unitSkills(a).find((s) => s.reconMode === "camera"),
    targets = G.skillTargets(g, a, skill.id);
  assert.ok(targets.some((c) => c.x === 12 && c.y === 8));
  assert.ok(targets.some((c) => c.x === 17 && c.y === 8));
  assert.ok(!targets.some((c) => c.x === 11 && c.y === 8));
  assert.ok(!targets.some((c) => c.x === 18 && c.y === 8));
  G.useSkill(g, a, skill.id, 17, 8);
  assert.equal(a.actionPoints, 2);
  assert.equal(G.sensors.visible(g, a.team, b), true);
  assert.equal(G.sensors.detected(g, a.team, b), true);
});
test("heat rods and native stun payloads apply one non-stacking AP penalty at the next own turn", () => {
  for (const p of G.catalog.prefabs)
    for (const w of Object.values(p.weapons))
      if (w.nativePayload?.StunDamage > 0 || w.sourceName.includes("HeatRod"))
        assert.equal(w.onHitAPLoss, 1, p.id);
  const { g, a, b } = fixture();
  b.x = 6;
  const w = { ...G.modelOf(a).weapons[0], hitScale: 100, onHitAPLoss: 1 };
  for (let i = 0; i < 2; i++) {
    a.acted = false;
    G.fight(g, a, b, w, "evade", null, false);
    assert.equal(b.apPenaltyNextTurn, 1);
  }
  G.end(g);
  assert.equal(b.actionPoints, G.actionBudget(b) - 1);
  assert.equal(b.apPenaltyNextTurn, undefined);
  G.end(g);
  G.end(g);
  assert.equal(b.actionPoints, G.actionBudget(b));
});

test("burn ticks every second, uses maximum HP and SP percentage only, and expires without stacking", () => {
  const { g, a, b } = fixture();
  b.x = 6;
  const w = { ...G.modelOf(a).weapons[0], hitScale: 100, burn: { durationTurns: 3, hpPercent: 5 } };
  G.fight(g, a, b, w, "evade", null, false);
  const expires = b.burning.expiresRound;
  assert.equal(expires, g.round + 6);
  const maximum = G.modelOf(b).hp,
    before = b.hp;
  G.tickBurning(g);
  assert.equal(before - b.hp, Math.round(maximum * 0.05));
  a.acted = false;
  G.fight(g, a, b, w, "evade", null, false);
  assert.equal(b.burning.expiresRound, expires);
  const previous = G.models[b.model].defenses.sp;
  G.models[b.model].defenses.sp = { percent: 50, flat: 999999 };
  try {
    const before = b.hp;
    G.tickBurning(g);
    assert.equal(before - b.hp, Math.round(maximum * 0.025));
  } finally {
    G.models[b.model].defenses.sp = previous;
  }
  for (let i = 0; i < 6; i++) G.end(g);
  assert.equal(b.burning, undefined);
});
