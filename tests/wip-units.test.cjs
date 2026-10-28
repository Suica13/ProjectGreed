const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { loadCatalog } = require("../tools/load-catalog.cjs"),
  G = require("../shared/rules.js");
test("Apsaras is released after irradiation and EMP integration", () => {
  const catalog = G.catalog,
    prefabs = catalog.prefabs.filter((p) => p.id.startsWith("Apsaras"));
  assert.ok(prefabs.length > 0);
  for (const prefab of prefabs) {
    assert.equal(prefab.wip, false);
    assert.equal(prefab.disabled, false);
    for (const kit of prefab.weaponKits) {
      const model = catalog.models[prefab.id + "__" + kit.id];
      assert.equal(model.wip, false);
      assert.equal(model.disabled, false);
      assert.notEqual(G.restrictionReason(model), "wip");
    }
  }
  assert.equal(catalog.prefabs.find((p) => p.id === "MS_06F").wip, false);
  assert.equal(
    JSON.parse(fs.readFileSync("assets/units/ApsarasII/unit.json", "utf8")).wip,
    undefined,
  );
});
test("removing WIP list entries restores availability, and invalid or unknown IDs fail catalog validation", () => {
  const restored = loadCatalog({ wipOverride: { schemaVersion: 1, units: [] } });
  assert.equal(restored.prefabs.find((p) => p.id === "ApsarasII").wip, false);
  assert.ok(
    loadCatalog({ wipOverride: { schemaVersion: 1, units: ["ApsarasII"] } }).prefabs.find(
      (p) => p.id === "ApsarasII",
    ).wip,
  );
  for (const units of [
    ["Apsaras*", "Apsaras*"],
    ["Apsaras*II"],
    ["UnknownUnit"],
    ["UnknownFamily*"],
  ])
    assert.throws(() => loadCatalog({ wipOverride: { schemaVersion: 1, units } }), /WIP/);
});
test("AI and authoritative deployment still exclude explicitly configured WIP units", (t) => {
  // Exercise the disabled-list contract independently of the now-released Apsaras.
  const models = Object.values(G.models).filter((m) => m.prefabId === "ApsarasII");
  for (const model of models) {
    model.wip = true;
    model.disabled = true;
  }
  t.after(() => {
    for (const model of models) {
      model.wip = false;
      model.disabled = false;
    }
  });
  const prefab = G.catalog.prefabs.find((p) => p.id === "ApsarasII"),
    wip = { unitId: prefab.id, kitId: prefab.weaponKits[0].id },
    normal = { unitId: "Type61", kitId: "standard" };
  for (let seed = 1; seed <= 40; seed++)
    assert.ok(
      G.randomFormation(seed, 99999, { unitCostLimit: 99999 }, 24).every(
        (e) => !G.models[e.unitId + "__" + e.kitId].wip,
      ),
    );
  const plan = G.planFormation([wip, normal], 99999, {}, 72);
  assert.equal(plan.reasons[0], "wip");
  assert.deepEqual(plan.deployable, [normal]);
  const preset = { seat: 0, formationPreset: { units: [wip] } };
  assert.equal(
    G.planFormation([wip], 99999, G.armyRestrictions(G.defaultRoomSettings(), preset), 72)
      .reasons[0],
    "wip",
  );
  assert.throws(
    () => G.create(false, 1, [[wip], [normal]], false, { costLimit: 99999, unitCostLimit: 99999 }),
    /不被允许/,
  );
});
