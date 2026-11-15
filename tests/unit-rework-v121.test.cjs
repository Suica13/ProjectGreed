const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  E = require("../shared/economy");
const Forms = require("../shared/normal-forms"),
  Conversion = require("../shared/conversion-rules.cjs");
const entry = (id) => ({ unitId: id, kitId: E.defaultKit(id) });

test("workshop publishes BWS Re-GZ and humanoid Custom, and retains PS layer gating on opaque Blitz", () => {
  const p = (id) => G.catalog.prefabs.find((p) => p.id === id);
  assert(p("RGZ_91").formOnly);
  assert(!p("RGZ_91_MA").formOnly);
  assert(!p("RGZ_91B").formOnly);
  assert(p("RGZ_91B_MA").formOnly);
  assert(E.productionOffer("RGZ_91_MA", E.defaultKit("RGZ_91_MA")));
  assert.equal(E.productionOffer("RGZ_91", E.defaultKit("RGZ_91")), null);
  const blitz = p("GAT_X207");
  assert(blitz.layers.filter((l) => l.visibleWhen?.phaseShiftActive !== undefined).length > 10);
  assert(
    blitz.layers
      .filter((l) => l.visibleWhen?.phaseShiftActive !== undefined)
      .every((l) => (l.alpha ?? 1) === 1),
  );
  assert(blitz.skills.some((s) => s.type === "phase_shift"));
  assert(blitz.skills.some((s) => s.type === "optical_camouflage"));
});

test("kit families retain strongest native variant models/art and migrate stock without duplication", () => {
  const pairs = E.catalog.unitFamilies;
  for (const [variant, target] of Object.entries(pairs)) {
    const base = G.catalog.prefabs.find((p) => p.id === target.unitId),
      source = G.catalog.prefabs.find((p) => p.id === variant);
    assert(source.formOnly);
    assert.equal(source.kitFamily, base.id);
    const kit = base.weaponKits.find((k) => k.id === target.kitId),
      model = G.models[base.id + "__" + kit.id];
    assert(kit);
    assert.equal(model.variantUnitId, variant);
    assert(G.catalog.units.some((u) => u.id === base.id + "__" + kit.id));
    for (const legacy of source.weaponKits) {
      assert.deepEqual(
        G.validateFleetFormation([{ unitId: variant, kitId: legacy.id }], Infinity, 72),
        [target],
      );
    }
    const migrated = E.validate({
      schemaVersion: 3,
      money: 0,
      supplies: 0,
      licenses: { [variant]: true },
      inventory: { [variant]: 3, [base.id]: 2 },
    });
    assert.equal(migrated.inventory[base.id], 5);
    assert.equal(migrated.inventory[variant], undefined);
    assert(migrated.licenses[base.id]);
  }
});

test("armor-purge workshop forms can reattach and transfer one physical hull without losing licenses", () => {
  const roots = ["RX_78NT_1_FA", "FA_78_1", "RGZ_91_MA"];
  for (const id of roots) {
    const p = G.catalog.prefabs.find((p) => p.id === id),
      skill = p.skills.find((s) => s.type === "armor_purge");
    assert(skill, id);
    const target = skill.source.unitId;
    assert(Forms.options(G.catalog, target).some((o) => o.unitId === id));
    E.creditActivity({
      id: "purge-" + id,
      matchId: "rework",
      money: 0,
      supplies: 0,
      licenses: { [id]: true },
      inventory: { [id]: 1 },
    });
    const total = () => Object.values(E.snapshot().inventory).reduce((a, b) => a + b, 0),
      before = total();
    E.transformStock(id, target);
    assert(E.quantity(target) > 0);
    assert(E.hasLicense(target));
    G.validateFleetFormation([entry(target)], Infinity, 72);
    E.transformStock(target, id);
    assert(E.quantity(id) > 0);
    assert.equal(total(), before);
  }
});

test("SFS can occupy a fleet slot and tackles are ordinary fallback weapons", () => {
  for (const p of G.catalog.prefabs.filter(
    (p) => p.hangars.some((h) => h.kind === "sfs") && !p.formOnly,
  )) {
    const model = G.models[p.id + "__" + p.defaultKit];
    assert(G.isFleetCarrier(model), p.id);
    assert.equal(
      G.planFormation([entry(p.id)], Infinity, { requiresCarriers: true, fleetLimit: 3 }, 72)
        .missing?.length || 0,
      0,
    );
  }
  let tackles = 0;
  for (const m of Object.values(G.models))
    for (const w of m.weapons)
      if (require("../shared/weapon-classes").classify(w) === "ram") {
        tackles++;
        assert.notEqual(w.slot, "skill");
      }
  assert(tackles > 50);
});

test("manual transport prices survive 110 percent special costs and MA uses native 75 percent HP", () => {
  const c = Conversion.read();
  assert.equal(c.units.specialCost, 1.1);
  assert.equal(c.units.maHP, 0.75);
  for (const [id, cost] of [
    ["MarseilleIIIClass", 250],
    ["VTOLTransport", 250],
    ["VTOLTransport_DeployState", 250],
    ["Medea", 250],
    ["ColumbusClassKai", 350],
  ]) {
    assert.equal(G.models[id + "__" + E.defaultKit(id)].cost, cost, id);
  }
  let checked = 0;
  const adjust = require("../shared/editor-adjustments.json");
  for (const p of G.catalog.prefabs)
    if (
      p.sourceStats?.nativeProductionQuantity === 1 &&
      !p.stats.ship &&
      !adjust.units[p.id]?.["/stats/cost"]
    ) {
      assert.equal(
        p.stats.cost,
        Math.max(25, Math.round((p.conversionSpecialCostBase * 1.1) / 25) * 25),
        p.id,
      );
      checked++;
    }
  assert(checked > 20);
});

test("Big Zam radial beam hits nearby friend and enemy once, excludes distant hulls and has one use per turn", () => {
  const g = G.create(
    false,
    17,
    [
      [entry("MA_08"), entry("RGM_79")],
      [entry("RGM_79"), entry("RGM_79")],
    ],
    false,
    { costLimit: 99999, unitCostLimit: 99999, fogMode: "disabled" },
  );
  g.deployment = null;
  g.tiles.forEach((r) => r.fill("plain"));
  const [a, friend, enemy, far] = g.units;
  Object.assign(a, { x: 10, y: 10 });
  Object.assign(friend, { x: 8, y: 10 });
  Object.assign(enemy, { x: 12, y: 10 });
  Object.assign(far, { x: 18, y: 10 });
  const skill = G.unitSkills(a).find((s) => s.id === "AllRoundBeam");
  assert.equal(skill.baseHit, 75);
  assert.equal(skill.damageComponents.beam, 3500);
  assert.equal(skill.cooldownTurns, 0);
  assert.equal(skill.muzzle.mounts.length, 14);
  assert.equal(skill.radialDirections.length, 14);
  assert(!G.modelOf(a).weapons.some((w) => w.id.startsWith("ZN_MA_08_AA_BeamCannon")));
  assert(G.canUseSkill(g, a, skill.id));
  const result = G.useSkill(g, a, skill.id, a.x, a.y);
  assert(result.radial);
  assert.deepEqual(result.hits.map((h) => h.unitId).sort(), [friend.id, enemy.id].sort());
  assert(!G.canUseSkill(g, a, skill.id));
  assert(a.acted);
});

test("White Base mission has era cap only and packaging uses current authored activity definitions", () => {
  const M = require("../shared/mission-mode"),
    map = G.getMap(M.defaultMapId);
  assert.equal(map.mission.era, "UC_0079_T2");
  assert.equal(map.mission.technologyLimitEnabled, false);
  assert.equal(M.settings(G, map.id).missionTechnologyLimitEnabled, false);
  const { exportDefaults } = require("../tools/export-default-activities.cjs");
  const raw = require("../server-data/activities.json"),
    result = exportDefaults(raw);
  assert.equal(result.activities.length, raw.activities.length);
  for (const a of result.activities) {
    const source = raw.activities.find((v) => v.id === a.id);
    assert.deepEqual(a.multipliers, source.multipliers);
  }
});

test("catalog incremental refresh keeps family kits visible and rebuilds their native dependencies", () => {
  const load = require("../tools/load-catalog.cjs").loadCatalog;
  for (const changedUnits of [["GAT_X207"], ["RX_81"]]) {
    const c = load({ embedAssets: false, reuseCatalog: G.catalog, changedUnits });
    for (const id of ["RX_81__variant_RX_81ST", "GAT_X105__variant_GAT_X105_L"]) {
      assert.equal(c.models[id].formOnly, false, id);
      assert.equal(c.units.filter((u) => u.id === id).length, 1);
    }
  }
});
