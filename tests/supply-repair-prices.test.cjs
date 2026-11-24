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
    const model=catalog.models[id+'__'+item.kitId],modules=model.modules||[];
    E.creditAward({id:"damage",matchId:"damage",money:0,supplies:0,
      stockStates:[{...stockState,...(modules.length?{moduleHp:{[modules[0].id]:0}}:{brokenParts:{head:true}})}]});
    const parts=E.repairQuote([item.id]);
    const partFee=Math.ceil(base/(modules.length||6));
    assert.equal(parts.supplies,partFee,id);
    assert(E.repairAllStoredUnits(parts));
    assert.equal(E.snapshot().supplies,before-partFee,id);
    assert.equal(load(E.snapshot()).repairQuote([item.id]).items.length,0,id);
    E.creditAward({id:"wreck",matchId:"wreck",money:0,supplies:0,
      stockLost:{inventory:{[id]:1}},stockLostItems:[{stockId:item.id,unitId:id}]});
    const wreck=E.repairQuote([item.id]);
    assert.equal(wreck.supplies,base*2,id);
    assert(E.repairAllStoredUnits(wreck));
    assert.equal(E.snapshot().supplies,before-partFee-base*2,id);
    assert.equal(E.quantity(id),1,id);
    E.creditAward({id:"resources",matchId:"resources",money:0,supplies:0,stockStates:[stockState]});
    assert.equal(E.repairQuote([item.id]).supplies,0,id);
  }
});

test('MS repair prorates the six body parts and ignores unknown parts',()=>{
 const E=load();E.creditActivity({id:'ms-gift',matchId:'ms-gift',money:0,supplies:1000000,inventory:{RGM_79:1}});
 const item=E.snapshot().storage.units.find(i=>i.unitId==='RGM_79'),m=catalog.models['RGM_79__'+item.kitId];
 const price=production.licenseOffers.RGM_79.supplies*4;
 const keys=['head','backpack','leftArm','rightArm','leftLeg','rightLeg'];
 for(const count of [0,1,3,6]){
  E.creditAward({id:'parts-'+count,matchId:'parts-'+count,money:0,supplies:0,stockStates:[{stockId:item.id,unitId:item.unitId,kitId:item.kitId,hp:m.hp-1,en:m.en,brokenParts:Object.fromEntries(keys.slice(0,count).map(k=>[k,true]))}]});
  const quote=E.repairQuote([item.id]);assert.equal(quote.supplies,Math.ceil(price*.25*count/6));
  assert(E.repairAllStoredUnits(quote));assert.equal(E.repairQuote([item.id]).items.length,0);
 }
});

test('ship repair charges only fully destroyed modules and restores partial damage for free',()=>{
 const E=load();E.creditActivity({id:'ship-gift',matchId:'ship-gift',money:0,supplies:1000000,inventory:{ArchangelClass:1}});
 const item=E.snapshot().storage.ships.find(i=>i.unitId==='ArchangelClass'),m=catalog.models['ArchangelClass__'+item.kitId];
 const price=production.licenseOffers.ArchangelClass.supplies*4;
 for(const count of [0,1,2,m.modules.length]){
  const moduleHp=Object.fromEntries(m.modules.map((p,i)=>[p.id,i<count?0:p.hp-1]));
  E.creditAward({id:'modules-'+count,matchId:'modules-'+count,money:0,supplies:0,stockStates:[{stockId:item.id,unitId:item.unitId,kitId:item.kitId,hp:m.hp,en:m.en,moduleHp}]});
  const quote=E.repairQuote([item.id]);assert.equal(quote.supplies,Math.ceil(price*.25*count/m.modules.length));
  assert(E.repairAllStoredUnits(quote));assert.equal(E.repairQuote([item.id]).items.length,0);
  assert(m.modules.every(p=>E.snapshot().storage.ships.find(i=>i.id===item.id).moduleHp[p.id]===p.hp));
 }
});
