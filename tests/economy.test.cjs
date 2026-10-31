const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const catalog = require("../shared/production-catalog.json"),
  tree = require("../shared/development-tree.json"),
  models = require("../tools/load-catalog.cjs").loadCatalog().models;
function load(saved = {}) {
  const storage = new Map(Object.entries(saved));
  const context = vm.createContext({
    PRODUCTION_CATALOG: catalog,
    ProfileMigrations: require("../shared/profile-migrations.js"),
    PILOT_DATA: require("../shared/pilots.json"),
    structuredClone,
    DEVELOPMENT_TREE: tree,
    ART: { models },
    module: { exports: {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  for (const source of ["economy", "development"])
    vm.runInContext(
      fs.readFileSync(require.resolve("../shared/" + source + ".js"), "utf8"),
      context,
    );
  return { ...vm.runInContext("({ E: Economy, D: Development })", context), context, storage };
}
const rich = { money: 1000000, supplies: 1000000, inventory: {}, kits: {} };
function funded() {
  return load({ "projectgreed.economy.v1": JSON.stringify(rich) });
}

// Legacy consumable-kit and sale checks were replaced by deployment-licenses.test.cjs.

test("research spends technology points, money and supplies together with rollback", () => {
  const { E, D, context, storage } = funded();
  const node = tree.EFSF.find(
    (n) => n.points && n.requires.every((id) => D.unlockedTech("EFSF").includes(id)),
  );
  D.creditAward({ id: "credit", matchId: "test", faction: "EFSF", points: 100000 });
  const before = JSON.stringify(E.snapshot());
  const beforeStored = storage.get(E.key);
  const set = context.localStorage.setItem;
  let failed = false;
  context.localStorage.setItem = (key, value) => {
    if (!failed && key.includes("developmentProgress")) {
      failed = true;
      throw Error("quota");
    }
    set(key, value);
  };
  assert.throws(() => D.research("EFSF", node.id), /quota/);
  assert.equal(JSON.stringify(E.snapshot()), before);
  assert.equal(storage.get(E.key), beforeStored);
  assert.equal(D.pointBalance("EFSF"), 100000);
  assert(!D.unlockedTech("EFSF").includes(node.id));
  context.localStorage.setItem = set;
  assert(D.research("EFSF", node.id));
  assert.equal(E.snapshot().money, rich.money - node.money);
  assert.equal(E.snapshot().supplies, rich.supplies - node.supplies);
  assert.equal(D.pointBalance("EFSF"), 100000 - node.points);
  const restored = load(Object.fromEntries(storage));
  assert(restored.D.unlockedTech("EFSF").includes(node.id));
  assert.equal(restored.E.snapshot().money, E.snapshot().money);
});

test("technology cannot bypass resource costs and prices retain original timing metadata", () => {
  const { E, D } = load();
  const node = tree.EFSF.find(
    (n) => n.money > 5000 && n.requires.every((id) => D.unlockedTech("EFSF").includes(id)),
  );
  D.creditAward({ id: "points", matchId: "test", faction: "EFSF", points: 100000 });
  assert(!D.research("EFSF", node.id));
  assert.equal(E.snapshot().money, 5000);
  for (const nodes of Object.values(tree))
    for (const n of nodes) {
      assert.equal(n.money, n.sourceCosts.money * 2);
      assert.equal(n.supplies, n.sourceCosts.supplies * 2);
      assert(Number.isFinite(n.sourceCosts.researchSeconds));
    }
  for (const [id, offer] of Object.entries(catalog.offers)) {
    assert(models[id]);
    assert(offer.money > 0 && offer.supplies > 0);
    assert.equal(
      offer.quantity,
      offer.source.outputs.reduce((n, o) => n + o.quantity, 0),
    );
    assert(offer.source.buildSeconds >= 0 && offer.source.queueSeconds >= 0);
  }
  assert.throws(() => E.validate({ ...rich, kits: { obsolete: 1 } }));
  assert.throws(() => E.validate({ ...rich, inventory: { Type61: -1 } }));
});

test("native factory batch and mixed-kit metadata stay archived behind license pricing", () => {
  const { E } = load();
  const offer = catalog.offers[E.baseModel("Type61A5")];
  assert.equal(catalog.equipmentPolicy, "free-equipment-deployment-license");
  assert.equal(new Set(offer.source.outputs.map((o) => o.equipmentIndex)).size, 2);
  assert.equal(offer.output.kitId, "standard");
  assert.equal(offer.output.quantity, 3);
  assert.equal(offer.output.unitId, "Type61A5");
});

test("activity licenses, currency, development and receipt persist together or roll back together",()=>{
 const {E,D,context,storage}=load();const before=E.snapshot();
 const award={id:"server-mail:test:welcome",matchId:"server-test",money:5000,supplies:10000,licenses:{RGM_79_G:true,MS_09:true},unlockUnits:["RGM_79_G"]};
 assert(D.receiveActivity(award));assert.equal(E.snapshot().money,before.money+5000);assert.equal(E.hasLicense("RGM_79_G"),true);assert(D.allows("EFSF","RGM_79_G"));
 assert.equal(D.receiveActivity(award),false);assert.equal(E.hasLicense("RGM_79_G"),true);
 const restored=load(Object.fromEntries(storage));assert.equal(restored.D.receiveActivity(award),false);
 const persisted=JSON.stringify(E.snapshot()),research=JSON.stringify(D.exportProgress()),original=context.localStorage.setItem;
 context.localStorage.setItem=(key,value)=>{if(key==="projectgreed.developmentProgress.v1")throw Error("quota");original(key,value);};
 assert.throws(()=>D.receiveActivity({...award,id:"server-mail:test:second",unlockUnits:["MS_09"]}));assert.equal(JSON.stringify(E.snapshot()),persisted);assert.equal(JSON.stringify(D.exportProgress()),research);
});


test("license purchase cannot overspend or change memory when persistence fails",()=>{
 const {E,context,storage}=funded();const before=JSON.stringify(E.snapshot()),persisted=storage.get(E.key);
 assert(!E.transact({money:1000001,supplies:0}));
 context.localStorage.setItem=()=>{throw Error("quota");};
 assert.throws(()=>E.purchaseLicense("Type61","EFSF"),/quota/);
 assert.equal(JSON.stringify(E.snapshot()),before);assert.equal(storage.get(E.key),persisted);
});
