const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  cp = require("node:child_process");
const G = require("../shared/rules"),
  P = require("../shared/production-data.cjs"),
  tree = require("../shared/development-tree.json");
const ids = ["EndraClass", "NahelArgamaClass", "ORX_012", "ORX_013"];
const prefab = (id) => G.catalog.prefabs.find((p) => p.id === id);
const model = (id) => G.models[P.baseModels[id]];
test("four selected 0087 units have native assets, research bindings and factory offers", () => {
  for (const id of ids) {
    const p = prefab(id),
      m = model(id);
    assert(p && m, id);
    assert(p.source.startsWith("GW_BattleUniverse_DLC_0087/"));
    assert(p.tags.includes("UC_0087_T2"));
    assert(p.localization.en.description && p.localization.ja.description);
    assert(
      Object.values(tree)
        .flat()
        .some((n) => n.unlocks.includes(id)),
    );
    assert(P.licenseOffers[id]);
    assert(P.offers[P.baseModels[id]]);
    assert.equal(p.sourceStats.nativeProductionQuantity, 1);
    assert(p.layers.length > 5);
    assert(m.weapons.length >= 2);
  }
  const mk = tree.TITANS.find((n) => n.unlocks.includes("ORX_012"));
  assert.deepEqual(mk.unlocks, ["ORX_012", "ORX_013"]);
  assert.equal(mk.points, 16800);
  assert(mk.requires.includes("Tech_TITANS_0087_T2_WoundwortDevelopmentPlan"));
  assert(
    tree.AEUG.find((n) => n.id.endsWith("_ZZGundamDevelopmentPlan")).unlocks.includes(
      "NahelArgamaClass",
    ),
  );
  assert(
    tree.NEO_ZEON.find((n) => n.id.endsWith("_QubeleyDevelopmentPlan")).unlocks.includes(
      "EndraClass",
    ),
  );
});
test("new ships retain separate turret arcs, native hangars and correct space suitability", () => {
  assert.deepEqual(
    prefab("EndraClass").hangars.map((h) => h.capacity),
    [8],
  );
  assert.deepEqual(
    prefab("NahelArgamaClass").hangars.map((h) => h.capacity),
    [12, 12, 12],
  );
  for (const [id, count] of [
    ["EndraClass", 6],
    ["NahelArgamaClass", 30],
  ]) {
    const p = prefab(id);
    assert(p.stats.ship);
    assert.equal(p.stats.modules.length, count);
    assert(p.stats.modules.every((m) => m.hp > 0 && m.arc > 0 && m.bone));
    assert(p.layers.some((l) => l.moduleId));
    assert.equal(p.stats.adaptability.space, 100);
    assert.deepEqual(p.stats.footprint, { width: 2, height: 2 });
  }
  assert.equal(prefab("EndraClass").stats.adaptability.ground, 0);
  assert.equal(prefab("NahelArgamaClass").stats.adaptability.ground, 100);
});
test("Mk-IV and Mk-V preserve one versus two INCOM units and full native firing sequences", () => {
  for (const [id, units, shots] of [
    ["ORX_012", 1, 8],
    ["ORX_013", 2, 16],
  ]) {
    const m = model(id),
      w = m.weapons.find((w) => w.remote);
    assert(w, id);
    assert.equal(w.remote.kind, "incom");
    assert.equal(w.remote.units.length, units);
    assert.equal(w.nativeTiming.projectiles, shots);
    assert.equal(w.attack.strikes.length, shots);
    assert(w.damage > 0);
    assert(w.remote.units.every((u) => u.cycles === 8));
    assert(!w.pilotRequirements?.some((r) => r.stat === "awakening" && r.value > 0));
    assert(m.weapons.some((w) => w.source.file.includes("/" + id + "/Weapon/")));
    assert.equal(prefab(id).sourceStats.nativeProductionQuantity, 1);
    assert(m.cost > prefab(id).costBalance.published);
  }
});
test("duplicate native spawn entries and multiplicities are both preserved by the importer", () => {
  const code =
    "import sys;sys.path.insert(0,'tools');from native_remote_weapons import launches;d={'action_start':{'fireTurretXAtGround':'a'},'turret_a':{'projectile':'p'},'projectile_p':{'spawnUnit':'SameUnit*1(offsetX=15),SameUnit*1(offsetX=-15),OtherUnit*2'}};assert launches(d,'start')==['SameUnit','SameUnit','OtherUnit','OtherUnit']";
  cp.execFileSync("python", ["-c", code], { stdio: "pipe" });
});
test("Nahel Argama MEGA beam is a directional skill and cannot also fire as an ordinary weapon", () => {
  const p = prefab("NahelArgamaClass"),
    m = model(p.id),
    s = p.skills.find((s) => s.type === "irradiation");
  assert(s);
  assert.equal(s.range, 10);
  assert.equal(s.areaWidth, 3);
  assert.equal(
    require("../tools/weapon-store.cjs")
      .parse(fs.readFileSync("assets/units/NahelArgamaClass/unit.json", "utf8"))
      .skills.find((s) => s.id === "Irradiation").baseHit,
    50,
  );
  assert(s.nativeTotalDamage > 0);
  assert(s.nativeRepeatMultiplier > 1);
  assert(Object.values(s.damageComponents).reduce((a, b) => a + b, 0) > 0);
  assert(!m.weapons.some((w) => w.id === s.sourceWeapon));
  assert(p.weapons[s.sourceWeapon].availability.hidden);
  assert(s.muzzle.mounts.length && s.beamSections.length === 3);
});
test("new units resolve shots and spend energy through shared combat rules", () => {
  for (const id of ids) {
    const kit = P.defaultKits[id];
    const g = G.create(
      false,
      714,
      [[{ unitId: id, kitId: kit }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { mapId: "asteroid_crossing_1v1", costLimit: 99999, unitCostLimit: 99999 },
    );
    g.tiles.forEach((row) => row.fill("plain"));
    g.environment = "space";
    g.fogMode = "disabled";
    const [a, b] = g.units;
    Object.assign(a, { x: 8, y: 8, angle: 90, en: 100000 });
    Object.assign(b, { x: prefab(id).stats.ship ? 14 : 10, y: 8, en: 100000 });
    const w = G.modelOf(a).weapons.find((w) => w.type !== "melee" && !w.remote);
    assert(w);
    assert(G.canAttack(g, a, b, w), id);
    const hp = b.hp,
      events = G.fight(g, a, b, w, "defend", null, false);
    assert(events.length);
    assert(b.hp <= hp);
    assert(a.en < 100000);
  }
});

test("Guncannon MP II follows the weakened 0087 native attributes without rebuilding equipment", () => {
  const raw = JSON.parse(fs.readFileSync("assets/units/RX_77D_4/unit.json", "utf8"));
  const p = prefab("RX_77D_4");
  assert.equal(raw.sourceStats.hp, 27500);
  assert.equal(raw.sourceStats.v17BaseHp, 27500);
  assert.equal(raw.sourceStats.boostSpeed, 1.6);
  assert.equal(raw.sourceStats.shooting, 145);
  assert.equal(p.stats.hp, 34500);
  assert.equal(p.stats.accuracy, 135);
  assert.equal(p.stats.speed, 115);
  assert.equal(raw.stats.move, 7);
  assert.equal(p.stats.move, 4);
  assert.equal(p.stats.en, 700);
  assert.equal(p.stats.mobility, 125);
  assert.equal(p.stats.cost, 625);
  assert.equal(p.attackBonuses.shooting, 45);
  assert.equal(p.weapons.EF_RX_77D_4_BeamCannon.nativePayload.BeamDamage, 10000);
  assert.equal(p.weapons.EF_RX_77D_4_BeamGun.nativeTiming.projectiles, 4);
  const script = `import sys,importlib.util,json,copy
sys.path.insert(0,'tools')
spec=importlib.util.spec_from_file_location('sync','tools/sync-0087-guncannon-ii.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=m.loads(open('assets/units/RX_77D_4/unit.json',encoding='utf-8').read())
before=copy.deepcopy(p)
native={'core':{'maxHp':'27500'},'hiddenAction_InitializeStats':{'setUnitMemory':'baseMoveSpeed=0.6,boostMoveSpeed=1.6,baseTurnSpeed=2,baseShootLevel=145,baseAccuracyLevel=135'}}
m.synchronize(p,native)
assert p==before, 'refresh must be idempotent and preserve equipment'
m.synchronize(p,native)
assert p==before
`;
  cp.execFileSync("python", ["-X", "utf8", "-c", script]);
});
