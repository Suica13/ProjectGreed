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

test("liaison level switches at 800 affinity, persists and preserves old claimed-task affinity", () => {
 const initial=funded().E.snapshot();
 for(const [points,level] of [[0,1],[799.9,1],[800,2],[1250,2]]){
  const {E}=load({...initial,contactAffinity:points});
  assert.equal(E.liaisonAffinity(),points);assert.equal(E.liaisonLevel(),level);
  assert.equal(load(E.snapshot()).E.liaisonLevel(),level);
 }
 const old={...initial,contactTasks:[{id:'efsf-1',status:'claimed',progress:6}]};delete old.contactAffinity;
 assert.equal(load(old).E.liaisonAffinity(),100);
 const legacy={...old,contactAffinity:.1};delete legacy.contactRewardVersion;
 const migrated=load(legacy).E;assert.equal(migrated.liaisonAffinity(),100);
 assert.equal(load(migrated.snapshot()).E.liaisonAffinity(),100);
 assert(load({...initial,contactAffinity:-1}).E.storageIssue());
});

test("beacon remains locked after all commissions and HQ level two, without advertising an unrelated task", () => {
 const initial=funded().E.snapshot();initial.baseFacilities.levels.hq=2;
 initial.contactTasks=require('../shared/contact-tasks').tasks.map(t=>({id:t.id,status:'claimed',progress:t.required}));
 const {E}=load(initial),before=JSON.stringify(E.snapshot()),offer=E.facilityUpgradeOffer('beacon');
 assert.equal(offer.available,false);assert.equal(offer.money,null);assert.equal(offer.supplies,null);
 assert.match(offer.condition,/信标/);assert(!offer.condition.includes('绿色通道'));
 assert.throws(()=>E.upgradeFacility('beacon'));assert.equal(JSON.stringify(E.snapshot()),before);
 assert.equal(E.facilityUpgradeOffer('factory').available,true);
});
test("ten commissions follow dependencies, commit rewards once and retain Green Corridor facility unlocks",()=>{
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
 assert.equal(E.liaisonAffinity(),1000);assert(E.hasLicense('RX_79_G'));assert(E.hasLicense('RX_78_2'));assert(E.hasLicense('RX_77_3'));
 assert.equal(E.quantity('RX_80PR'),0);
 const before=E.snapshot();
 assert.equal(E.facilityUpgradeOffer('factory').available,false);
 assert(E.upgradeFacility('hq'));assert.equal(E.snapshot().money,before.money-20000);assert.equal(E.snapshot().supplies,before.supplies-20000);
 for(const id of ['factory','giantFactory','academy'])assert(E.upgradeFacility(id));
 assert.equal(E.snapshot().money,before.money-50000);assert.equal(E.snapshot().supplies,before.supplies-50000);
 assert.equal(E.storageUsage('units').slots,30);assert.equal(E.storageUsage('ships').slots,10);assert.equal(E.customPilotLimit(),20);
 assert.throws(()=>E.upgradeFacility('hq'));assert.throws(()=>E.upgradeFacility('beacon'));
 assert(earned>0);
});

test("planning 1.21 branches seven and eight from Green Corridor and accepts N4-N6 while rejecting removed levels",()=>{
 const C=require('../shared/contact-tasks'),initial=funded().E.snapshot();
 initial.contactIntro=true;initial.contactTasks=C.tasks.slice(0,6).map(t=>({id:t.id,status:'claimed',progress:t.required}));
 const {E}=load(initial);assert.equal(C.planningVersion,'1.21');assert.equal(C.tasks.length,10);
 assert(E.acceptContactTask('efsf-8'));assert(E.acceptContactTask('efsf-7'));
 assert.throws(()=>E.acceptContactTask('efsf-9'));
 assert(C.eligible(C.byId.get('efsf-7'),{mode:'sweep',sweepFaction:'EFSF',sweepDifficulty:3,sweepEnvironment:'ground'}));
 assert(!C.eligible(C.byId.get('efsf-7'),{mode:'sweep',sweepFaction:'ZEON',sweepDifficulty:3,sweepEnvironment:'ground'}));
 for(const difficulty of [4,5,6])assert.doesNotThrow(()=>G.validateOpenContent({mode:'sweep',sweepDifficulty:difficulty,sweepEra:'UC_0079_T1'}));
 for(const difficulty of [7,8,9])assert.throws(()=>G.validateOpenContent({mode:'sweep',sweepDifficulty:difficulty,sweepEra:'UC_0079_T1'}));
});

test("mainline technology missions include their prerequisite chain and locked tasks explain unclaimed requirements",()=>{
 const C=require('../shared/contact-tasks');
 assert.deepEqual(C.tasks.filter(C.isSideTask).map(t=>t.id),['efsf-7','efsf-10']);
 for(const id of ['efsf-1','efsf-6','efsf-8','efsf-9'])assert(!C.isSideTask(C.byId.get(id)),id);
 const task=C.byId.get('efsf-9');
 assert.deepEqual(C.unmetRequirements(task,[],false),[{type:'intro'},{type:'task',id:'efsf-8',name:'最好的差事'}]);
 for(const status of ['accepted','ready'])assert(!C.unlocked(task,[{id:'efsf-8',status,progress:50}],true));
 assert.deepEqual(C.unmetRequirements(task,[{id:'efsf-8',status:'claimed',progress:50}],true),[]);
 assert(C.unlocked(task,[{id:'efsf-8',status:'claimed',progress:50}],true));
});

test("Pale Rider loan returns on verified completion without consuming another chassis or installed plugins",()=>{
 const {E}=funded(),state=E.snapshot(),C=require('../shared/contact-tasks');
 state.contactIntro=true;state.contactTasks=C.tasks.slice(0,4).map(t=>({id:t.id,status:'claimed',progress:t.required}));
 const x=load(state).E;
 x.creditActivity({id:'owned',matchId:'owned',money:0,supplies:0,inventory:{RX_80PR:1}});
 const owned=x.snapshot().storage.units.find(u=>u.unitId==='RX_80PR').id;
 x.acceptContactTask('efsf-5');
 let s=x.snapshot(),loan=s.storage.units.find(u=>u.contactLoan==='efsf-5');assert(loan);assert.notEqual(loan.id,owned);
 assert(x.isContactLoan(loan));
 const unchanged=JSON.stringify(x.snapshot());
 assert.throws(()=>x.discardStoredUnit(loan.id),/任务借用/);assert.throws(()=>x.sellUnit(loan.unitId,loan.id),/任务借用/);
 assert.throws(()=>x.setStoredPlugin(loan.id,0,'frame'),/任务临时单位不能装备零件/);
 assert.equal(JSON.stringify(x.snapshot()),unchanged);
 const plugin=require('../shared/unit-plugins').catalog[0].id;
 s.pluginInventory[plugin]=1;loan.plugins=[plugin];loan.pilotId='custom-loan-pilot';
 const restored=load(s).E;
 assert(!restored.snapshot().storage.units.find(u=>u.id===loan.id).plugins.some(Boolean));
 assert.equal(restored.pluginQuantity(plugin),1);
 restored.creditAward({id:'loan-complete',matchId:'loan-battle',money:0,supplies:0,contactProgress:[{id:'efsf-5',amount:4}]});
 assert.equal(restored.quantity('RX_80PR'),1);
 assert(restored.snapshot().storage.units.some(u=>u.id===owned));
 assert(!restored.snapshot().storage.units.some(u=>u.id===loan.id));
 assert(!restored.snapshot().storage.units.some(u=>u.pilotId==='custom-loan-pilot'));
 assert.equal(restored.snapshot().pluginInventory[plugin],1);
 assert.equal(load(restored.snapshot()).E.snapshot().contactTasks.find(e=>e.id==='efsf-5').loanReturned,true);
 assert.equal(restored.creditAward({id:'loan-complete',matchId:'loan-battle',money:0,supplies:0}),false);
 restored.completeContactTask('efsf-5');assert.equal(restored.quantity('RX_80PR'),1);
});

test("Pale Rider loan protection and automatic return also cover safekeeping and destroyed chassis",()=>{
 const C=require('../shared/contact-tasks');
 for(const mode of ['delivery','destroyed','legacy']){
  const state=funded().E.snapshot();state.contactIntro=true;
  state.contactTasks=C.tasks.slice(0,4).map(t=>({id:t.id,status:'claimed',progress:t.required}));
  let E=load(state).E;
  if(mode==='delivery')E.creditActivity({id:'full',matchId:'full',money:0,supplies:0,inventory:{RGM_79:E.storageUsage('units').slots-E.snapshot().storage.units.length}});
  E.acceptContactTask('efsf-5');let saved=E.snapshot();
  const item=[...saved.storage.units,...saved.storage.deliveries].find(item=>item.contactLoan==='efsf-5');assert(item);
  if(mode==='delivery')assert.throws(()=>E.discardDelivery(saved.storage.deliveries.findIndex(i=>i.contactLoan==='efsf-5')),/任务借用/);
  if(mode==='destroyed'){item.destroyed=true;item.hp=0;item.en=0;saved.inventory.RX_80PR=0;}
  if(mode==='legacy'){delete item.contactLoan;delete saved.contactTasks.find(e=>e.id==='efsf-5').loanTracking;}
  E=load(saved).E;const loan=[...E.snapshot().storage.units,...E.snapshot().storage.deliveries].find(i=>i.contactLoan==='efsf-5');assert(E.isContactLoan(loan));
  E.creditAward({id:'return-'+mode,matchId:'return-'+mode,money:0,supplies:0,contactProgress:[{id:'efsf-5',amount:4}]});
  assert(![...E.snapshot().storage.units,...E.snapshot().storage.deliveries].some(i=>i.contactLoan==='efsf-5'));
  assert.equal(E.quantity('RX_80PR'),0);
 }
});

test("planning JSON 1.21 round trips all ten stable IDs and dependency branches",()=>{
 const C=require('../shared/contact-tasks'),M=require('../task-editor/model');
 const plan=JSON.parse(fs.readFileSync('docs/data/contacts/efsf-联邦联络人-1.21.json','utf8'));
 assert.equal(plan.systemVersion,C.planningVersion);
 assert.deepEqual(M.validate(plan,plan.aiGuide.statusMeanings),[]);
 assert.deepEqual(plan.contacts[0].tasks.map(t=>t.id),C.tasks.map(t=>t.id));
 for(const task of C.tasks)assert.deepEqual(plan.contacts[0].tasks.find(t=>t.id===task.id).requires,task.requires);
});
test("full unit and ship rewards remain in safekeeping and can be individually accepted without duplication",()=>{
 const {E}=funded();
 E.creditActivity({id:'fill',matchId:'fill',money:0,supplies:0,inventory:{RGM_79:E.storageUsage('units').slots-E.snapshot().storage.units.length,Medea:E.storageUsage('ships').slots-E.snapshot().storage.ships.length}});
 assert(E.creditActivity({id:'overflow',matchId:'overflow',money:0,supplies:0,inventory:{RX_77_2:2,ColumbusClass:1}}));
 assert.equal(E.snapshot().storage.deliveries.length,3); // Only the new reward overflows the exactly full warehouses.
 const before=E.snapshot();E.receiveDeliveries(2);assert.deepEqual(E.snapshot().storage.deliveries,before.storage.deliveries);
 const unit=E.snapshot().storage.units[0];assert(E.discardStoredUnit(unit.id));
 const index=E.snapshot().storage.deliveries.findIndex(u=>u.unitId==='RX_77_2');assert(index>=0);
 E.receiveDeliveries(index);assert.equal(E.snapshot().storage.deliveries.length,2);assert.equal(E.quantity('RX_77_2'),1);
 const ship=E.snapshot().storage.ships[0];E.discardStoredUnit(ship.id);
 E.receiveDeliveries(E.snapshot().storage.deliveries.findIndex(u=>u.unitId==='ColumbusClass'));
 assert.equal(E.quantity('ColumbusClass'),1);assert.equal(E.snapshot().storage.deliveries.length,1);
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
