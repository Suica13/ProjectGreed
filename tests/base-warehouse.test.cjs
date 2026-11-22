const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const { createRequire } = require("node:module"),
  path = require("node:path");
const relative = createRequire(path.resolve("shared/economy.js"));
const catalog = require("../tools/load-catalog.cjs").loadCatalog({ embedAssets: false });
function established() {
  return {version:2,levels:{hq:3,factory:2,giantFactory:3,beacon:3,academy:1}};
}
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
  if (!saved) {
    const profile=ctx.module.exports.initial();profile.baseFacilities=established();return load(profile);
  }
  return { E: ctx.module.exports, data };
}

test("inventory sorting preserves complete chassis records and validates a full category permutation", () => {
  const { E } = load();
  E.creditActivity({ id: "sort-stock", matchId: "sort-stock", money: 0, supplies: 0, inventory: { RGM_79: 3, Medea: 1 } });
  const original = E.snapshot().storage.units;
  E.setStoredPilot(original[0].id, "sort-pilot");
  E.creditAward({ id: "sort-damage", matchId: "sort-battle", money: 0, supplies: 0,
    stockStates: [{ stockId: original[0].id, unitId: original[0].unitId, kitId: original[0].kitId, hp: 1234, en: 12, brokenParts: { head: true } }] });
  const before = E.snapshot(), ids = before.storage.units.map(item => item.id).reverse();
  assert(E.reorderStoredUnits("units", ids));
  const sorted = E.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(sorted.storage.units)), ids.map((id, slot) => ({ ...JSON.parse(JSON.stringify(before.storage.units.find(item => item.id === id))), slot })));
  assert.deepEqual(JSON.parse(JSON.stringify(sorted.storage.ships)), JSON.parse(JSON.stringify(before.storage.ships)));
  assert.equal(sorted.money, before.money);
  assert.equal(JSON.stringify(load(sorted).E.snapshot().storage), JSON.stringify(sorted.storage));
  for (const invalid of [ids.slice(1), [ids[0], ids[0], ids[2]], ["missing", ...ids.slice(1)]]) {
    assert.throws(() => E.reorderStoredUnits("units", invalid));
    assert.equal(JSON.stringify(E.snapshot()), JSON.stringify(sorted));
  }
});

test("unpriced base units sell for zero while alternate and purged forms cannot be sold", () => {
  const { E } = load();
  E.creditActivity({ id: "sale-forms", matchId: "sale-forms", money: 0, supplies: 0,
    inventory: { WhiteBase: 1, MSZ_006: 1, FA_78_1: 1, RGZ_91_MA: 1 } });
  const base = E.snapshot().storage.ships.find(item => item.unitId === "WhiteBase"), before = E.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(E.saleOffer("WhiteBase"))), {unitId:"WhiteBase",quantity:1,money:0,supplies:0});
  assert(E.sellUnit("WhiteBase", base.id));
  assert.equal(E.quantity("WhiteBase"), 0);
  assert.equal(E.snapshot().storage.ships.length, before.storage.ships.length - 1);
  assert.equal(E.snapshot().money, before.money);assert.equal(E.snapshot().supplies, before.supplies);
  for (const [from, to] of [["MSZ_006","MSZ_006_MA"],["FA_78_1","FA_78_1_NA"],["RGZ_91_MA","RGZ_91"]]) {
    assert(E.saleOffer(from), "base form can be sold");
    const item = E.snapshot().storage.units.find(item => item.unitId === from);
    assert(E.transformStock(from, to, item.id));
    const transformed = JSON.stringify(E.snapshot());
    assert.equal(E.saleOffer(to), null);assert.equal(E.sellUnit(to,item.id),false);
    assert.equal(JSON.stringify(E.snapshot()),transformed);
  }
});

test("scrapping escape forms and wrecks removes only the selected record without refunds or duplicate loss", () => {
  const {E,data}=load();
  E.creditActivity({id:"scrap-stock",matchId:"scrap-stock",money:0,supplies:0,inventory:{MTank_Top:2,RGM_79:2}});
  const [top,otherTop]=E.snapshot().storage.units.filter(item=>item.unitId==="MTank_Top");
  const [wreck,healthy]=E.snapshot().storage.units.filter(item=>item.unitId==="RGM_79");
  E.creditAward({id:"scrap-loss",matchId:"scrap-loss",money:0,supplies:0,stockLost:{inventory:{RGM_79:1}},stockLostItems:[{stockId:wreck.id,unitId:"RGM_79"}]});
  const before=E.snapshot();assert.equal(E.saleOffer("MTank_Top"),null);
  assert.equal(E.discardStoredUnit("missing"),false);
  assert(E.discardStoredUnit(top.id));assert.equal(E.quantity("MTank_Top"),1);
  assert.equal(E.discardStoredUnit(top.id),false);
  assert(E.discardStoredUnit(wreck.id));assert.equal(E.quantity("RGM_79"),1);
  const after=E.snapshot();assert.equal(after.money,before.money);assert.equal(after.supplies,before.supplies);
  for(const item of [otherTop,healthy])assert.deepEqual(JSON.parse(JSON.stringify(after.storage.units.find(row=>row.id===item.id))),JSON.parse(JSON.stringify(before.storage.units.find(row=>row.id===item.id))));
  assert.equal(load(after).E.snapshot().storage.units.length,2);
  const persisted=data.get("projectgreed.economy.v1");
  data.set = () => { throw Error("save failed"); };
  assert.throws(()=>E.discardStoredUnit(otherTop.id),/save failed/);assert.equal(JSON.stringify(E.snapshot()),JSON.stringify(after));assert.equal(data.get("projectgreed.economy.v1"),persisted);
});

test("bulk repair charges materials once per chassis, restores wreck inventory and persists atomically", () => {
  const {E}=load();E.creditActivity({id:"repair-stock",matchId:"repair-stock",money:100000,supplies:100000,inventory:{RGM_79:3,WhiteBase:1}});
  const [wreck,parts,resources]=E.snapshot().storage.units,ship=E.snapshot().storage.ships[0];
  const model=catalog.models[parts.unitId+"__"+parts.kitId],shipModel=catalog.models[ship.unitId+"__"+ship.kitId];
  E.creditAward({id:"repair-damage",matchId:"repair-damage",money:0,supplies:0,
    stockLost:{inventory:{RGM_79:1}},stockLostItems:[{stockId:wreck.id,unitId:"RGM_79"}],
    stockStates:[{stockId:parts.id,unitId:parts.unitId,kitId:parts.kitId,hp:100,en:0,brokenParts:{leftArm:true,rightArm:true}},
      {stockId:resources.id,unitId:resources.unitId,kitId:resources.kitId,hp:100,en:0},
      {stockId:ship.id,unitId:ship.unitId,kitId:ship.kitId,hp:shipModel.hp,en:0,brokenParts:{[shipModel.modules[0].id]:true}}]});
  const before=E.snapshot(),quote=E.repairQuote(),price=E.unitOffer("RGM_79").supplies*4;
  assert.equal(quote.items.length,4);assert.equal(quote.supplies,Math.ceil(price/2)+Math.ceil(price/4)+Math.ceil((E.unitOffer("WhiteBase")?.supplies||0)*4/4));
  assert.equal(quote.items.find(item=>item.id===wreck.id).supplies,Math.ceil(price/2));
  assert.equal(quote.items.find(item=>item.id===parts.id).supplies,Math.ceil(price/4));
  assert.equal(quote.items.find(item=>item.id===resources.id).supplies,0);
  const poor=load({...before,supplies:0}).E;assert.throws(()=>poor.repairAllStoredUnits(),/物资不足/);assert.equal(poor.quantity("RGM_79"),2);
  assert(E.repairAllStoredUnits(quote));const after=E.snapshot();assert.equal(after.money,before.money);assert.equal(after.supplies,before.supplies-quote.supplies);assert.equal(E.quantity("RGM_79"),3);
  for(const item of [...after.storage.units,...after.storage.ships]){const m=catalog.models[item.unitId+"__"+item.kitId];assert.equal(item.hp,m.hp);assert.equal(item.en,m.en);assert.equal(item.destroyed,false);assert.equal(Object.keys(item.brokenParts).length,0);for(const module of m.modules||[])assert.equal(item.moduleHp[module.id],module.hp);assert.equal(item.slot,[...before.storage.units,...before.storage.ships].find(row=>row.id===item.id).slot);}
  assert.equal(E.repairQuote().items.length,0);assert.equal(E.repairAllStoredUnits(),false);assert.throws(()=>E.repairAllStoredUnits(quote),/库存状态已变化/);
  assert.equal(load(after).E.quantity("RGM_79"),3);
  const failure=load(before),failedBefore=JSON.stringify(failure.E.snapshot());failure.data.set=()=>{throw Error("save failed");};assert.throws(()=>failure.E.repairAllStoredUnits(),/save failed/);assert.equal(JSON.stringify(failure.E.snapshot()),failedBefore);
});

test("settlement preserves individual wrecks, damage and resources through reload without duplicate losses", () => {
  const { E } = load();
  E.creditActivity({ id: "initial-stock", matchId: "initial", money: 0, supplies: 0, inventory: { RGM_79: 3 } });
  const [lost, damaged, intact] = E.snapshot().storage.units;
  const model = catalog.models[damaged.unitId + "__" + damaged.kitId];
  const award = { id: "damage-result", matchId: "battle", money: 0, supplies: 0,
    stockLost: { inventory: { RGM_79: 1 } }, stockLostItems: [{ stockId: lost.id, unitId: "RGM_79" }],
    stockStates: [{ stockId: damaged.id, unitId: "RGM_79", kitId: damaged.kitId,
      hp: model.hp / 2, en: 0, brokenParts: { leftArm: true } }] };
  assert(E.creditAward(award));
  assert.equal(E.creditAward(award), false);
  assert.equal(E.quantity("RGM_79"), 2);
  const reloaded = load(E.snapshot()).E;
  const items = reloaded.snapshot().storage.units;
  assert.equal(items.length, 3);
  assert.equal(items.find((item) => item.id === lost.id).destroyed, true);
  assert.equal(items.find((item) => item.id === lost.id).slot, lost.slot);
  assert.equal(items.find((item) => item.id === damaged.id).hp, model.hp / 2);
  assert.equal(items.find((item) => item.id === damaged.id).en, 0);
  assert.equal(items.find((item) => item.id === damaged.id).brokenParts.leftArm, true);
  assert.equal(items.find((item) => item.id === intact.id).destroyed, false);
  assert.equal(reloaded.storedUnits().length, 3);
  assert(!Object.hasOwn(award.stockLostItems[0], "used"));
});

test("wrecks keep occupying slots and new production never silently repairs or replaces them", () => {
  const { E } = load();
  E.creditActivity({ id: "fill", matchId: "initial", money: 0, supplies: 0, inventory: { RGM_79: 30 } });
  E.creditAward({ id: "all-lost", matchId: "battle", money: 0, supplies: 0,
    stockLost: { inventory: { RGM_79: 30 } } });
  assert.equal(E.quantity("RGM_79"), 0);
  assert.equal(E.storageUsage("units").count, 30);
  assert.equal(E.canStore("RGM_79"), false);
  assert.equal(load(E.snapshot()).E.snapshot().storage.units.filter((item) => item.destroyed).length, 30);
});
test("stored pilot assignments move atomically between chassis and survive reload", () => {
  const { E } = load();
  E.creditActivity({ id: "pilot-stock", matchId: "initial", money: 0, supplies: 0, inventory: { RGM_79: 2 } });
  const [a, b] = E.snapshot().storage.units;
  assert(E.setStoredPilot(a.id, "personal-pilot"));
  assert(E.setStoredPilot(b.id, "personal-pilot"));
  const records=load(E.snapshot()).E.snapshot().storage.units;
  assert.equal(records.find(item=>item.id === a.id).pilotId,null);
  assert.equal(records.find(item=>item.id === b.id).pilotId,"personal-pilot");
  assert(E.setStoredPilot(a.id, null));
  assert(E.setStoredPilot(b.id, "personal-pilot"));
});

test("moving a wreck's pilot permits repair and legacy duplicate wreck references are detached", () => {
  const {E}=load();
  E.creditActivity({id:"wreck-pilot-funds",matchId:"initial",money:0,supplies:100000,inventory:{RGM_79:2}});
  const [wreck,target]=E.snapshot().storage.units;
  E.setStoredPilot(wreck.id,"surviving-pilot");
  E.creditAward({id:"pilot-wreck",matchId:"battle",money:0,supplies:0,
    stockLost:{inventory:{[wreck.unitId]:1}},stockLostItems:[{stockId:wreck.id,unitId:wreck.unitId}]});
  assert(E.setStoredPilot(target.id,"surviving-pilot"));
  assert.equal(E.snapshot().storage.units.find(item=>item.id===wreck.id).pilotId,null);
  const legacy=E.snapshot();legacy.storage.units.find(item=>item.id===wreck.id).pilotId="surviving-pilot";
  const restored=load(legacy).E,quote=restored.repairQuote([wreck.id]),before=restored.snapshot();
  assert(restored.repairAllStoredUnits(quote));
  const after=restored.snapshot(),fixed=after.storage.units.find(item=>item.id===wreck.id);
  assert(fixed.hp>0 && !fixed.destroyed);assert.equal(fixed.pilotId,null);
  assert.equal(after.storage.units.find(item=>item.id===target.id).pilotId,"surviving-pilot");
  assert.equal(after.supplies,before.supplies-quote.supplies);
  assert.equal(load(after).E.snapshot().storage.units.find(item=>item.id===wreck.id).hp,fixed.hp);
});

test("failed pilot migration persistence leaves both original assignments intact", () => {
  const {E,data}=load(),[a,b]=E.snapshot().storage.units;
  E.setStoredPilot(a.id,"pilot-a");E.setStoredPilot(b.id,"pilot-b");
  const before=JSON.stringify(E.snapshot());data.set=()=>{throw Error("save failed");};
  assert.throws(()=>E.setStoredPilot(b.id,"pilot-a"),/save failed/);
  assert.equal(JSON.stringify(E.snapshot()),before);
});
test("transforming one selected chassis preserves its identity, pilot and battle damage", () => {
  const { E } = load();
  E.creditActivity({ id: "forms-stock", matchId: "initial", money: 0, supplies: 0, inventory: { RGZ_91_MA: 2 } });
  const [a, b] = E.snapshot().storage.units;
  E.setStoredPilot(b.id, "personal-pilot");
  E.creditAward({ id: "form-damage", matchId: "battle", money: 0, supplies: 0,
    stockStates: [{ stockId: b.id, unitId: b.unitId, kitId: b.kitId, hp: 1000, en: 10, brokenParts: { head: true } }] });
  assert(E.transformStock("RGZ_91_MA", "RGZ_91", b.id));
  const items = E.snapshot().storage.units;
  assert.equal(items.find((item) => item.id === a.id).unitId, "RGZ_91_MA");
  const transformed = items.find((item) => item.id === b.id);
  assert.equal(transformed.unitId, "RGZ_91");
  assert.equal(transformed.slot, b.slot);
  assert.equal(transformed.hp, 1000);
  assert.equal(transformed.en, 10);
  assert.equal(transformed.brokenParts.head, true);
  assert.equal(transformed.pilotId, "personal-pilot");
});
test("workshop transformations preserve the weapon kit mapping in both directions", () => {
  const { E } = load();
  E.creditActivity({ id: "mapped-forms", matchId: "initial", money: 0, supplies: 0, inventory: { MSZ_006: 1 } });
  const item = E.snapshot().storage.units[0];
  assert(E.changeStoredKit(item.id, "kit_1"));
  assert(E.transformStock("MSZ_006", "MSZ_006_MA", item.id));
  assert.equal(E.snapshot().storage.units[0].kitId, "kit_1");
  assert(E.transformStock("MSZ_006_MA", "MSZ_006", item.id));
  assert.equal(E.snapshot().storage.units[0].kitId, "kit_1");
  const forms = require("../shared/normal-forms");
  assert.equal(forms.options(catalog, "MSZ_006").find((form) => form.unitId === "MSZ_006_MA").type, "transform");
  assert.equal(forms.options(catalog, "RGZ_91_MA").find((form) => form.unitId === "RGZ_91").type, "armor_purge");
  const sample = { prefabs: [
    { id: "A", weaponKits: [{ id: "rifle" }], skills: [{ id: "change", type: "transform", source: { mode: "transform", unitId: "B", kitId: "default", kitMap: { rifle: "flightRifle" } } }] },
    { id: "B", weaponKits: [{ id: "default" }, { id: "flightRifle" }] },
  ] };
  assert.equal(forms.kit(sample, "A", "B", "rifle", "default"), "flightRifle");
  assert.equal(forms.kit(sample, "B", "A", "flightRifle", "rifle"), "rifle");
});

test("workshop excludes ejection and temporary systems while preserving deployment changes", () => {
  const { E } = load();
  E.creditActivity({ id: "escape-stock", matchId: "initial", money: 0, supplies: 0, inventory: { MTank: 1 } });
  const item = E.snapshot().storage.units[0];
  const before = JSON.stringify(E.snapshot());
  assert.throws(() => E.transformStock("MTank", "MTank_Chassis", item.id));
  assert.equal(JSON.stringify(E.snapshot()), before);
  const forms = require("../shared/normal-forms");
  assert(forms.options(catalog, "Medea").some((form) => form.type === "deployment"));
  assert(!forms.options(catalog, "RX_79_BD_1").some((form) => form.unitId.includes("EXAM")));
  const carrier = load().E;
  carrier.creditActivity({ id: "deploy-form", matchId: "initial", money: 0, supplies: 0, inventory: { Medea: 1 } });
  const carrierId = carrier.snapshot().storage.ships[0].id;
  assert(carrier.transformStock("Medea", "Medea_DeployState", carrierId));
  assert(carrier.transformStock("Medea_DeployState", "Medea", carrierId));
  assert.equal(carrier.snapshot().storage.ships[0].id, carrierId);
});

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
  next.baseFacilities=established();
  next.inventory = { RGM_79: 31, Medea: 13 };
  const value = E.validate(next);
  assert.equal(value.storage.units.length, 30);
  assert.equal(value.storage.ships.length, 12);
  assert.equal(value.storage.deliveries.length, 2);
  assert.equal(value.inventory.RGM_79, 30);
  assert.equal(value.inventory.Medea, 12);
  const again = E.validate(value);
  assert.equal(again.storage.deliveries.length, 2);
  const warehouse = require("../shared/warehouse");
  assert.equal(warehouse.usage(value.storage, catalog.models, "units").slots, 30);
  assert.equal(warehouse.usage(value.storage, catalog.models, "ships").slots, 12);
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
  const models = { Large__base: { hp: 100, en: 100, transport: { slotCost: 6 } } };
  const storage=W.empty();storage.slots={units:24,ships:9};storage.pages={units:3,ships:2};
  let s = W.normalize(storage, models, {Large:24}, () => "base");
  assert.equal(s.units.length, 24);
  assert.equal(s.deliveries.length, 0);
  assert.equal(W.fits(s, models.Large__base, models), false);
  s.units.splice(7,1);
  s = W.normalize(s, models, {Large:23}, () => "base");
  assert.equal(W.freeSlot(s,"units"),7);
  assert.equal(s.units.at(-1).slot,23);
  assert.equal(W.fits(s, models.Large__base, models), true);
});
test("moving a stored chassis across pages preserves its state and rejects occupied or invalid slots", () => {
  const { E } = load();
  E.creditActivity({ id: "move-stock", matchId: "initial", money: 100, supplies: 150, inventory: { RGM_79: 2 } });
  const item = E.snapshot().storage.units[0];
  E.setStoredPilot(item.id, "move-pilot");
  E.creditAward({ id: "move-damage", matchId: "battle", money: 0, supplies: 0,
    stockStates: [{ stockId: item.id, unitId: item.unitId, kitId: item.kitId, hp: 1000, en: 20, brokenParts: { head: true } }] });
  const before = E.snapshot(), chassis = before.storage.units[0];
  assert(E.moveStoredUnit(item.id, 18));
  const after = E.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(after.storage.units[0])), { ...JSON.parse(JSON.stringify(chassis)), slot: 18 });
  assert.equal(after.money, before.money);
  assert.equal(after.supplies, before.supplies);
  assert.equal(after.inventory.RGM_79, before.inventory.RGM_79);
  assert.equal(load(after).E.snapshot().storage.units[0].slot, 18);
  for (const target of [1, 30, -1]) assert.throws(() => E.moveStoredUnit(item.id, target));
  assert.throws(() => E.moveStoredUnit("missing", 3));
  assert.equal(JSON.stringify(E.snapshot()), JSON.stringify(after));
  const other = after.storage.units[1];
  assert(E.moveStoredUnit(item.id, other.slot, true));
  const swapped = E.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(swapped.storage.units.find((entry) => entry.id === item.id))), { ...JSON.parse(JSON.stringify(after.storage.units[0])), slot: other.slot });
  assert.deepEqual(JSON.parse(JSON.stringify(swapped.storage.units.find((entry) => entry.id === other.id))), { ...JSON.parse(JSON.stringify(other)), slot: 18 });
  assert(E.moveStoredUnit(item.id, 18, true));
  assert.equal(JSON.stringify(E.snapshot()), JSON.stringify(after));
});

test("selling a selected physical chassis leaves same-model duplicates and their condition intact", () => {
  const { E } = load();
  E.creditActivity({ id: "sale-chassis", matchId: "initial", money: 0, supplies: 0, inventory: { RGM_79: 2 } });
  const [a, b] = E.snapshot().storage.units;
  E.setStoredPilot(a.id, "sale-pilot");
  const preserved = E.snapshot().storage.units.find((item) => item.id === b.id), offer = E.saleOffer(a.unitId), before = E.snapshot();
  assert.equal(E.sellUnit(a.unitId, "missing"), false);
  assert(E.sellUnit(a.unitId, a.id));
  const after = E.snapshot();
  assert.equal(after.storage.units.some((item) => item.id === a.id), false);
  assert.deepEqual(after.storage.units[0], preserved);
  assert.equal(after.money, before.money + offer.money);
  assert.equal(after.supplies, before.supplies + offer.supplies);
  assert.equal(E.sellUnit(a.unitId, a.id), false);
});

test("formation validation preserves physical identity and refuses duplicate chassis references", () => {
  const G = require("../shared/rules");
  const entries = [{ unitId: "Medea", kitId: "standard", stockId: "physical-carrier" }];
  assert.equal(G.validateFleetFormation(entries, Infinity, 72)[0].stockId, "physical-carrier");
  assert.throws(() => G.validateFormation([entries[0], entries[0]], Infinity, 72), /库存单位/);
});

test("production uses a selected empty slot and rejects occupied slots without charging", () => {
  const E = load({baseFacilities:established(),schemaVersion:4,money:100000,supplies:100000,licenses:{Type61:true},inventory:{},kits:{}}).E;
  assert.equal(E.produce("Type61", E.defaultKit("Type61"), "PMC", 12), true);
  assert.equal(E.snapshot().storage.units[0].slot,12);
  const money=E.snapshot().money;
  assert.throws(()=>E.produce("Type61", E.defaultKit("Type61"), "PMC",12));
  assert.equal(E.snapshot().money,money);
  assert.equal(load(E.snapshot()).E.snapshot().storage.units[0].slot,12);
});

test("facility slot migration preserves all legacy chassis, wallet and positions", () => {
  const {E}=load();const old=E.initial();
  old.money=12345;old.supplies=67890;
  old.baseFacilities={version:1,buildings:[],deployments:[]};
  old.storage={version:1,serial:0,pages:{units:3,ships:3},units:[],ships:[],deliveries:[]};
  old.inventory={RGM_79:24,Medea:9};
  const migrated=E.validate(old);assert.equal(migrated.storage.units.length,24);assert.equal(migrated.storage.ships.length,9);
  assert.equal(migrated.money,12345);assert.equal(migrated.supplies,67890);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.storage.slots)),{units:30,ships:12});
  const reloaded=load(migrated).E.snapshot();assert.equal(JSON.stringify(reloaded),JSON.stringify(migrated));
});

test("level five stores sixty units and twenty ships and preserves overflow rewards", () => {
  const {E}=load();const next=E.initial();next.baseFacilities.levels={hq:5,factory:5,giantFactory:5,beacon:3,academy:5};
  next.inventory={RGM_79:61,Medea:21};const value=E.validate(next);
  assert.equal(value.storage.units.length,60);assert.equal(value.storage.ships.length,20);assert.equal(value.storage.deliveries.length,2);
  assert.equal(require('../shared/warehouse').profile([...value.storage.units,...value.storage.ships],catalog.models).length,80);
  assert.equal(JSON.stringify(load(value).E.snapshot()),JSON.stringify(value));
});

test("fresh beacon recruitment rejects locked grades without charging", () => {
  const {E:seed}=load();const fresh=seed.initial();fresh.money=100000;
  const {E}=load(fresh);const before=JSON.stringify(E.snapshot());
  assert.equal(E.recruitCrew("elite"),false);assert.equal(E.recruitCrew("enhanced"),false);assert.equal(JSON.stringify(E.snapshot()),before);
  assert.equal(E.recruitCrew("veteran"),false);assert.equal(E.customPilotLimit(),10);assert.equal(E.acePilotLimit(),10);
});
