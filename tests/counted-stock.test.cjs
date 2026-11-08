const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules.js"),
  R = require("../shared/battle-economy.js");
const tree = require("../shared/development-tree.json");
function load(
  profile = {
    schemaVersion: 2,
    money: 1000000,
    supplies: 1000000,
    licenses: { Type61: true, RGM_79: true },
  },
) {
  const storage = new Map([
    ["projectgreed.economy.v1", JSON.stringify(profile)],
    [
      "projectgreed.developmentProgress.v1",
      JSON.stringify({
        points: { EFSF: 100000, ZEON: 100000 },
        claimed: {},
        researched: Object.fromEntries(["EFSF", "ZEON"].map((f) => [f, tree[f].map((n) => n.id)])),
      }),
    ],
  ]);
  const context = vm.createContext({
    STARTER_PROFILE: require("../shared/starter-profile.json"),
    PRODUCTION_CATALOG: require("../shared/production-data.cjs"),
    PILOT_DATA: require("../shared/pilots.json"),
    ART: { models: G.models },
    DEVELOPMENT_TREE: tree,
    ProfileMigrations: require("../shared/profile-migrations.js"),
    structuredClone,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  for (const name of ["economy", "development"])
    vm.runInContext(fs.readFileSync(`shared/${name}.js`, "utf8"), context);
  return { ...vm.runInContext("({E:Economy,D:Development})", context), storage, context };
}
const entry = { unitId: "Type61", kitId: "standard" };


test("legacy progress keeps permits, chassis, balances and receipts but discards equipment quantities",()=>{
 const {E}=load({schemaVersion:3,money:1234,supplies:5678,licenses:{RGM_79:true},inventory:{RGM_79:2},kits:{RGM_79__bazooka:999},claimed:{old:"match"}});
 assert.equal(E.quantity("RGM_79"),2);assert(E.hasLicense("RGM_79"));
 assert.equal(E.snapshot().money,1234);assert.equal(E.snapshot().claimed.old,"match");
 assert.equal(JSON.stringify(E.snapshot().kits),"{}");assert.equal(typeof E.buyKit,"undefined");
});
test("each production order charges one chassis regardless of selected kit",()=>{
 const {E}=load();const before=E.snapshot();
 const a=E.productionOffer("RGM_79","beam_spray"),b=E.productionOffer("RGM_79","bazooka");
 assert.equal(a.money,b.money);assert.equal(a.supplies,b.supplies);assert.equal(a.quantity,1);
 assert(E.produce("RGM_79","bazooka","EFSF"));
 assert.equal(E.quantity("RGM_79"),1);assert.equal(E.snapshot().money,before.money-b.money);
 assert.equal(E.snapshot().supplies,before.supplies-b.supplies);assert.equal(JSON.stringify(E.snapshot().kits),"{}");
});
test("stock allocation permits every valid equipment choice while still enforcing chassis counts",()=>{
 const entries=[{unitId:"RGM_79",kitId:"beam_spray"},{unitId:"RGM_79",kitId:"bazooka"}];
 const {E}=load();const stock={inventory:{RGM_79:1},kits:{}};
 assert.equal(E.stockPlan(entries,stock).reasons[1],"stock");
 assert.equal(E.stockPlan([entries[1]],stock).missing.length,0);
 const planned=G.planFormation(entries,Infinity,{licenses:{RGM_79:true},inventory:{RGM_79:2},kits:{}});
 assert.equal(planned.deployable.length,2);assert.throws(()=>E.normalizeStock({inventory:{RGM_79:-1}}));
});
test("bulk replenishment remains atomic and counts the free permit chassis once",()=>{
 const {E,context,storage}=load({schemaVersion:3,money:1000000,supplies:1000000,licenses:{},inventory:{},kits:{}});
 const entries=Array(3).fill({unitId:"RGM_79",kitId:"bazooka"}),plan=E.purchasePlan(entries);
 assert.equal(plan.items.find(i=>i.kind==="licenses").count,1);
 assert.equal(plan.items.find(i=>i.kind==="inventory").count,2);assert(!plan.items.some(i=>i.kind==="kits"));
 const before=JSON.stringify(E.snapshot()),stored=storage.get(E.key),write=context.localStorage.setItem;
 context.localStorage.setItem=()=>{throw Error("quota")};
 assert.throws(()=>E.purchaseMissingStock(entries,"EFSF"),/quota/);
 assert.equal(JSON.stringify(E.snapshot()),before);assert.equal(storage.get(E.key),stored);
 context.localStorage.setItem=write;assert(E.purchaseMissingStock(entries,"EFSF").ok);
 assert.equal(E.quantity("RGM_79"),3);assert.equal(E.purchasePlan(entries).items.length,0);
});
test("loss settlement only consumes chassis and survives reload and duplicate receipts",()=>{
 let {E}=load();assert(E.purchaseMissingStock([entry,entry],"EFSF").ok);
 const result={id:"loss-free-kit",matchId:"match",money:123,supplies:456,stockLost:{inventory:{Type61:1},kits:{Type61__standard:999}}};
 assert(E.creditAward(result));assert.equal(E.quantity("Type61"),1);assert.equal(JSON.stringify(E.snapshot().kits),"{}");
 E=load(JSON.parse(JSON.stringify(E.exportProgress()))).E;
 assert(!E.creditAward(result));assert.equal(E.quantity("Type61"),1);
});
test("activity chassis grants are independent of development, permits and obsolete kit rewards",()=>{
 const {E}=load({schemaVersion:3,money:0,supplies:0,licenses:{},inventory:{},kits:{}});
 const award={id:"stock-only",matchId:"mail",money:0,supplies:0,inventory:{RGM_79:2},kits:{RGM_79__bazooka:9}};
 assert(E.creditActivity(award));assert.equal(E.quantity("RGM_79"),2);assert(!E.hasLicense("RGM_79"));
 assert.equal(E.stockPlan([{unitId:"RGM_79",kitId:"bazooka"}],E.snapshot()).missing.length,0);
 assert.equal(JSON.stringify(E.snapshot().kits),"{}");assert(!E.creditActivity(award));
});
test("technology allocation retains faction weights and redistributes saturated factions",()=>{
 assert.deepEqual(R.allocateTechnology(600,{EFSF:10,ZEON:1},{EFSF:999},{EFSF:1000,ZEON:1000}),{EFSF:1,ZEON:599});
 assert.equal(R.technologyReward(true,"regular"),660);assert.equal(R.technologyReward(false,"quick"),54);
});
