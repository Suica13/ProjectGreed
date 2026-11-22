const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const G = require("../shared/rules"),
  Codec = require("../shared/save-codec");
function load(saved) {
  const data = new Map(saved ? [["projectgreed.economy.v1", Codec.stringify(saved)]] : []);
  let fail = false;
  const context = vm.createContext({
    require: require("node:module").createRequire(path.resolve("shared/economy.js")),
    module: { exports: {} },
    ART: G.catalog,
    structuredClone,
    localStorage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (fail && k === "projectgreed.playerId") throw Error("write failed");
        data.set(k, v);
      },
      removeItem: (k) => data.delete(k),
    },
  });
  vm.runInContext(fs.readFileSync("shared/economy.js", "utf8"), context);
  return { E: context.module.exports, data, fail: () => (fail = true) };
}
test("new profiles have empty stock until explicit faction selection; existing profiles never receive another grant", () => {
  for (const faction of ["EFSF", "ZEON"]) {
    const { E, data } = load();
    assert.equal(E.snapshot().onboardingPending, true);
    assert.deepEqual(Object.keys(E.snapshot().inventory), []);
    assert.equal(E.snapshot().money, 8000);
    assert.equal(E.snapshot().supplies, 8000);
    assert(E.completeOnboarding(faction, [["projectgreed.playerId", "Test PMC"]]));
    const state = E.snapshot(),
      expected = E.startingFactions()[faction].inventory;
    assert.deepEqual(
      JSON.parse(JSON.stringify(state.inventory)),
      JSON.parse(JSON.stringify(expected)),
    );
    assert.equal(state.storage.units.length, 3);
    assert.equal(state.storage.ships.length, 2);
    assert.equal(state.startingFaction, faction);
    assert(!state.onboardingPending);
    for (const item of [...state.storage.units, ...state.storage.ships])
      assert(G.models[item.unitId + "__" + item.kitId]);
    assert.equal(data.get("projectgreed.playerId"), "Test PMC");
    assert.equal(E.completeOnboarding(faction), false);
    const reloaded = load(state).E;
    assert.equal(JSON.stringify(reloaded.snapshot()), JSON.stringify(state));
    assert.equal(reloaded.completeOnboarding(faction), false);
    delete state.startingFaction;
    delete state.onboardingPending;
    const old = load(state).E;
    assert(!old.snapshot().onboardingPending);
    assert.equal(old.completeOnboarding(faction), false);
    assert.equal(JSON.stringify(old.snapshot().inventory), JSON.stringify(state.inventory));
  }
});
test("company registration rolls back equipment, completion marker and company name together on failed persistence", () => {
  const { E, data, fail } = load(),
    before = JSON.stringify(E.snapshot());
  fail();
  assert.throws(
    () => E.completeOnboarding("EFSF", [["projectgreed.playerId", "Test PMC"]]),
    /write failed/,
  );
  assert.equal(JSON.stringify(E.snapshot()), before);
  assert.equal(data.get(E.key), undefined);
  assert.throws(() => E.completeOnboarding("AEUG"), /初始势力/);
  assert.equal(JSON.stringify(E.snapshot()), before);
});
test("starter configurations are faction-specific and mission mode is disabled at create and start validation", () => {
  const { E } = load();
  assert.deepEqual(JSON.parse(JSON.stringify(E.initial("EFSF").inventory)), {
    RGM_79_Commander: 1,
    RGM_79: 2,
    MedeaKai: 1,
    ColumbusClass: 1,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(E.initial("ZEON").inventory)), {
    MS_06F2_Commander: 1,
    MS_06F2: 2,
    FatUncleKai: 1,
    PapuaClass: 1,
  });
  assert.throws(() => G.validateBattleMode("mission"), /暂时锁定/);
  assert.throws(() => G.validateOpenContent({ mode: "mission" }), /暂时锁定/);
  assert.equal(G.validateBattleMode("quick"), "quick");
  assert.equal(G.validateBattleMode("sweep"), "sweep");
});
test("beam gun kits match bazookas while rifles and imported payloads stay intact", () => {
  const prefab = (id) => G.catalog.prefabs.find((p) => p.id === id);
  const gm = prefab("RGM_79");
  assert.equal(gm.weaponKits.find((k) => k.id === "beam_spray").cost, 25);
  assert.equal(gm.weaponKits.find((k) => k.id === "bazooka").cost, 25);
  assert.equal(prefab("RGM_79_Commander").weaponKits.find((k) => k.id === "kit_0").cost, 25);
  const rifle = prefab("RGC_83").weaponKits.find((k) => k.id === "kit_2");
  assert.equal(rifle.cost, 50);
  const cannon = G.models.MS_06K__machine_gun.weapons.find(
    (w) => w.sourceName === "Common_Cannon_AntiAir",
  );
  assert.equal(cannon.damagePerShot, 2250);
  assert.equal(cannon.damageComponents.shell, 2250);
  const gatling = G.models.MS_06JK__kit_0.weapons.find(
    (w) => w.sourceName === "ZN_MS_06JK_Gatling",
  );
  assert.equal(gatling.name, "肩部加特林");
  assert.equal(gatling.damagePerShot, 250);
  assert.equal(gatling.attackRounds, 1);
  assert.equal(gatling.targetModifiers.air, 1.5);
  assert.equal(gatling.shotCount, 30);
  assert.equal(gatling.damage, 7500);
  assert.equal(gatling.nativePayload.ShellDamage, 350);
  assert.equal(gatling.nativePayload.AntiAir, 1.75);
});
