const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const { createRequire } = require("node:module"),
  path = require("node:path");
const relative = createRequire(path.resolve("shared/economy.js"));
const catalog = require("../tools/load-catalog.cjs").loadCatalog({ embedAssets: false });
function load(saved) {
  const data = new Map(saved ? [["projectgreed.economy.v1", JSON.stringify(saved)]] : []);
  const ctx = vm.createContext({
    require: relative,
    module: { exports: {} },
    structuredClone,
    ART: catalog,
    localStorage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    },
  });
  vm.runInContext(fs.readFileSync("shared/economy.js", "utf8"), ctx);
  return { E: ctx.module.exports, data };
}
test("old profiles clear stock once while wallets and permits survive reload", () => {
  const { E, data } = load({
    schemaVersion: 3,
    money: 12345,
    supplies: 67890,
    licenses: { Type61: true },
    inventory: { Type61: 99 },
    kits: {},
  });
  assert.equal(E.snapshot().schemaVersion, 4);
  assert.equal(E.quantity("Type61"), 0);
  assert.equal(E.snapshot().money, 12345);
  assert(E.hasLicense("Type61"));
  assert.equal(JSON.parse(data.get(E.key)).schemaVersion, 4);
  const next = E.snapshot();
  next.inventory.Type61 = 1;
  const normalized = E.validate(next);
  assert.equal(normalized.inventory.Type61, 1);
  assert.equal(normalized.storage.units.length, 1);
  assert.equal(E.validate(normalized).inventory.Type61, 1);
});
test("quantity limits and independent ship storage preserve excess rewards", () => {
  const { E } = load();
  const next = E.initial();
  next.inventory = { RGM_79: 25, Medea: 10 };
  const value = E.validate(next);
  assert.equal(value.storage.units.length, 24);
  assert.equal(value.storage.ships.length, 9);
  assert.equal(value.storage.deliveries.length, 2);
  assert.equal(value.inventory.RGM_79, 24);
  assert.equal(value.inventory.Medea, 9);
  const again = E.validate(value);
  assert.equal(again.storage.deliveries.length, 2);
  const warehouse = require("../shared/warehouse");
  assert.equal(warehouse.usage(value.storage, catalog.models, "units").slots, 24);
  assert.equal(warehouse.usage(value.storage, catalog.models, "ships").slots, 9);
});
test("distinct chassis preserve chosen weapon kits through normalization and storage reload", () => {
  const { E } = load();
  const next = E.initial();
  const prefab = catalog.prefabs.find((p) => p.weaponKits.length > 1 && !p.formOnly && !p.facility);
  const [a, b] = prefab.weaponKits;
  next.inventory[prefab.id] = 2;
  let value = E.validate(next);
  const items = [...value.storage.units, ...value.storage.ships];
  items[0].kitId = a.id;
  items[1].kitId = b.id;
  value = E.validate(value);
  assert.deepEqual(
    [...value.storage.units, ...value.storage.ships].map((i) => i.kitId),
    [a.id, b.id],
  );
  assert.notEqual(items[0].id, items[1].id);
});
test("removed game modes are rejected by authoritative rules", () => {
  const G = require("../shared/rules");
  for (const mode of ["campaign", "dominion"]) {
    assert.throws(() => G.validateBattleMode(mode));
    assert.throws(() => G.create(false, 1, [], false, { mode }));
  }
  assert(!Object.values(catalog.maps).some((m) => m.dominion || m.scope === "strategic"));
});
test("reward receipts, sale and actual reload keep physical chassis in sync", () => {
  const { E } = load();
  const award = {
    id: "physical-reward",
    matchId: "test",
    money: 100,
    supplies: 150,
    inventory: { Type61: 2 },
  };
  assert.equal(E.creditActivity(award), true);
  assert.equal(E.creditActivity(award), false);
  assert.equal(E.quantity("Type61"), 2);
  const ids = E.snapshot().storage.units.map((i) => i.id);
  const reload = load(E.snapshot()).E;
  assert.deepEqual(
    reload.snapshot().storage.units.map((i) => i.id),
    ids,
  );
  assert.equal(reload.sellUnit("Type61"), true);
  assert.equal(reload.quantity("Type61"), 1);
  assert.equal(reload.snapshot().storage.units.length, 1);
});

test("large units consume one storage slot and positions survive gaps and reload", () => {
  const W = require("../shared/warehouse");
  const models = { Large__base: { transport: { slotCost: 6 } } };
  let s = W.normalize(null, models, {Large:24}, () => "base");
  assert.equal(s.units.length, 24);
  assert.equal(s.deliveries.length, 0);
  assert.equal(W.fits(s, models.Large__base, models), false);
  s.units.splice(7,1);
  s = W.normalize(s, models, {Large:23}, () => "base");
  assert.equal(W.freeSlot(s,"units"),7);
  assert.equal(s.units.at(-1).slot,23);
  assert.equal(W.fits(s, models.Large__base, models), true);
});
test("production uses a selected empty slot and rejects occupied slots without charging", () => {
  const E = load({schemaVersion:4,money:100000,supplies:100000,licenses:{Type61:true},inventory:{},kits:{}}).E;
  assert.equal(E.produce("Type61", E.defaultKit("Type61"), "PMC", 12), true);
  assert.equal(E.snapshot().storage.units[0].slot,12);
  const money=E.snapshot().money;
  assert.throws(()=>E.produce("Type61", E.defaultKit("Type61"), "PMC",12));
  assert.equal(E.snapshot().money,money);
  assert.equal(load(E.snapshot()).E.snapshot().storage.units[0].slot,12);
});
