const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const catalog = require("../shared/production-catalog.json"),
  G = require("../shared/rules.js"),
  tree = require("../shared/development-tree.json");
const key = "projectgreed.economy.v1";
function load(
  profile = { money: 1000000, supplies: 1000000, inventory: {}, kits: {} },
  full = true,
) {
  const storage = new Map([[key, JSON.stringify(profile)]]);
  if (full)
    storage.set(
      "projectgreed.developmentProgress.v1",
      JSON.stringify({
        points: { EFSF: 99999, ZEON: 99999 },
        claimed: {},
        researched: Object.fromEntries(["EFSF", "ZEON"].map((f) => [f, tree[f].map((n) => n.id)])),
      }),
    );
  const context = vm.createContext({
    SaveCodec: require("../shared/save-codec.js"),
    PILOT_DATA: require("../shared/pilots.json"),
    STARTER_PROFILE: require("../shared/starter-profile.json"),
    PRODUCTION_CATALOG: catalog,
    ProfileMigrations: require("../shared/profile-migrations.js"),
    ART: { models: G.models },
    DEVELOPMENT_TREE: tree,
    structuredClone,
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
  });
  for (const name of ["economy", "development"])
    vm.runInContext(fs.readFileSync("shared/" + name + ".js", "utf8"), context);
  return { ...vm.runInContext("({E:Economy,D:Development})", context), storage, context };
}
test("legacy inventories retain permits and migrate to zero counted stock", () => {
  const old = {
    money: 10000,
    supplies: 20000,
    inventory: { Type61: 24, RGM_79__machine_gun: 3, MS_06F: 0 },
    kits: { RGM_79__bazooka: 99 },
    claimed: { one: "match" },
  };
  const { E, storage } = load(old);
  assert(E.hasLicense("Type61"));
  assert(E.hasLicense("RGM_79"));
  assert(E.hasLicense("MS_06F"));
  const data = E.exportProgress();
  assert.equal(data.schemaVersion, 3);
  assert.equal(Object.keys(data.inventory).length, 0);
  assert.equal(Object.keys(data.kits).length, 0);
  assert.equal(data.money, 10000);
  assert.equal(data.claimed.one, "match");
  assert(storage.has(key + ".before-counted-stock"));
  const reloaded = load(data).E;
  assert.deepEqual(
    JSON.parse(JSON.stringify(reloaded.exportProgress())),
    JSON.parse(JSON.stringify(data)),
  );
});
test("one paid permit grants one default-equipped chassis exactly once", () => {
  const { E } = load();
  const offer = E.licenseOffer("RGM_79");
  const before = E.snapshot();
  assert(E.purchaseLicense("RGM_79", "EFSF"));
  assert.equal(E.snapshot().money, before.money - offer.money);
  const entries = Array.from({ length: 6 }, (_, i) => ({
    unitId: "RGM_79",
    kitId: i % 2 ? "bazooka" : "machine_gun",
  }));
  assert.equal(G.licensePlan(entries, E.snapshot().licenses).missing.length, 0);
  assert.equal(typeof E.fitKits, "undefined");
  assert.equal(E.quantity("RGM_79"), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(E.snapshot().kits)), {});
  assert.equal(typeof E.produce, "function");
  assert.equal(Object.keys(E.snapshot().inventory).length, 1);
  const after = E.snapshot().money;
  assert(!E.purchaseLicense("RGM_79", "EFSF"));
  assert.equal(E.snapshot().money, after);
  assert.equal(typeof E.buyKit, "undefined");
  assert.equal(typeof E.sellUnit, "function");
});

test("selling removes one chassis and refunds half the production price without removing its permit", () => {
  const { E } = load({ schemaVersion: 3, money: 1000, supplies: 2000,
    licenses: { RGM_79: true }, inventory: { RGM_79: 2 }, kits: {} });
  const price = E.unitOffer("RGM_79"), before = E.snapshot();
  assert(E.sellUnit("RGM_79"));
  assert.equal(E.quantity("RGM_79"), 1);
  assert.equal(E.snapshot().money, before.money + Math.floor(price.money / 2));
  assert.equal(E.snapshot().supplies, before.supplies + Math.floor(price.supplies / 2));
  assert(E.hasLicense("RGM_79"));
  assert(E.sellUnit("RGM_79"));
  assert.equal(E.quantity("RGM_79"), 0);
  const empty = JSON.stringify(E.snapshot());
  assert(!E.sellUnit("RGM_79")); assert(!E.sellUnit("missing-unit"));
  assert(!E.sellUnit("constructor")); assert.equal(E.saleOffer("__proto__"), null);
  assert.equal(JSON.stringify(E.snapshot()), empty);
});

test("unlicensed reward stock can be sold and failed storage leaves inventory and wallet intact", () => {
  const profile = { schemaVersion: 3, money: 1000, supplies: 2000,
    licenses: {}, inventory: { RGM_79: 1 }, kits: {} };
  const { E, context, storage } = load(profile, false);
  assert(!E.hasLicense("RGM_79"));
  const before = JSON.stringify(E.snapshot()), saved = storage.get(key);
  context.localStorage.setItem = () => { throw Error("quota"); };
  assert.throws(() => E.sellUnit("RGM_79"), /quota/);
  assert.equal(JSON.stringify(E.snapshot()), before);
  assert.equal(storage.get(key), saved);
  context.localStorage.setItem = (k, v) => storage.set(k, v);
  assert(E.sellUnit("RGM_79"));
  assert(!E.hasLicense("RGM_79"));
});
test("bulk permit purchases deduplicate chassis, reject undeveloped/unaffordable units atomically", () => {
  const { E } = load();
  const entries = Array(12).fill({ unitId: "RGM_79", kitId: "beam_spray" });
  const plan = E.licensePlan(entries),
    offer = E.licenseOffer("RGM_79");
  assert.equal(plan.items.length, 1);
  assert.equal(plan.money, offer.money);
  assert(E.purchaseMissingLicenses(entries, "EFSF").ok);
  assert.equal(E.licensePlan(entries).items.length, 0);
  const poor = load({ money: 0, supplies: 0, inventory: {}, kits: {} }).E;
  assert(!poor.purchaseMissingLicenses(entries, "EFSF").ok);
  assert(!poor.hasLicense("RGM_79"));
  const locked = load(undefined, false);
  const id = Object.keys(catalog.baseModels).find(
    (id) => !locked.D.allows("EFSF", id) && !locked.E.hasLicense(id) && G.models[catalog.baseModels[id]]?.faction === "EFSF",
  );
  assert(id);
  assert(!locked.E.purchaseLicense(id, "EFSF"));
  assert(!locked.E.hasLicense(id));
});
test("battle losses never revoke licenses; activity grants are permanent and receipts deduplicate", () => {
  const { E } = load({ money: 100, supplies: 200, inventory: { Type61: 1 }, kits: {} });
  E.creditAward({
    id: "loss",
    matchId: "battle",
    money: 10,
    supplies: 20,
    losses: { Type61: 100 },
  });
  assert(E.hasLicense("Type61"));
  const reward = { id: "event", matchId: "mail", money: 5, supplies: 10, licenses: { RGM_79: true } };
  assert(E.creditActivity(reward));
  assert(!E.creditActivity(reward));
  assert(E.hasLicense("RGM_79"));
  assert.equal(E.snapshot().money, 115);
});
test("paid refit operations have been removed from the live economy", () => {
  const { E } = load();
  for (const name of ["refitOptions", "refitReason", "refitUnit", "produceMissing", "productionPlan", "fitKits"])
    assert.equal(typeof E[name], "undefined", name);
  assert.throws(() => E.validate({money:0,supplies:0,inventory:{Type61:1}}));
  assert.throws(() => E.transact({}, {Type61:1}));
});
test("default equipment matches native index zero independently of cheapest factory price", () => {
  for (const [id, kit] of [
    ["RGM_79", "beam_spray"],
    ["RX_78_2", "kit_1"],
    ["RX_77_3", "kit_2"],
  ]) {
    const { E } = load();
    assert.equal(E.defaultKit(id), kit);
    assert.equal(G.catalog.prefabs.find((p) => p.id === id).weaponKits[0].id, kit);
  }
});

test("0093 event inventory is usable without unlocking research or purchasing a permit", () => {
  const { E, D } = load({schemaVersion:3,money:100000,supplies:100000,licenses:{},inventory:{},kits:{}},false);
  const inventory = Object.fromEntries(["RGM_89","AMS_119","RGZ_91","RGZ_91B","MSN_03","MSN_04","RX_93","RX_93_Test"].map(id=>[id,2]));
  const award={id:"0093-stock",matchId:"event",money:0,supplies:0,inventory};
  assert(E.creditActivity(award));assert(!E.creditActivity(award));
  for (const id of Object.keys(inventory)) {
    assert.equal(E.quantity(id),2);assert(!E.hasLicense(id));assert(!D.allows("PMC",id));
    assert(!E.purchaseLicense(id,"PMC"));
    const kitId=E.defaultKit(id);
    assert.equal(E.stockPlan([{unitId:id,kitId}],E.snapshot()).missing.length,0);
  }
});
