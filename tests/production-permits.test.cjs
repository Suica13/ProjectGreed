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
  const after=E.snapshot(),item=after.storage.units.find(item=>item.unitId===unit);
  assert.equal(item.kitId,kit);assert.equal(after.money,before.money-offer.money);assert.equal(after.supplies,before.supplies-offer.supplies);
  assert.equal(E.quantity(unit),beforeCount+1);assert.equal(load(after).E.hasLicense(unit),true);
});
test('unlicensed production cannot consume resources even with stock already owned',()=>{
  const {E}=load();E.creditActivity({id:'stock-only',matchId:'stock-only',money:100000,supplies:100000,inventory:{RX_78_2:1}});
  const before=JSON.stringify(E.snapshot());assert.equal(E.mayProduce('RX_78_2','PMC'),false);
  assert.equal(E.produce('RX_78_2',E.defaultKit('RX_78_2'),'PMC'),false);assert.equal(JSON.stringify(E.snapshot()),before);
});
