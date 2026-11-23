const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { createRequire } = require("node:module");
const catalog = require("../tools/load-catalog.cjs").loadCatalog({embedAssets:false});
const production = require("../shared/production-data.cjs");
function load(saved) {
  const records = new Map(saved ? [["projectgreed.economy.v1", JSON.stringify(saved)]] : []);
  const context = vm.createContext({require:createRequire(path.resolve("shared/economy.js")),
    module:{exports:{}}, structuredClone, ART:catalog,
    localStorage:{getItem:key=>records.get(key)??null, setItem:(key,value)=>records.set(key,value),
      removeItem:key=>records.delete(key)}});
  vm.runInContext(fs.readFileSync("shared/economy.js","utf8"),context);
  return context.module.exports;
}

test("every permanent supply reward has a positive own or referenced maintenance basis", () => {
  for (const pool of require("../shared/supply-pools.json"))
    for (const grade of pool.grades)
      for (const reward of grade.rewards.filter(reward=>reward.kind==="unit"))
        for (const id of reward.unitIds) {
          const offer = production.licenseOffers[id] ||
            production.licenseOffers[production.repairPriceReferences[id]];
          assert(offer?.supplies > 0, id);
        }
});

test("unpriced reward units pay for broken parts and wrecks, persist repairs and keep production locked", () => {
  for (const [id, reference] of Object.entries(production.repairPriceReferences)) {
    const saved=load().initial();
    saved.baseFacilities={version:2,levels:{hq:3,factory:2,giantFactory:3,beacon:3,academy:1}};
    const E=load(saved);
    E.creditActivity({id:"gift",matchId:"gift",money:0,supplies:1000000,inventory:{[id]:1}});
    const item=[...E.snapshot().storage.units,...E.snapshot().storage.ships].find(item=>item.unitId===id);
    assert(item,id);
    assert.equal(E.productionOffer(id,E.defaultKit(id)),null,id);
    const before=E.snapshot().supplies, base=production.licenseOffers[reference].supplies;
    const stockState={stockId:item.id,unitId:id,kitId:item.kitId,hp:100,en:0};
    E.creditAward({id:"damage",matchId:"damage",money:0,supplies:0,
      stockStates:[{...stockState,brokenParts:{head:true}}]});
    const parts=E.repairQuote([item.id]);
    assert.equal(parts.supplies,base,id);
    assert(E.repairAllStoredUnits(parts));
    assert.equal(E.snapshot().supplies,before-base,id);
    assert.equal(load(E.snapshot()).repairQuote([item.id]).items.length,0,id);
    E.creditAward({id:"wreck",matchId:"wreck",money:0,supplies:0,
      stockLost:{inventory:{[id]:1}},stockLostItems:[{stockId:item.id,unitId:id}]});
    const wreck=E.repairQuote([item.id]);
    assert.equal(wreck.supplies,base*2,id);
    assert(E.repairAllStoredUnits(wreck));
    assert.equal(E.snapshot().supplies,before-base*3,id);
    assert.equal(E.quantity(id),1,id);
    E.creditAward({id:"resources",matchId:"resources",money:0,supplies:0,stockStates:[stockState]});
    assert.equal(E.repairQuote([item.id]).supplies,0,id);
  }
});
