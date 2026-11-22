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

test("first liaison contact grants unit permits once without researching the tree",()=>{
 const {E}=funded();assert.equal(E.snapshot().contactIntro,false);
 assert(E.meetLiaison());assert(E.hasLicense("RGM_79_E"));assert(E.hasLicense("RB_79"));
 const saved=JSON.stringify(E.snapshot());assert.equal(E.meetLiaison(),false);
 assert.equal(JSON.stringify(E.snapshot()),saved);
 assert.equal(load(E.snapshot()).E.snapshot().contactIntro,true);
});
test("six commissions unlock in sequence, commit rewards once, preserve progress and unlock paid facility upgrades",()=>{
 const {E}=funded();E.meetLiaison();
 assert.throws(()=>E.acceptContactTask("efsf-2"));
 const Contact=require('../shared/contact-tasks');let earned=0;
 for(const task of Contact.tasks){
  assert(E.acceptContactTask(task.id));
  assert.throws(()=>E.acceptContactTask(task.id));assert.throws(()=>E.completeContactTask(task.id));
  if(task.id==='efsf-5')assert(E.snapshot().storage.units.some(u=>u.unitId==='RX_80PR'));
  const receipt={id:'progress-'+task.id,matchId:'battle-'+task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:task.required}]};
  assert(E.creditAward(receipt));assert.equal(E.creditAward(receipt),false);
  assert.equal(load(E.snapshot()).E.snapshot().contactTasks.find(e=>e.id===task.id).status,'ready');
  const before=E.snapshot().money;assert(E.completeContactTask(task.id));earned+=task.money;
  assert.equal(E.snapshot().money,before+task.money);assert.throws(()=>E.completeContactTask(task.id));
 }
 assert.equal(E.liaisonAffinity(),.6);assert(E.hasLicense('RX_79_G'));
 const before=E.snapshot();
 assert.equal(E.facilityUpgradeOffer('factory').available,false);
 assert(E.upgradeFacility('hq'));assert.equal(E.snapshot().money,before.money-20000);assert.equal(E.snapshot().supplies,before.supplies-20000);
 for(const id of ['factory','giantFactory','academy'])assert(E.upgradeFacility(id));
 assert.equal(E.snapshot().money,before.money-50000);assert.equal(E.snapshot().supplies,before.supplies-50000);
 assert.equal(E.storageUsage('units').slots,30);assert.equal(E.storageUsage('ships').slots,8);assert.equal(E.customPilotLimit(),20);
 assert.throws(()=>E.upgradeFacility('hq'));assert.throws(()=>E.upgradeFacility('beacon'));
 assert(earned>0);
});
test("full unit and ship rewards remain in safekeeping and can be individually accepted without duplication",()=>{
 const {E}=funded();E.creditActivity({id:'fill',matchId:'fill',money:0,supplies:0,inventory:{RGM_79:20,Medea:4}});
 assert(E.creditActivity({id:'overflow',matchId:'overflow',money:0,supplies:0,inventory:{RX_77_2:2,ColumbusClass:1}}));
 assert.equal(E.snapshot().storage.deliveries.length,5); // two GM overflow plus three reward units
 const before=E.snapshot();E.receiveDeliveries(2);assert.deepEqual(E.snapshot().storage.deliveries,before.storage.deliveries);
 const unit=E.snapshot().storage.units[0];assert(E.discardStoredUnit(unit.id));
 const index=E.snapshot().storage.deliveries.findIndex(u=>u.unitId==='RX_77_2');assert(index>=0);
 E.receiveDeliveries(index);assert.equal(E.snapshot().storage.deliveries.length,4);assert.equal(E.quantity('RX_77_2'),1);
 const ship=E.snapshot().storage.ships[0];E.discardStoredUnit(ship.id);
 E.receiveDeliveries(E.snapshot().storage.deliveries.findIndex(u=>u.unitId==='ColumbusClass'));
 assert.equal(E.quantity('ColumbusClass'),1);assert.equal(E.snapshot().storage.deliveries.length,3);
 const restored=load(E.snapshot()).E;assert.equal(JSON.stringify(restored.snapshot()),JSON.stringify(E.snapshot()));
});
test("failed task writes roll back permits, progress, acceptance gifts and reward claims",()=>{
 const result=funded();const before=JSON.stringify(result.E.snapshot());result.fail();
 assert.throws(()=>result.E.meetLiaison(),/write failed/);assert.equal(JSON.stringify(result.E.snapshot()),before);
 const good=funded().E;good.meetLiaison();good.acceptContactTask('efsf-1');
 good.creditAward({id:'ready',matchId:'ready',money:0,supplies:0,contactProgress:[{id:'efsf-1',amount:6}]});
 const failing=load(good.snapshot()),saved=JSON.stringify(failing.E.snapshot());failing.fail();assert.throws(()=>failing.E.completeContactTask('efsf-1'),/write failed/);
 assert.equal(JSON.stringify(failing.E.snapshot()),saved);
});
test("unlicensed Pale Rider rewards remain repairable even when completely destroyed",()=>{
 const {E}=funded();E.creditActivity({id:'pale',matchId:'pale',money:0,supplies:0,inventory:{RX_80PR:1}});
 const state=E.snapshot();delete state.licenses.RX_80PR;
 const item=state.storage.units.find(u=>u.unitId==='RX_80PR');item.destroyed=true;item.hp=0;item.en=0;state.inventory.RX_80PR=0;
 const restored=load(state).E;assert.equal(restored.hasLicense('RX_80PR'),false);
 const quote=restored.repairQuote([item.id]);assert.equal(quote.items.length,1);assert(restored.repairAllStoredUnits(quote));
 assert.equal(restored.quantity('RX_80PR'),1);assert.equal(restored.hasLicense('RX_80PR'),false);
});
