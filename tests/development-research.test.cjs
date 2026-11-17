const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const tree = require("../shared/development-tree.json");
function load(saved = {}) {
  const storage = new Map(Object.entries(saved));
  if (!storage.has("projectgreed.economy.v1"))
    storage.set(
      "projectgreed.economy.v1",
      JSON.stringify({ schemaVersion: 2, money: 1000000, supplies: 1000000, licenses: {} }),
    );
  const context = {
    structuredClone,
    SaveCodec: require("../shared/save-codec.js"),
    STARTER_PROFILE: require("../shared/starter-profile.json"),
    PRODUCTION_CATALOG: require("../shared/production-catalog.json"),
    DEVELOPMENT_TREE: tree,
    PILOT_DATA: require("../shared/pilots.json"),
    PilotSystem: require("../shared/pilots.js"),
    ProfileMigrations: require("../shared/profile-migrations.js"),
    module: { exports: {} },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("../shared/economy.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../shared/development.js"), "utf8"), context);
  return { D: context.module.exports, storage, context };
}
test("research checks cumulative thresholds without spending, invalidates cached units and survives reload", () => {
  const { D, storage } = load();
  const first = tree.EFSF.find(
    (n) => n.points > 0 && n.requires.every((id) => D.unlockedTech("EFSF").includes(id)),
  );
  const later = tree.EFSF.find((n) => n.requires.includes(first.id));
  const unit = first.unlocks.find((id) => !D.allows("EFSF", id));
  assert.equal(D.research("EFSF", first.id), false);
  D.creditAward({ id: "award", matchId: "match", faction: "EFSF", points: 100000 });
  if (later) assert.equal(D.research("EFSF", later.id), false);
  assert.equal(D.research("ZEON", first.id), false);
  assert.equal(D.research("EFSF", first.id), true);
  assert.equal(D.pointBalance("EFSF"), 100000);
  assert.equal(D.research("EFSF", first.id), false);
  assert(D.allows("EFSF", unit));
  assert(D.allows("PMC", unit));
  const restored = load(Object.fromEntries(storage)).D;
  assert(restored.allows("EFSF", unit));
  assert.equal(restored.pointBalance("EFSF"), D.pointBalance("EFSF"));
  const G = require("../shared/rules.js");
  const prefab = G.catalog.prefabs.find((p) => first.unlocks.includes(p.id));
  const rules = G.armyRestrictions(G.defaultRoomSettings(), {
    seat: 0,
    characterFaction: "EFSF",
    researched: restored.researchSnapshot(),
  });
  assert.notEqual(
    G.planFormation([{ unitId: prefab.id, kitId: prefab.weaponKits[0].id }], Infinity, rules)
      .reasons[0],
    "not_developed",
  );
});
test("failed persistence never spends points or unlocks technology", () => {
  const { D, context } = load();
  D.creditAward({ id: "a", matchId: "m", faction: "EFSF", points: 100000 });
  const node = tree.EFSF.find(
    (n) => n.points > 0 && n.requires.every((id) => D.unlockedTech("EFSF").includes(id)),
  );
  context.localStorage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => D.research("EFSF", node.id), /quota/);
  assert.equal(D.pointBalance("EFSF"), 100000);
  assert(!D.unlockedTech("EFSF").includes(node.id));
});
test("specific unit grants are an OR alternative without unlocking technology or sibling units", () => {
  const { D, storage } = load();
  const node = tree.EFSF.find(
    (n) => n.points > 0 && n.unlocks.filter((id) => !D.allows("EFSF", id)).length > 1,
  );
  const [unit, sibling] = node.unlocks.filter((id) => !D.allows("EFSF", id));
  assert(D.grantUnit("EFSF", unit));
  assert(D.allows("PMC", unit));
  assert(!D.allows("EFSF", sibling));
  assert(!D.unlockedTech("EFSF").includes(node.id));
  assert.equal(D.pointBalance("EFSF"), 0);
  assert(!D.grantUnit("EFSF", "invalid"));
  assert(!D.grantUnit("ZEON", unit));
  const restored = load(Object.fromEntries(storage)).D;
  assert(restored.allows("EFSF", unit));
  assert(D.allows("PMC", unit, restored.researchSnapshot()));
  assert(!D.allows("PMC", sibling, restored.researchSnapshot()));
});


test("Mk-IV / Mk-V final branch persists through rewards, profile export and repeated reloads", () => {
  const id="Tech_TITANS_0087_T2_GundamMkIVVDevelopmentPlan";
  const researched=Object.fromEntries(Object.entries(tree).map(([f,nodes])=>[f,nodes.filter(n=>n.id!==id).map(n=>n.id)]));
  let f=load({"projectgreed.developmentProgress.v1":JSON.stringify({points:{TITANS:100000},claimed:{},researched})});
  assert(!f.D.unlockedTech("TITANS").includes(id));
  assert(f.D.research("TITANS",id));
  for(let i=0;i<3;i++){
    assert(f.D.unlockedTech("TITANS").includes(id));
    for(const unit of ["ORX_012","ORX_013"])assert(f.D.allows("PMC",unit));
    f.D.creditAward({id:"persistence-"+i,matchId:"match",faction:"TITANS",points:25});
    const exported=f.D.validateProgress(f.D.exportProgress());
    assert(exported.researched.TITANS.includes(id));
    f=load(Object.fromEntries(f.storage));
    assert(f.D.unlockedTech("TITANS").includes(id));
  }
});
