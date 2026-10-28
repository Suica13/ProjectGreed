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

test("new wallet, cheapest base batch, no free production, and persistence", () => {
  const { E, storage } = load();
  assert.equal(E.snapshot().money, 5000);
  assert.equal(E.snapshot().supplies, 10000);
  assert.equal(E.quantity("Type61"), 24);
  const offer = catalog.offers[E.baseModel("Type61")];
  assert(E.produce("Type61", "EFSF"));
  assert.equal(E.quantity("Type61"), 24 + offer.quantity);
  assert.equal(E.snapshot().money, 5000 - offer.money);
  assert.equal(E.snapshot().supplies, 10000 - offer.supplies);
  assert.equal(load(Object.fromEntries(storage)).E.quantity("Type61"), 24 + offer.quantity);
  const before = JSON.stringify(E.snapshot());
  assert(!E.produce("RX_78_2", "EFSF")); // technology locked
  assert(!E.produce("Type61", "ZEON")); // wrong faction
  assert(!E.produce("unknown", "PMC"));
  assert.equal(JSON.stringify(E.snapshot()), before);
});

test("kit prices use rounded per-unit differences, purchased in original batches", () => {
  const { E, D } = funded();
  D.grantUnit("ZEON", "MS_06F");
  assert.equal(E.baseKit("MS_06F"), "machine_gun");
  const price = E.kitPrice("MS_06F__bazooka");
  assert.equal(price.money, 0);
  assert.equal(price.supplies, 600);
  assert.equal(price.quantity, 3);
  assert.equal(E.kitPrice("MS_06F__machine_gun"), null);
  assert(E.buyKit("MS_06F__bazooka", "ZEON"));
  assert.equal(E.kitQuantity("MS_06F__bazooka"), 3);
  assert.equal(E.snapshot().supplies, rich.supplies - 600);
  assert.equal(E.quantity("MS_06F"), 0); // kit purchase never creates a chassis
  const entries = Array.from({ length: 4 }, () => ({ unitId: "MS_06F", kitId: "bazooka" }));
  const fitted = E.fitKits(entries);
  assert.deepEqual(
    Array.from(fitted, (e) => e.kitId),
    ["bazooka", "bazooka", "bazooka", "machine_gun"],
  );
  assert.equal(E.freeKits("MS_06F__bazooka", fitted), 0);
  assert.equal(E.freeKits("MS_06F__bazooka", fitted, 0), 1);
  assert.equal(E.kitQuantity("MS_06F__bazooka"), 3); // reservations are reversible
  assert.equal(E.baseKit("RX_78_2"), "kit_0"); // original bazooka version is cheapest
});

test("no overspend and no inventory gain when storage fails", () => {
  const { E, context, storage } = load();
  const before = JSON.stringify(E.snapshot());
  assert(!E.transact({ money: 5001, supplies: 0 }));
  context.localStorage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => E.produce("Type61", "EFSF"), /quota/);
  assert.equal(JSON.stringify(E.snapshot()), before);
  assert.equal(storage.get(E.key), undefined);
});

test("research spends technology points, money and supplies together with rollback", () => {
  const { E, D, context, storage } = funded();
  const node = tree.EFSF.find(
    (n) => n.points && n.requires.every((id) => D.unlockedTech("EFSF").includes(id)),
  );
  D.creditAward({ id: "credit", matchId: "test", faction: "EFSF", points: 100000 });
  const before = JSON.stringify(E.snapshot());
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
  assert.equal(storage.get(E.key), JSON.stringify(rich));
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
  assert.throws(() => E.validate({ ...rich, kits: { fake: 1 } }));
  assert.throws(() => E.validate({ ...rich, inventory: { Type61: -1 } }));
});

test("mixed native factory squads produce one uniform current kit", () => {
  const { E } = load();
  const offer = catalog.offers[E.baseModel("Type61A5")];
  assert.equal(catalog.equipmentPolicy, "uniform-kit");
  assert.equal(new Set(offer.source.outputs.map((o) => o.equipmentIndex)).size, 2);
  assert.equal(offer.output.kitId, "standard");
  assert.equal(offer.output.quantity, 3);
  assert.equal(offer.output.unitId, "Type61A5");
});

test("one-click production rounds shortages to full batches and commits the entire order once", () => {
  const { E, D, storage } = funded();
  D.grantUnit("ZEON", "MS_06F");
  const entries = [
    ...Array.from({ length: 7 }, () => ({ unitId: "Type61", kitId: "standard" })),
    ...Array.from({ length: 4 }, () => ({ unitId: "MS_06F", kitId: "machine_gun" })),
  ];
  const plan = E.productionPlan(entries),
    before = E.snapshot();
  assert.equal(plan.items.find((i) => i.unitId === "Type61").quantity, 9);
  assert.equal(plan.items.find((i) => i.unitId === "MS_06F").quantity, 6);
  assert(E.produceMissing(entries, "PMC").ok);
  assert.equal(E.quantity("Type61"), 9);
  assert.equal(E.quantity("MS_06F"), 6);
  assert.equal(E.snapshot().money, before.money - plan.money);
  assert.equal(E.snapshot().supplies, before.supplies - plan.supplies);
  assert.equal(E.productionPlan(entries).items.length, 0);
  assert.equal(load(Object.fromEntries(storage)).E.quantity("Type61"), 9);
});
test("one-click production cancels the whole order on insufficient currency, locked units, or failed storage", () => {
  const low = load({
    "projectgreed.economy.v1": JSON.stringify({
      money: 0,
      supplies: 100000,
      inventory: {},
      kits: {},
    }),
  });
  const entries = Array.from({ length: 7 }, () => ({ unitId: "Type61", kitId: "standard" }));
  const before = JSON.stringify(low.E.snapshot());
  assert(!low.E.produceMissing(entries, "EFSF").ok);
  assert.equal(JSON.stringify(low.E.snapshot()), before);
  const { E, context } = funded(),
    original = JSON.stringify(E.snapshot());
  const unavailable = E.produceMissing([...entries, { unitId: "RX_78_2", kitId: "kit_0" }], "EFSF");
  assert(!unavailable.ok);
  assert.deepEqual(Array.from(unavailable.units), ["RX_78_2"]);
  assert.equal(JSON.stringify(E.snapshot()), original);
  context.localStorage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => E.produceMissing(entries, "EFSF"), /quota/);
  assert.equal(JSON.stringify(E.snapshot()), original);
});

test("early model-keyed inventory migrates without losing money, chassis or paid equipment", () => {
  const legacy = {
    money: 1234,
    supplies: 5678,
    inventory: { MS_06F__machine_gun: 3, MS_06F__bazooka: 3 },
  };
  const raw = JSON.stringify(legacy),
    { E, storage } = load({ "projectgreed.economy.v1": raw });
  assert.equal(E.snapshot().money, 1234);
  assert.equal(E.snapshot().supplies, 5678);
  assert.equal(E.quantity("MS_06F"), 6);
  assert.equal(E.kitQuantity("MS_06F__bazooka"), 3);
  assert.equal(storage.get(E.key + ".before-unit-inventory"), raw);
  const restored = load(Object.fromEntries(storage)).E;
  assert.equal(restored.quantity("MS_06F"), 6);
  assert.equal(restored.kitQuantity("MS_06F__bazooka"), 3);
  assert(restored.produce("Type61", "EFSF"));
  assert.equal(E.validate(legacy).inventory.MS_06F, 6); // Imported profiles use the same migration.
});

test("battle credits and final losses are atomic, deduplicated, restored, and retain claims in saves", () => {
  const { E, storage, context } = load();
  const award = { id: "kill-1", matchId: "match", money: 400, supplies: 0 };
  assert(E.creditAward(award));
  assert(!E.creditAward(award));
  assert.equal(E.snapshot().money, 5400);
  const result = { id: "end-1", matchId: "match", money: 1350, supplies: 2700, losses: { Type61: 2 } };
  assert(E.creditAward(result));
  assert.equal(E.quantity("Type61"), 22);
  const restored = load(Object.fromEntries(storage)).E;
  assert(!restored.creditAward(result));
  assert.equal(restored.snapshot().money, 6750);
  assert.equal(restored.snapshot().supplies, 12700);
  assert.equal(restored.quantity("Type61"), 22);
  const before = JSON.stringify(E.snapshot());
  const setItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw Error("quota"); };
  assert.throws(() => E.creditAward({ ...result, id: "retry" }), /quota/);
  assert.equal(JSON.stringify(E.snapshot()), before);
  context.localStorage.setItem = setItem;
  assert(E.creditAward({ ...result, id: "retry" }));
});
test("new profiles contain starter units while existing inventories are preserved", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(load().E.snapshot().inventory)),
    { Type61: 24, FF_B2: 12, Medea: 3, MS_06F: 4, MS_06S: 2, FatUncle: 3 });
  const existing = load({ "projectgreed.economy.v1": JSON.stringify({ ...rich, inventory: { Type61: 1 } }) }).E;
  assert.deepEqual(JSON.parse(JSON.stringify(existing.snapshot().inventory)), { Type61: 1 });
});

test("selling a chassis refunds half rounded down to multiples of 50 atomically",()=>{
 const {E,context}=load();const offer=catalog.offers[E.baseModel("Type61")];
 const before=E.snapshot();const price=E.sellPrice("Type61");
 assert.equal(price.money,Math.floor(offer.money/offer.quantity/100)*50);
 assert.equal(price.supplies,Math.floor(offer.supplies/offer.quantity/100)*50);
 assert(E.sellUnit("Type61"));assert.equal(E.quantity("Type61"),23);
 assert.equal(E.snapshot().money,before.money+price.money);
 assert.equal(E.snapshot().supplies,before.supplies+price.supplies);
 const persisted=JSON.stringify(E.snapshot());
 context.localStorage.setItem=()=>{throw Error("storage full")};
 assert.throws(()=>E.sellUnit("Type61"));assert.equal(JSON.stringify(E.snapshot()),persisted);
 assert(!E.sellUnit("unknown"));
});

test("activity units, currency, development and receipt persist together or roll back together",()=>{
 const {E,D,context,storage}=load();const before=E.snapshot();
 const award={id:"server-mail:test:welcome",matchId:"server-test",money:5000,supplies:10000,inventory:{RGM_79_G:3,MS_09:3},unlockUnits:["RGM_79_G"]};
 assert(D.receiveActivity(award));assert.equal(E.snapshot().money,before.money+5000);assert.equal(E.quantity("RGM_79_G"),3);assert(D.allows("EFSF","RGM_79_G"));
 assert.equal(D.receiveActivity(award),false);assert.equal(E.quantity("RGM_79_G"),3);
 const restored=load(Object.fromEntries(storage));assert.equal(restored.D.receiveActivity(award),false);
 const persisted=JSON.stringify(E.snapshot()),research=JSON.stringify(D.exportProgress()),original=context.localStorage.setItem;
 context.localStorage.setItem=(key,value)=>{if(key==="projectgreed.developmentProgress.v1")throw Error("quota");original(key,value);};
 assert.throws(()=>D.receiveActivity({...award,id:"server-mail:test:second",unlockUnits:["MS_09"]}));assert.equal(JSON.stringify(E.snapshot()),persisted);assert.equal(JSON.stringify(D.exportProgress()),research);
});


test("owned chassis allow undeveloped kit purchases, but kits alone do not unlock purchases", () => {
  const { E, D } = funded();
  const id = "RX_78_2", kit = Object.keys(catalog.offers).find((model) => catalog.offers[model].unitId === id && E.kitPrice(model));
  assert(kit);
  assert(!D.allows("PMC", id));
  assert(!E.canBuyKit(kit, "PMC"));
  const before = JSON.stringify(E.snapshot());
  assert(!E.buyKit(kit, "PMC"));
  assert.equal(JSON.stringify(E.snapshot()), before);
  E.transact({}, { [id]: 1 });
  assert(E.canBuyKit(kit, "PMC"));
  assert(E.buyKit(kit, "PMC"));
  assert.equal(E.quantity(id), 1);
  assert(!E.produce(id, "PMC")); // Ownership does not unlock chassis production.
  assert(!D.allows("PMC", id));
  assert(E.sellUnit(id));
  assert(!E.canBuyKit(kit, "PMC"));
  assert(!E.buyKit(kit, "PMC"));
  D.grantUnit("EFSF", id);
  assert(E.canBuyKit(kit, "PMC"));
  assert(E.buyKit(kit, "PMC")); // Research allows purchase with no chassis stock.
});

test("every selectable kit on a producible chassis has a price and persists after purchase",()=>{
  const {E,D,storage}=funded();
  let missing=0;
  for(const [id,model] of Object.entries(models)) {
    if(!E.baseModel(model.prefabId) || id===E.baseModel(model.prefabId) || model.wip) continue;
    D.grantUnit(model.faction,model.prefabId);
    const price=E.kitPrice(id);
    assert(price,`${id} needs a kit price`);
    if(catalog.offers[id]) continue;
    missing++;
    assert(E.canBuyKit(id,model.faction),id);
    const before=E.snapshot();
    assert(E.buyKit(id,model.faction),id);
    assert.equal(E.kitQuantity(id),price.quantity);
    assert.equal(E.snapshot().money,before.money-price.money);
    assert.equal(E.snapshot().supplies,before.supplies-price.supplies);
    assert.equal(load(Object.fromEntries(storage)).E.kitQuantity(id),price.quantity);
    assert.equal(E.fitKits([{unitId:model.prefabId,kitId:model.kitId}])[0].kitId,model.kitId);
  }
  assert.equal(missing,7);
  assert.equal(E.kitPrice('RGM_79_G__invalid'),null);
});

test("derived kit pricing preserves technology, ownership, funds and atomicity checks",()=>{
 const {E,context}=funded(),id='RX_79_G__cannon';
 assert(!E.canBuyKit(id,'EFSF'));
 E.transact({}, {RX_79_G:1});
 assert(E.canBuyKit(id,'EFSF'));
 const before=JSON.stringify(E.snapshot());
 context.localStorage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>E.buyKit(id,'EFSF'),/quota/);
 assert.equal(JSON.stringify(E.snapshot()),before);
 const poor=load({'projectgreed.economy.v1':JSON.stringify({...rich,money:0,supplies:0,inventory:{RX_79_G:1}})}).E;
 assert(!poor.buyKit(id,'EFSF'));
 assert.equal(poor.kitQuantity(id),0);
});

test("bulk production ignores stocked locked units but rejects any locked shortage atomically", () => {
  const { E } = load({ "projectgreed.economy.v1": JSON.stringify({ ...rich, inventory: { RX_78_2: 1 } }) });
  const entries = [{ unitId: "RX_78_2", kitId: "standard" }, { unitId: "Type61", kitId: "standard" }];
  const plan = E.productionPlan(entries), before = E.snapshot();
  assert.deepEqual(Array.from(plan.items, item => item.unitId), ["Type61"]);
  assert(E.produceMissing(entries, "PMC").ok);
  assert.equal(E.quantity("RX_78_2"), 1);
  assert.equal(E.snapshot().money, before.money - plan.money);
  assert.equal(E.snapshot().supplies, before.supplies - plan.supplies);
  const after = JSON.stringify(E.snapshot());
  const blocked = E.produceMissing([...entries, entries[0]], "PMC");
  assert.equal(blocked.reason, "unavailable");
  assert.equal(JSON.stringify(E.snapshot()), after);
});
