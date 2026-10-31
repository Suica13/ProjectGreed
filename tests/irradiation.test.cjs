const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Skills = require("../shared/unit-skills.js");
function fixture() {
  const m = Object.values(G.models).find((m) => m.prefabId === "RX_78_4_Bst");
  const e = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(
    false,
    1,
    [
      [{ unitId: m.prefabId, kitId: m.kitId }, e],
      [e, e],
    ],
    false,
    { costLimit: 99999, unitCostLimit: 99999 },
  );
  g.tiles.forEach((row) => row.fill("plain"));
  g.fogMode = "disabled";
  const [u, ally, target, other] = g.units;
  Object.assign(u, { x: 3, y: 8 });
  Object.assign(ally, { x: 5, y: 8, hp: 1000000, shield: 0 });
  Object.assign(target, { x: 8, y: 8, hp: 1000000, shield: 0 });
  Object.assign(other, { x: 8, y: 10, hp: 1000000, shield: 0 });
  return {
    g,
    u,
    ally,
    target,
    other,
    skill: G.unitSkills(u).find((s) => s.type === "irradiation"),
  };
}
test("native irradiation totals collapse repeat-decayed MOD damage to one fiftieth, rounded to the nearest 25", () => {
  const seen = new Set();
  for (const p of G.catalog.prefabs)
    for (const s of p.skills || [])
      if (s.type === "irradiation") {
        seen.add(p.id);
        assert.equal(
          Object.values(s.damageComponents).reduce((a, b) => a + b, 0),
          Math.round(s.nativeTotalDamage / 50 / 25) * 25,
        );
        assert.equal(s.baseHit, 60);
        assert.equal(s.range, 10);
        assert.equal(s.cooldownTurns, 3);
        assert.ok(s.chargeSeconds > 0);
        assert.ok(s.nativeRepeatMultiplier >= 1);
        assert.ok(!p.weaponKits.some((k) => k.weapons.includes(s.sourceWeapon)));
      }
  assert.equal(seen.size, 6);
});
test("directional irradiation spends five AP and half EN once, hits each hull once including allies, and cools down", () => {
  const { g, u, ally, target, other, skill } = fixture(),
    en = u.en;
  const e = G.useSkill(g, u, skill.id, 4, 8);
  assert.equal(u.actionPoints, 0);
  assert.equal(u.en, en - G.modelOf(u).en * 0.5);
  assert.deepEqual(
    e.hits.map((h) => h.unitId),
    [ally.id, target.id],
  );
  assert.equal(other.hp, 1000000);
  assert.equal(e.to.x, 13);
  assert.equal(e.to.y, 8);
  assert.equal(u.skillReadyRound[skill.id], g.round + 6);
  assert.equal(G.canUseSkill(g, u, skill.id), false);
  assert.throws(() => G.useSkill(g, u, skill.id, 4, 8));
});
test("configurable beam length changes geometry and a large hull is hit only once", () => {
  const { g, u, target, skill } = fixture();
  assert.equal(G.irradiationLine(u, { x: 4, y: 8 }, 20).to.x, 23);
  Object.assign(target, {
    model: Object.keys(G.models).find((id) => G.models[id].prefabId === "ApsarasII"),
    x: 9,
    y: 7,
  });
  const e = G.useSkill(g, u, skill.id, 4, 8);
  assert.equal(e.hits.filter((h) => h.unitId === target.id).length, 1);
  const s = structuredClone(skill);
  s.range = 24;
  assert.doesNotThrow(() => Skills.validate([s]));
});
test("Apsaras is enabled, large, occupies 3x3 and EMP refreshes a 25 percent next-turn penalty", () => {
  const m = Object.values(G.models).find((m) => m.prefabId === "ApsarasII");
  assert.equal(m.wip, false);
  assert.equal(G.unitSize(m), "large");
  const e = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[{ unitId: m.prefabId, kitId: m.kitId }], [e, e]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  g.tiles.forEach((row) => row.fill("plain"));
  const [u, a, b] = g.units;
  Object.assign(u, { x: 5, y: 5 });
  Object.assign(a, { x: 9, y: 6 });
  Object.assign(b, { x: 15, y: 6 });
  assert.deepEqual(G.dimensions(u), { width: 3, height: 3 });
  const s = G.unitSkills(u).find((s) => s.type === "emp"),
    en = u.en;
  G.useSkill(g, u, s.id, u.x, u.y);
  assert.equal(a.apPenaltyNextTurn, 0.25);
  assert.equal(b.apPenaltyNextTurn, undefined);
  assert.equal(u.actionPoints, 3);
  assert.equal(u.en, en - 80);
  assert.equal(u.skillReadyRound[s.id], g.round + 4);
  G.end(g);
  assert.equal(a.actionPoints, Math.floor(G.actionBudget(a) * 0.75));
});

test("AI uses irradiation only on visible enemies and refuses friendly fire", () => {
  const { g, u, ally, target, other } = fixture();
  Object.assign(ally, { x: 1, y: 1 });
  Object.assign(other, { x: 8, y: 1 });
  const intent = G.aiAreaSkill(g, u);
  assert.equal(intent.skillId, "Irradiation");
  Object.assign(ally, { x: 5, y: 8 });
  Object.assign(other, { hp: 0 });
  assert.equal(G.aiAreaSkill(g, u), null);
  Object.assign(ally, { x: 1, y: 1 });
  g.fogMode = "full";
  u.brokenParts = { head: true };
  target.x = 12;
  assert.equal(G.aiAreaSkill(g, u), null);
});

test("native irradiation presentation preserves charge/beam attachment offsets, original thickness and phase-specific sounds", () => {
  for (const id of ["RX_78_4_Bst", "ApsarasII", "Burstliner", "MA_08", "AMX_002", "Skiure"]) {
    const model = Object.values(G.models).find((m) => m.prefabId === id),
      skill = model.skills.find((s) => s.type === "irradiation");
    assert.equal(skill.consumeAction, false);
    assert.equal(skill.beamWidth, 315);
    assert.equal(skill.chargeScale, 1.3);
    assert.ok(skill.fireSound.asset);
    assert.ok(G.catalog.sounds[skill.fireSound.asset]);
    if (id !== "Skiure") assert.match(skill.fireSound.file, /BeamCannon_6\.ogg$/);
    if (id === "RX_78_4_Bst") {
      assert.deepEqual(skill.chargeMuzzle.mounts[0], { root: true, offset: { x: 9, y: 50 } });
      assert.deepEqual(skill.muzzle.mounts[0], { root: true, offset: { x: 9, y: 40 } });
    }
  }
});

test("irradiation descriptions show the live base damage formula instead of the import conversion ratio", () => {
  const vm = require("node:vm"),
    fs = require("node:fs");
  const context = vm.createContext({ I18n: { text: (text) => text } });
  vm.runInContext(
    fs.readFileSync("client/skill-controls.js", "utf8") +
      ";globalThis.describe=SkillControls.description",
    context,
  );
  for (const id of ["ApsarasII", "RX_78_4_Bst", "Burstliner", "MA_08", "AMX_002", "Skiure"]) {
    const modelId = Object.keys(G.models).find((key) => G.models[key].prefabId === id);
    const skill = G.unitSkills({ model: modelId }).find((s) => s.type === "irradiation");
    const damage = Object.values(skill.damageComponents)
      .reduce((sum, value) => sum + value, 0)
      .toLocaleString(undefined, { maximumFractionDigits: 2 });
    const text = context.describe(skill);
    assert.ok(text.includes(`${damage} × 1 = ${damage}`), id);
    assert.ok(text.includes(`${skill.range}`));
    assert.ok(!text.includes("1/20"));
    assert.ok(!text.includes("MOD"));
  }
  const edited = {
    type: "irradiation",
    damageComponents: { beam: 10000 },
    range: 12,
    baseHit: 70,
    actionCost: 4,
    enCostPercent: 25,
    cooldownTurns: 2,
    description: "obsolete",
  };
  assert.match(context.describe(edited), /10,000 × 1 = 10,000/);
});
