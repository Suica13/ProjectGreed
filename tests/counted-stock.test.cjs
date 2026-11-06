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

test("legacy permits migrate to zero chassis/kit stock once, retaining money and receipts", () => {
  const { E, storage } = load({
    schemaVersion: 2,
    money: 1234,
    supplies: 5678,
    licenses: { Type61: true },
    claimed: { old: "match" },
  });
  assert.equal(E.quantity("Type61"), 0);
  assert.equal(E.kitQuantity("Type61__standard"), 0);
  assert(E.hasLicense("Type61"));
  assert.equal(E.snapshot().money, 1234);
  assert.equal(E.snapshot().claimed.old, "match");
  assert.equal(E.snapshot().schemaVersion, 3);
  assert(storage.has(E.key + ".before-counted-stock"));
  const old = load({
    money: 100000,
    supplies: 100000,
    inventory: { Type61: 99 },
    kits: { Type61__standard: 99 },
  }).E;
  assert(old.hasLicense("Type61"));
  assert.equal(old.quantity("Type61"), 0);
  assert(old.produce("Type61", "standard", "EFSF"));
  const again = load(JSON.parse(JSON.stringify(old.exportProgress()))).E;
  assert.equal(again.quantity("Type61"), 1);
  assert.equal(again.kitQuantity("Type61__standard"), 1);
});

test("production buys exactly one chassis and selected kit at per-unit prices", () => {
  const { E } = load();
  const quote = E.productionOffer("Type61", "standard"),
    before = E.snapshot();
  assert.equal(quote.quantity, 1);
  assert.equal(quote.chassis.quantity, 1);
  assert(E.produce("Type61", "standard", "EFSF"));
  assert.equal(E.quantity("Type61"), 1);
  assert.equal(E.kitQuantity("Type61__standard"), 1);
  assert.equal(E.snapshot().money, before.money - quote.money);
  assert.equal(E.snapshot().supplies, before.supplies - quote.supplies);
  assert(E.buyKit("Type61", "standard", "EFSF"));
  assert.equal(E.quantity("Type61"), 1);
  assert.equal(E.kitQuantity("Type61__standard"), 2);
});

test("kit changes allocate separate inventory without refund or discarding old equipment", () => {
  const { E } = load();
  assert(E.produce("RGM_79", "beam_spray", "EFSF"));
  const before = E.snapshot();
  assert(E.buyKit("RGM_79", "bazooka", "EFSF"));
  const snapshot = E.snapshot(),
    spray = { unitId: "RGM_79", kitId: "beam_spray" },
    bazooka = { ...spray, kitId: "bazooka" };
  assert.equal(E.stockPlan([spray], snapshot).missing.length, 0);
  assert.equal(E.stockPlan([bazooka], snapshot).missing.length, 0);
  assert.equal(E.stockPlan([spray, bazooka], snapshot).reasons[1], "stock");
  assert.equal(E.kitQuantity("RGM_79__beam_spray"), 1);
  assert.equal(E.kitQuantity("RGM_79__bazooka"), 1);
  assert.equal(E.quantity("RGM_79"), 1);
  assert(E.snapshot().money < before.money);
  assert.deepEqual(JSON.parse(JSON.stringify(E.snapshot())), JSON.parse(JSON.stringify(snapshot)));
});

test("bulk replenishment buys only deficits, totals duplicate units, and rolls back failures", () => {
  const { E, context, storage } = load();
  const entries = Array(3).fill(entry);
  const plan = E.purchasePlan(entries);
  assert.equal(plan.items.find((i) => i.kind === "inventory").count, 3);
  const before = JSON.stringify(E.snapshot()),
    stored = storage.get(E.key),
    original = context.localStorage.setItem;
  context.localStorage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => E.purchaseMissingStock(entries, "EFSF"), /quota/);
  assert.equal(JSON.stringify(E.snapshot()), before);
  assert.equal(storage.get(E.key), stored);
  context.localStorage.setItem = original;
  assert(E.purchaseMissingStock(entries, "EFSF").ok);
  assert.equal(E.quantity("Type61"), 3);
  assert.equal(E.kitQuantity("Type61__standard"), 3);
  assert.equal(E.purchasePlan(entries).items.length, 0);
  assert.equal(E.snapshot().money, JSON.parse(before).money - plan.money);
  assert(!E.produce("Type61", "fake", "EFSF"));
  assert(!E.produce("Type61", "standard", "ZEON"));
});

test("deployment reservations and survivor returns are persistent, idempotent and keep permits", () => {
  const { E } = load();
  assert(E.purchaseMissingStock([entry, entry], "EFSF").ok);
  const used = { inventory: { Type61: 2 }, kits: { Type61__standard: 2 } };
  const reserve = { id: "deploy", matchId: "match", money: 0, supplies: 0, stockUsed: used };
  assert(E.creditAward(reserve));
  assert(!E.creditAward(reserve));
  assert.equal(E.quantity("Type61"), 0);
  const returned = { inventory: { Type61: 1 }, kits: { Type61__standard: 1 } };
  const award = {
    id: "result",
    matchId: "match",
    money: 10,
    supplies: 20,
    stockReturned: returned,
  };
  assert(E.creditAward(award));
  assert(!E.creditAward(award));
  assert(E.hasLicense("Type61"));
  assert.equal(E.quantity("Type61"), 1);
  assert.equal(E.kitQuantity("Type61__standard"), 1);
  const restored = load(JSON.parse(JSON.stringify(E.exportProgress()))).E;
  assert(!restored.creditAward(reserve));
  assert(!restored.creditAward(award));
  assert.equal(restored.quantity("Type61"), 1);
});

test("shared formation rules enforce chassis and equipment stock separately including preloads", () => {
  const restrictions = {
    licenses: { Type61: true },
    inventory: { Type61: 3 },
    kits: { Type61__standard: 1 },
  };
  const plan = G.planFormation([entry, entry, entry], Infinity, restrictions);
  assert.equal(plan.deployable.length, 1);
  assert.equal(plan.reasons[1], "kit_stock");
  const zero = G.planFormation([entry], Infinity, { ...restrictions, inventory: {} });
  assert.equal(zero.reasons[0], "stock");
  const carrier = { unitId: "Medea", kitId: "standard" };
  const cargo = { ...entry, preload: { carrierIndex: 0, hangarId: "Hangar_1" } };
  const loaded = G.planFormation([carrier, cargo, cargo], Infinity, {
    licenses: { Medea: true, Type61: true }, inventory: { Medea: 1, Type61: 2 },
    kits: { Medea__standard: 1, Type61__standard: 1 },
  });
  assert.equal(loaded.deployable.length, 2);
  assert.equal(loaded.reasons[2], "kit_stock");
  assert.throws(() => G.normalizeStock({ inventory: { Type61: -1 } }));
  assert.throws(() => G.normalizeStock({ kits: { Type61__fake: 1 } }));
  assert.throws(() => G.normalizeStock({ inventory: { Type61: 1.5 } }));
  assert.throws(() => G.normalizeStock({ inventory: [] }));
});

test("fixed technology progresses by completed matches, never army size or kill count", () => {
  assert.equal(R.technologyReward(true, "regular"), 660);
  assert.equal(R.technologyReward(false, "regular"), 540);
  assert.equal(R.technologyReward(true, "quick"), 66);
  assert.equal(R.technologyReward(false, "quick"), 54);
  assert.equal(R.technologyReward(true, "regular", 2), 1320);
});


test("permit costs three default production orders, gifts once, and never reprices production", () => {
  const {E}=load({schemaVersion:3,money:1000000,supplies:1000000,licenses:{},inventory:{},kits:{}});
  const before=E.productionOffer("RGM_79",E.defaultKit("RGM_79")), permit=E.licenseOffer("RGM_79");
  assert.equal(permit.money,before.money*3); assert.equal(permit.supplies,before.supplies*3);
  assert(E.purchaseLicense("RGM_79","EFSF"));
  assert.equal(E.quantity("RGM_79"),1); assert.equal(E.kitQuantity("RGM_79__beam_spray"),1);
  assert.equal(E.kitQuantity("RGM_79__bazooka"),0);
  assert.equal(JSON.stringify(E.productionOffer("RGM_79","beam_spray")),JSON.stringify(before));
  const after=JSON.stringify(E.snapshot()); assert(!E.purchaseLicense("RGM_79","EFSF"));
  assert.equal(JSON.stringify(E.snapshot()),after);
  const reloaded=load(JSON.parse(JSON.stringify(E.exportProgress()))).E;
  assert.equal(reloaded.quantity("RGM_79"),1); assert(!reloaded.purchaseLicense("RGM_79","EFSF"));
});

test("bulk replenishment credits permit gifts toward deficits including alternate kits", () => {
  const fresh=()=>load({schemaVersion:3,money:1000000,supplies:1000000,licenses:{},inventory:{},kits:{}}).E;
  const E=fresh(), normal={unitId:"RGM_79",kitId:"beam_spray"};
  const plan=E.purchasePlan([normal,normal,normal]);
  assert.equal(plan.items.find(i=>i.kind==="inventory").count,2);
  assert.equal(plan.items.find(i=>i.kind==="kits").count,2);
  assert.equal(plan.money,E.licenseOffer("RGM_79").money+2*E.productionOffer("RGM_79","beam_spray").money);
  assert(E.purchaseMissingStock([normal,normal,normal],"EFSF").ok);
  assert.equal(E.quantity("RGM_79"),3); assert.equal(E.kitQuantity("RGM_79__beam_spray"),3);
  const A=fresh(), alternate={...normal,kitId:"bazooka"}, other=A.purchasePlan([alternate]);
  assert(!other.items.some(i=>i.kind==="inventory"));
  assert.equal(other.items.find(i=>i.kind==="kits").id,"RGM_79__bazooka");
  assert(A.purchaseMissingStock([alternate],"EFSF").ok);
  assert.equal(A.quantity("RGM_79"),1); assert.equal(A.kitQuantity("RGM_79__beam_spray"),1);assert.equal(A.kitQuantity("RGM_79__bazooka"),1);
});


test("PMC allocations use largest remainders, honor caps, and conserve every allocatable point",()=>{
  const factions=["EFSF","ZEON","AEUG"];
  for(let total=1;total<=37;total++)for(let cap=0;cap<=12;cap++){
    const weights={EFSF:10,ZEON:1,AEUG:2}, balances={EFSF:20-cap,ZEON:19,AEUG:15};
    const limits={EFSF:20,ZEON:20,AEUG:20};
    const awards=R.allocateTechnology(total,weights,balances,limits);
    assert.equal(Object.values(awards).reduce((sum,n)=>sum+n,0),Math.min(total,cap+1+5));
    for(const faction of factions){assert(Number.isInteger(awards[faction]||0));assert((awards[faction]||0)<=limits[faction]-balances[faction])}
    assert.deepEqual(R.allocateTechnology(total,weights,balances,limits),awards);
  }
  assert.deepEqual(R.allocateTechnology(1,{EFSF:1,ZEON:1},{},{EFSF:10,ZEON:10}),{EFSF:1});
  assert.deepEqual(R.technologyFactions({tags:["EFSF","0079T1","EFSF"],availableFactions:["AEUG","TITANS"],faction:"EFSF"}),["AEUG","EFSF","TITANS"]);
});
