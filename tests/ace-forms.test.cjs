const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  P = require("../shared/pilots.js"),
  E = require("../shared/economy.js"),
  D = require("../shared/development.js");
const entry = (id) => ({ unitId: id, kitId: E.defaultKit(id) });
function game(first) {
  const g = G.create(false, 1, [[first], [entry("Type61")]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  g.tiles.forEach((r) => r.fill("plain"));
  Object.assign(g.units[0], { x: 10, y: 10 });
  Object.assign(g.units[1], { x: 18, y: 10 });
  return g;
}
test("ACE faction access permits PMC and the native faction, with shared custom pilots", () => {
  for (const ace of P.catalog.aces) {
    const pilot = ace.price ? P.createAce(ace.id) : { aceId: ace.id };
    assert(P.canAssign(pilot, "PMC"));
    assert(P.canAssign(pilot, ace.faction));
    const other = ace.faction === "EFSF" ? "ZEON" : "EFSF";
    assert.equal(P.canAssign(pilot, other), !!ace.availableFactions?.includes(other));
    if (!ace.price) continue;
    const e = { ...entry("Type61"), customPilot: pilot };
    if (!ace.availableFactions?.includes(other))
      assert.equal(
        G.planFormation([e], Infinity, { characterFaction: other }).reasons[0],
        "pilot_faction",
      );
  }
  assert(P.canAssign(P.createCustom("custom-shared", "Shared"), "ZEON"));
});
test("native ACE forms resolve every kit without mutating the purchased hull and revert on unassignment", () => {
  let count = 0;
  for (const prefab of G.catalog.prefabs)
    for (const form of prefab.pilotForms || []) {
      count++;
      for (const kit of prefab.weaponKits) {
        const e = { unitId: prefab.id, kitId: kit.id, customPilot: P.createAce(form.pilotId) };
        const id = G.formationModelId(e);
        assert.equal(G.models[id].prefabId, form.unitId);
        assert.equal(e.unitId, prefab.id);
        const g = game(e),
          u = g.units[0];
        assert.equal(u.model, id);
        assert.equal(u.deploymentUnitId, prefab.id);
        assert.equal(
          G.planFormation([e], Infinity, { licenses: { [prefab.id]: true } }).disabled.length,
          0,
        );
        assert.equal(
          G.planFormation([e], Infinity, { licenses: { [form.unitId]: true } }).reasons[0],
          "license",
        );
        delete e.customPilot;
        assert.equal(G.formationModelId(e), prefab.id + "__" + kit.id);
      }
    }
  assert(count >= 15);
});
test("ACE-specific EXAM and armor purge retain the origin hull, pilot and unit identity", () => {
  for (const [id, pilotId, skill, target] of [
    ["RX_79_BD_2", "Pilot_ZEON_0079_N_ACE_NMBS", "EXAM", "RX_79_BD_2_NMBS_EXAM"],
    ["RX_79_G_WithBackpack", "Pilot_EFSF_0079_N_ACE_SHR", "ExitUnit", "RX_79_G_Ez8"],
  ]) {
    const e = { ...entry(id), customPilot: P.createAce(pilotId) },
      g = game(e),
      u = g.units[0],
      uid = u.id;
    G.useSkill(g, u, skill, u.x, u.y);
    assert.equal(G.modelOf(u).prefabId, target);
    assert.equal(u.id, uid);
    assert.equal(u.deploymentUnitId, id);
    assert.equal(u.pilot.aceId, pilotId);
  }
});
test("extra hull stock is valid, nonfactory hulls cannot be produced even after activity unlock", () => {
  const id = "MS_06S_CharCustom";
  D.grantUnit("ZEON", id);
  assert.equal(E.validate({ money: 0, supplies: 0, licenses: { [id]: true } }).licenses[id], true);
  assert.equal(E.purchaseLicense(id, "PMC"), false);
  const p = G.catalog.prefabs.find((p) => p.id === id);
  assert(!p.production.enabled);
  assert(p.production.refitFrom.includes("MS_06S"));
});

test("Cima event unlock works in both native and secondary factions", () => {
  const id = "Pilot_ZEON_0079_N_ACE_CIA";
  assert(D.grantUnit("ZEON", id));
  assert(D.allows("ZEON", id));
  assert(D.allows("EFSF", id));
  assert(D.allows("PMC", id));
  const pilot = P.createAce(id);
  assert(P.canAssign(pilot, "EFSF"));
});

test("random and AI formations never deploy an unassigned ACE-only hull", () => {
  for (let seed = 1; seed <= 16; seed++) {
    const formation = G.randomFormation(seed, 10000, {}, 12);
    for (const e of formation) assert(!G.formationModel(e).requiredPilotId, e.unitId);
  }
});
