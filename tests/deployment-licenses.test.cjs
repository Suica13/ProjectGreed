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
    PILOT_DATA: require("../shared/pilots.json"),
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
  return { ...vm.runInContext("({E:Economy,D:Development})", context), storage };
}
test("old chassis and complete model inventories migrate to permanent licenses; archive drops counts and kits", () => {
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
  assert(!E.hasLicense("MS_06F"));
  const data = E.exportProgress();
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.inventory, undefined);
  assert.equal(data.kits, undefined);
  assert.equal(data.money, 10000);
  assert.equal(data.claimed.one, "match");
  assert(storage.has(key + ".before-deployment-licenses"));
  const reloaded = load(data).E;
  assert.deepEqual(
    JSON.parse(JSON.stringify(reloaded.exportProgress())),
    JSON.parse(JSON.stringify(data)),
  );
});
test("one paid license covers every duplicate and every equipment kit; a second purchase cannot charge", () => {
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
  assert.equal(typeof E.quantity, "undefined");
  assert.equal(typeof E.produce, "undefined");
  assert.equal(E.snapshot().inventory, undefined);
  const after = E.snapshot().money;
  assert(!E.purchaseLicense("RGM_79", "EFSF"));
  assert.equal(E.snapshot().money, after);
  assert.equal(typeof E.buyKit, "undefined");
  assert.equal(typeof E.sellUnit, "undefined");
});
test("bulk permit purchases deduplicate chassis, reject undeveloped/unaffordable units atomically", () => {
  const { E } = load();
  const entries = Array(12).fill({ unitId: "Type61", kitId: "standard" });
  const plan = E.licensePlan(entries),
    offer = E.licenseOffer("Type61");
  assert.equal(plan.items.length, 1);
  assert.equal(plan.money, offer.money);
  assert(E.purchaseMissingLicenses(entries, "EFSF").ok);
  assert.equal(E.licensePlan(entries).items.length, 0);
  const poor = load({ money: 0, supplies: 0, inventory: {}, kits: {} }).E;
  assert(!poor.purchaseMissingLicenses(entries, "EFSF").ok);
  assert(!poor.hasLicense("Type61"));
  const locked = load(undefined, false);
  const id = Object.keys(catalog.baseModels).find(
    (id) => !locked.D.allows("EFSF", id) && G.models[catalog.baseModels[id]]?.faction === "EFSF",
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
  for (const name of ["refitOptions", "refitReason", "refitUnit", "produce", "produceMissing", "productionPlan", "fitKits", "quantity"])
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
