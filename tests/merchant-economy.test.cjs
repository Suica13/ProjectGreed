const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const G = require("../shared/rules.js"),
  codec = require("../shared/save-codec.js");
function load(saved) {
  const key = "projectgreed.economy.v1",
    data = new Map(saved ? [[key, codec.stringify(saved)]] : []);
  let fail = false;
  const context = vm.createContext({
    require: require("node:module").createRequire(path.resolve("shared/economy.js")),
    module: { exports: {} },
    structuredClone,
    ART: G.catalog,
    localStorage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (fail) throw Error("write failed");
        data.set(k, v);
      },
      removeItem: (k) => data.delete(k),
    },
  });
  vm.runInContext(fs.readFileSync("shared/economy.js", "utf8"), context);
  return { E: context.module.exports, data, fail: () => (fail = true) };
}
function funded() {
  const result = load();
  result.E.creditActivity({
    id: "fund",
    matchId: "fund",
    money: 100000,
    supplies: 100000,
    inventory: { RGM_79: 2 },
  });
  return result;
}
test("parts cost rarity times 3000 funds, occupy one physical copy, and return on removal or unit sale", () => {
  const { E } = funded(),
    [a, b] = E.snapshot().storage.units;
  const start = E.snapshot();
  assert.throws(() => E.setStoredPlugin(a.id, 0, "frame"), /零件库存不足/);
  assert(E.purchasePlugin("anaheim", "frame"));
  assert.equal(E.snapshot().money, start.money - 3000);
  assert.equal(E.snapshot().supplies, start.supplies);
  assert.equal(E.pluginQuantity("frame"), 1);
  assert(E.setStoredPlugin(a.id, 0, "frame"));
  assert.equal(E.pluginQuantity("frame"), 0);
  assert.throws(() => E.setStoredPlugin(b.id, 0, "frame"), /零件库存不足/);
  assert(E.purchasePlugin("anaheim", "frame"));
  assert(E.setStoredPlugin(b.id, 0, "frame"));
  assert.equal(E.pluginQuantity("frame"), 0);
  assert(E.setStoredPlugin(a.id, 0, null));
  assert.equal(E.pluginQuantity("frame"), 1);
  assert(E.sellUnit(b.unitId, b.id));
  assert.equal(E.pluginQuantity("frame"), 2);
  const saved = E.snapshot();
  assert.equal(JSON.stringify(load(saved).E.snapshot()), JSON.stringify(saved));
});
test("purchase restrictions, insufficient funds and failed saves leave balances and stock unchanged", () => {
  const { E, fail } = funded();
  assert.throws(() => E.purchasePlugin("fake", "frame"));
  assert.throws(() => E.purchasePlugin("anaheim", "fake"));
  const before = JSON.stringify(E.snapshot());
  fail();
  assert.throws(() => E.purchasePlugin("anaheim", "frame"), /write failed/);
  assert.equal(JSON.stringify(E.snapshot()), before);
  const low = load({ ...E.snapshot(), money: 999 }).E;
  const funds = JSON.stringify(low.snapshot());
  assert.equal(low.purchasePlugin("anaheim", "frame"), false);
  assert.equal(JSON.stringify(low.snapshot()), funds);
});
test("legacy fitted equipment migrates once, spare ownership cannot underflow, and restrictions still apply", () => {
  const { E } = funded(),
    saved = E.snapshot();
  saved.storage.units[0].plugins = ["frame", null, null, null];
  delete saved.pluginInventory;
  const migrated = load(saved).E;
  assert.equal(migrated.snapshot().pluginInventory.frame, 1);
  assert.equal(migrated.pluginQuantity("frame"), 0);
  assert.equal(load(migrated.snapshot()).E.snapshot().pluginInventory.frame, 1);
  assert.throws(() => E.validate({ ...migrated.snapshot(), pluginInventory: {} }), /已装配零件/);
  assert.throws(
    () => E.validate({ ...E.snapshot(), pluginInventory: { fake: 1 } }),
    /零件库存无效/,
  );
});
test("merchant unit purchasing and tactical mission task APIs are absent", () => {
  const { E } = funded();
  for (const name of [
    "merchantUnitOffer",
    "purchaseMerchantUnit",
  ])
    assert.equal(E[name], undefined);
  assert.equal(typeof E.acceptContactTask,"function");
  assert.equal(typeof E.completeContactTask,"function");
  assert.equal(Object.values(G.catalog.maps).filter((map) => map.mission).length, 6);
});
test("obsolete contact mission records are cleared on load without changing wallet or parts", () => {
  const { E } = funded();
  E.purchasePlugin("anaheim", "frame");
  const saved = E.snapshot();
  saved.contactTasks = [{ merchantId: "efsf", mapId: "mission_no_fool", status: "accepted" }];
  const restored = load(saved),
    actual = restored.E.snapshot();
  assert.equal(actual.contactTasks.length, 0);
  assert.equal(actual.money, saved.money);
  assert.equal(actual.supplies, saved.supplies);
  assert.equal(actual.pluginInventory.frame, 1);
  assert.equal(actual.storage.units.length, saved.storage.units.length);
  assert.equal(codec.parse(restored.data.get("projectgreed.economy.v1")).contactTasks.length, 0);
  assert.equal(restored.E.validate(saved).contactTasks.length, 0);
});


test("only Anaheim sells parts and all rarities use the same quoted purchase price",()=>{
 const {E}=funded();
 const before=JSON.stringify(E.snapshot());
 assert.equal(E.pluginOffer("efsf","frame"),null);
 assert.throws(()=>E.purchasePlugin("efsf","frame"));
 assert.equal(JSON.stringify(E.snapshot()),before);
 for(const [id,rarity] of [["frame",1],["generator",2],["tem_ray",3]]) {
  assert.equal(E.pluginOffer("anaheim",id).money,rarity*3000);
  const funds=E.snapshot().money;
  assert(E.purchasePlugin("anaheim",id));
  assert.equal(E.snapshot().money,funds-rarity*3000);
 }
});
