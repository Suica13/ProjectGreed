const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createRequire}=require('node:module'),path=require('node:path');
const catalog=require('../tools/load-catalog.cjs').loadCatalog({embedAssets:false});
function load(saved){
  const records=new Map(saved?[['projectgreed.economy.v1',JSON.stringify(saved)]]:[]);
  const context=vm.createContext({require:createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:catalog,
    Development:{allows:()=>false},localStorage:{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)}});
  vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),context);
  return {E:context.module.exports,records};
}

test('part and wreck repairs use the new sixfold material production price while HP and EN recovery stay free',()=>{
  const {E}=load();
  E.creditActivity({id:'repair-price-wallet',matchId:'repair-price-wallet',money:0,supplies:1000000,inventory:{}});
  const [wreck,parts,resources]=E.snapshot().storage.units;
  E.creditAward({id:'repair-price-damage',matchId:'repair-price-battle',money:0,supplies:0,
    stockLost:{inventory:{[wreck.unitId]:1}},stockLostItems:[{stockId:wreck.id,unitId:wreck.unitId}],
    stockStates:[{stockId:parts.id,unitId:parts.unitId,kitId:parts.kitId,hp:100,en:0,brokenParts:{head:true}},
      {stockId:resources.id,unitId:resources.unitId,kitId:resources.kitId,hp:100,en:0}]});
  const quote=E.repairQuote([wreck.id,parts.id,resources.id]);
  assert.equal(quote.items.find(item=>item.id===wreck.id).supplies,Math.ceil(E.unitOffer(wreck.unitId).supplies*6*0.75));
  assert.equal(quote.items.find(item=>item.id===parts.id).supplies,Math.ceil(E.unitOffer(parts.unitId).supplies*6*0.5));
  assert.equal(quote.items.find(item=>item.id===resources.id).supplies,0);
  const before=E.snapshot();assert(E.repairAllStoredUnits(quote));
  const after=E.snapshot();assert.equal(after.money,before.money);assert.equal(after.supplies,before.supplies-quote.supplies);
  assert.equal(E.repairQuote([wreck.id,parts.id,resources.id]).items.length,0);
  assert.equal(load(after).E.snapshot().supplies,after.supplies);
});
test('permits cannot be purchased directly, through transactions, or through bulk stock purchases',()=>{
  const {E}=load();E.creditActivity({id:'wallet',matchId:'wallet',money:1000000,supplies:1000000,inventory:{}});
  assert.equal(E.hasLicense('RX_78_2'),false);const before=JSON.stringify(E.snapshot());
  assert.equal(E.purchaseLicense('RX_78_2','PMC'),false);
  assert.equal(E.transact({}, {RX_78_2:true}),false);
  const entries=[{unitId:'RX_78_2',kitId:E.defaultKit('RX_78_2')}];
  assert.equal(E.purchaseMissingLicenses(entries,'PMC').ok,false);
  assert.equal(E.purchaseMissingStock(entries,'PMC').ok,false);
  assert(E.purchasePlan(entries).items.every(item=>item.kind==='inventory'));
  assert.equal(JSON.stringify(E.snapshot()),before);
});
test('awards grant permits without a free chassis and licensed production ignores development and uses the default kit',()=>{
  const {E}=load();const unit='RX_78_2',kit=E.defaultKit(unit),beforeCount=E.quantity(unit);
  const award={id:'permit-award',matchId:'permit-award',money:1000000,supplies:1000000,licenses:{[unit]:true},inventory:{}};
  assert(E.creditActivity(award));assert.equal(E.quantity(unit),beforeCount);assert(E.hasLicense(unit));
  assert.equal(E.creditActivity(award),false);
  const alternate=catalog.prefabs.find(p=>p.id===unit).weaponKits.find(k=>k.id!==kit).id;
  assert(E.mayProduce(unit,'PMC'));
  const before=E.snapshot(),offer=E.productionOffer(unit,kit);assert(E.produce(unit,alternate,'PMC'));
  const base=E.unitOffer(unit);assert.equal(offer.money,base.money*3);assert.equal(offer.supplies,base.supplies*6);assert.equal(offer.chassis.money,offer.money);
  const plan=E.purchasePlan([{unitId:unit,kitId:kit}]);assert.equal(plan.money,0);
  const after=E.snapshot(),item=after.storage.units.find(item=>item.unitId===unit);
  assert.equal(item.kitId,kit);assert.equal(after.money,before.money-offer.money);assert.equal(after.supplies,before.supplies-offer.supplies);
  assert.equal(E.quantity(unit),beforeCount+1);assert.equal(load(after).E.hasLicense(unit),true);
});
test('unlicensed production cannot consume resources even with stock already owned',()=>{
  const {E}=load();E.creditActivity({id:'stock-only',matchId:'stock-only',money:100000,supplies:100000,inventory:{RX_78_2:1}});
  const before=JSON.stringify(E.snapshot());assert.equal(E.mayProduce('RX_78_2','PMC'),false);
  assert.equal(E.produce('RX_78_2',E.defaultKit('RX_78_2'),'PMC'),false);assert.equal(JSON.stringify(E.snapshot()),before);
});

test('module activity gifts persist atomically with permits and cannot be claimed twice',()=>{
  const {E}=load();
  const award={id:'module-mail',matchId:'module-mail',money:25,supplies:50,pluginInventory:{frame:3},licenses:{RX_78_2:true}};
  assert(E.creditActivity(award));
  assert.equal(E.snapshot().pluginInventory.frame,3);
  assert(E.hasLicense('RX_78_2'));
  const after=JSON.stringify(E.snapshot());
  assert.equal(E.creditActivity(award),false);
  assert.equal(JSON.stringify(E.snapshot()),after);
  assert.equal(load(E.snapshot()).E.snapshot().pluginInventory.frame,3);
  assert.throws(()=>E.creditActivity({...award,id:'bad-module',pluginInventory:{unknown:1}}));
  assert.equal(JSON.stringify(E.snapshot()),after);
});

test('Gelgoog Ground Type and GM Light Armor are T2 across every equipment kit',()=>{
  const G=require('../shared/rules');
  for(const id of ['MS_14G','RGM_79L']){
    const prefab=G.catalog.prefabs.find(p=>p.id===id);
    assert(prefab.tags.includes('UC_0079_T2'));assert(!prefab.tags.includes('UC_0079_T1'));
    assert.equal(prefab.sourceStats.technologyEra,'UC_0079_T2');assert.equal(prefab.sourceStats.technologyWeight,2);
    for(const kit of prefab.weaponKits){const model=G.models[id+'__'+kit.id];assert(model.tags.includes('UC_0079_T2'));assert.equal(model.technologyWeight,2);}
  }
});
