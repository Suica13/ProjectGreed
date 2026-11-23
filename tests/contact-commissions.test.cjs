const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const G = require("../shared/rules.js"),
  codec = require("../shared/save-codec.js");

test("new 1.3 commissions require both branches and grant production permits once",()=>{
 const C=require('../shared/contact-tasks'),state=funded().E.snapshot();
 state.contactIntro=true;
 state.contactTasks=C.tasks.filter(t=>(t.contactId||'efsf')==='efsf'&&t.number<=9&&t.id!=='efsf-7').map(t=>({id:t.id,status:'claimed',progress:t.required}));
 const {E}=load(state);
 assert.throws(()=>E.acceptContactTask('efsf-12'));
 assert(E.acceptContactTask('efsf-11'));
 assert.throws(()=>E.completeContactTask('efsf-11'));
 E.creditAward({id:'trina',matchId:'trina',money:0,supplies:0,contactProgress:[{id:'efsf-11',amount:1}]});
 const balance=E.snapshot().money;
 E.completeContactTask('efsf-11');assert.equal(E.snapshot().money,balance+20000);
 assert(E.hasLicense('RGM_79'));
 assert.throws(()=>E.acceptContactTask('efsf-12'),'Renass prerequisite is still missing');
 E.acceptContactTask('efsf-7');
 E.creditAward({id:'renass-new',matchId:'renass-new',money:0,supplies:0,contactProgress:[{id:'efsf-7',amount:1}]});
 E.completeContactTask('efsf-7');E.acceptContactTask('efsf-12');
 E.creditAward({id:'pixy',matchId:'pixy',money:0,supplies:0,contactProgress:[{id:'efsf-12',amount:1}]});
 E.completeContactTask('efsf-12');assert(E.hasLicense('RX_80PR'));
 assert.throws(()=>E.completeContactTask('efsf-12'));
 assert.equal(load(E.snapshot()).E.snapshot().contactTasks.find(t=>t.id==='efsf-12').status,'claimed');
 const doc=JSON.parse(fs.readFileSync('docs/data/contacts/efsf-联邦联络人-1.3.json','utf8'));
 const M=require('../task-editor/model');assert.deepEqual(M.validate(doc,require('../task-editor/catalog.cjs')),[]);
 for(const id of ['efsf-11','efsf-12']){
  const task=C.byId.get(id),entry=doc.contacts[0].tasks.find(t=>t.id===id);
  assert.deepEqual(entry.requires,task.requires);assert(entry.text.includes(task.description));assert(entry.text.includes(task.ending));
 }
 for(const id of ['task_3','task_4','task_5'])assert(!C.byId.has(id),'unrequested drafts remain planning only');
});
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

test("Anaheim mid-0079 commissions require 0079T1 without changing their difficulty gates",()=>{
 const C=require('../shared/contact-tasks');
 for(const task of C.tasks.filter(t=>t.contactId==='anaheim')){
  assert.equal(task.era,'UC_0079_T1');
  const settings={mode:'sweep',sweepFaction:task.enemyFaction,sweepEnvironment:'ground',sweepEra:'UC_0079_T1',sweepDifficulty:task.difficulty};
  assert(C.eligible(task,settings),task.id);
  assert(!C.eligible(task,{...settings,sweepEra:'UC_0079_T2'}),task.id);
  assert(!C.eligible(task,{...settings,sweepDifficulty:task.difficulty-1}),task.id);
 }
});

test("Anaheim commissions unlock every product by claimed task, never by affinity alone",()=>{
 const {E}=funded(),C=require('../shared/contact-tasks'),P=require('../shared/unit-plugins');
 const tasks=C.tasks.filter(t=>t.contactId==='anaheim');assert.equal(tasks.length,10);
 const parts=P.catalog.filter(p=>p.merchant==='anaheim');assert.equal(parts.length,19);
 assert(parts.every(p=>!E.pluginOffer('anaheim',p.id).available));
 assert.throws(()=>E.purchasePlugin('anaheim','frame'),/前提任务/);
 assert(E.meetLiaison('anaheim'));assert.equal(E.snapshot().contactIntro,false);
 assert(C.met(E.snapshot(),'anaheim'));assert.equal(E.meetLiaison('anaheim'),false);
 const unlocked=new Set();
 for(const task of tasks){
  assert(E.acceptContactTask(task.id));
  if(task.reclaim)assert(E.snapshot().storage.units.some(u=>u.contactLoan===task.id&&u.unitId==='RX_79_G'));
  E.creditAward({id:'ae-'+task.id,matchId:'ae-'+task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:task.required}]});
  for(const id of task.pluginUnlocks)assert(!E.pluginOffer('anaheim',id).available,'ready is not claimed');
  E.completeContactTask(task.id);task.pluginUnlocks.forEach(id=>unlocked.add(id));
  for(const part of parts)assert.equal(E.pluginOffer('anaheim',part.id).available,unlocked.has(part.id));
 }
 assert.equal(unlocked.size,19);assert.equal(E.merchantAffinity('anaheim'),1000);assert.equal(E.liaisonAffinity(),0);
 assert(E.purchasePlugin('anaheim','ms_database'));assert.equal(E.pluginQuantity('ms_database'),1);
 const restored=load(E.snapshot()).E;assert(restored.pluginOffer('anaheim','ms_database').available);
 assert(!restored.snapshot().storage.units.some(u=>u.contactLoan==='anaheim-8'));
 const high=restored.snapshot();high.contactTasks=[];high.merchantAffinities.anaheim=10000;
 const locked=load(high).E;assert(!locked.pluginOffer('anaheim','ms_database').available);
 assert.equal(locked.pluginQuantity('ms_database'),1,'owned parts remain available');
});

test("Anaheim planning JSON round trips every original commission and embedded portrait",()=>{
 const A=require('../shared/contact-anaheim'),M=require('../task-editor/model');
 const doc=JSON.parse(fs.readFileSync('docs/data/contacts/anaheim-1.0.json','utf8'));
 assert.deepEqual(M.validate(doc,require('../task-editor/catalog.cjs')),[]);
 for(const task of A.tasks){const entry=doc.contacts[0].tasks.find(t=>t.id===task.id);assert(entry.text.includes(task.description));assert(entry.text.includes(task.ending));}
 assert.deepEqual(Buffer.from(doc.contacts[0].portrait.dataUrl.split(',')[1],'base64'),fs.readFileSync('assets/ui/contact-ae.png'));
});

test("first liaison contact grants unit permits once without researching the tree",()=>{
 const {E}=funded();assert.equal(E.snapshot().contactIntro,false);
 assert(E.meetLiaison());assert(E.hasLicense("RGM_79_E"));assert(E.hasLicense("RB_79"));
 const saved=JSON.stringify(E.snapshot());assert.equal(E.meetLiaison(),false);
 assert.equal(JSON.stringify(E.snapshot()),saved);
 assert.equal(load(E.snapshot()).E.snapshot().contactIntro,true);
});

test("Zeon first contact, progression and affinity are independent from EFSF and survive reload",()=>{
 const {E}=funded(),C=require('../shared/contact-tasks');
 assert(!C.met(E.snapshot(),'zeon'));assert.throws(()=>E.acceptContactTask('zeon-1'));
 assert(E.meetLiaison('zeon'));assert(C.met(E.snapshot(),'zeon'));
 assert.equal(E.snapshot().contactIntro,false);assert(E.hasLicense('MS_06J'));
 assert.equal(E.meetLiaison('zeon'),false);assert.throws(()=>E.acceptContactTask('efsf-1'));
 assert.equal(C.tasks.filter(t=>t.contactId==='zeon').length,11);
 for(const task of C.tasks.filter(t=>t.contactId==='zeon')){
  assert(E.acceptContactTask(task.id));assert.throws(()=>E.acceptContactTask(task.id));
  if(task.id==='zeon-5'){
   const loan=E.snapshot().storage.units.find(u=>u.contactLoan==='zeon-5');assert(loan);
   assert.equal(loan.unitId,'MS_11S');assert(E.isContactLoan(loan));
  }
  const receipt={id:'zeon-'+task.id,matchId:'battle-'+task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:task.required}]};
  assert(E.creditAward(receipt));assert.equal(E.creditAward(receipt),false);
  const before=E.snapshot().money;assert(E.completeContactTask(task.id));
  assert.equal(E.snapshot().money,before+task.money);assert.throws(()=>E.completeContactTask(task.id));
 }
 assert.equal(E.merchantAffinity('zeon'),1100);assert.equal(E.merchantLevel('zeon'),2);
 assert.equal(E.liaisonAffinity(),0);assert.equal(E.snapshot().contactIntro,false);
 assert.equal(E.merchantAffinity('anaheim'),0);assert(!E.snapshot().storage.units.some(u=>u.contactLoan==='zeon-5'));
 const unlocked=new Set([C.introPlan('zeon'),...C.tasks.filter(t=>t.contactId==='zeon').flatMap(C.planIds)]);
 for(const plan of require('../shared/development-tree.json').ZEON.filter(p=>p.era==='UC_0079_T1'&&p.points>0))assert.equal(unlocked.has(plan.id),true,plan.id);
 for(const part of require('../shared/unit-plugins').catalog.filter(p=>p.merchant==='zeon')){
  assert(E.pluginOffer('zeon',part.id).available);assert.equal(E.pluginOffer('efsf',part.id),null);
 }
 for(const unit of ['MS_06J','MS_06G','MS_09','EMS_10','MS_08TX','ApsarasII','MS_11'])assert(E.hasLicense(unit),unit);
 assert(E.hasLicense('MS_06F2'));assert(E.hasLicense('MS_06F2_Commander'));
 const restored=load(E.snapshot()).E;assert(C.met(restored.snapshot(),'zeon'));assert.equal(restored.merchantAffinity('zeon'),1100);
 assert(restored.hasLicense('MS_09'));assert.equal(restored.facilityUpgradeOffer('hq').available,true);
});

test("either sixth liaison commission unlocks the same level-two facilities at unchanged prices",()=>{
 for(const id of ['efsf-6','zeon-6']){
  const state=funded().E.snapshot();state.contactTasks=[{id,status:'claimed',progress:1}];
  const {E}=load(state),offer=E.facilityUpgradeOffer('hq');
  assert(offer.available);assert.equal(offer.money,20000);assert.equal(offer.supplies,20000);
  assert.match(offer.condition,/绿色通道.*或.*通行税/);
  assert(E.upgradeFacility('hq'));
  for(const type of ['factory','giantFactory','academy']){
   const offer=E.facilityUpgradeOffer(type);assert(offer.available);assert.equal(offer.money,10000);assert.equal(offer.supplies,10000);
  }
  assert(!E.facilityUpgradeOffer('beacon').available);
 }
 for(const status of ['accepted','ready']){
  const state=funded().E.snapshot();state.contactTasks=[{id:'zeon-6',status,progress:1}];
  assert(!load(state).E.facilityUpgradeOffer('hq').available);
 }
});

test("Zeon trial loan returns only the borrowed command Zaku and detaches its pilot and parts",()=>{
 const C=require('../shared/contact-tasks'),state=funded().E.snapshot();state.merchantIntros={zeon:true};
 state.contactTasks=C.tasks.filter(t=>t.contactId==='zeon'&&t.number<5).map(t=>({id:t.id,status:'claimed',progress:t.required}));
 const {E}=load(state);E.creditActivity({id:'owned-gouf',matchId:'owned-gouf',money:0,supplies:0,inventory:{MS_11S:1}});
 const owned=E.snapshot().storage.units.find(u=>u.unitId==='MS_11S').id;
 E.acceptContactTask('zeon-5');const next=E.snapshot(),loan=next.storage.units.find(u=>u.contactLoan==='zeon-5');assert(loan);
 assert.throws(()=>E.discardStoredUnit(loan.id),/任务借用/);
 assert.throws(()=>E.setStoredPlugin(loan.id,0,'frame'),/任务临时单位不能装备零件/);
 loan.pilotId='custom-zeon-trial';loan.plugins=['frame'];next.pluginInventory.frame=1;
 const restored=load(next).E;
 restored.creditAward({id:'return-gouf',matchId:'return-gouf',money:0,supplies:0,contactProgress:[{id:'zeon-5',amount:4}]});
 assert(restored.snapshot().storage.units.some(u=>u.id===owned));
 assert(!restored.snapshot().storage.units.some(u=>u.contactLoan==='zeon-5'||u.pilotId==='custom-zeon-trial'));
 assert.equal(restored.pluginQuantity('frame'),1);assert.equal(restored.quantity('MS_11S'),1);
});

test("existing tagged trial Gouf migrates to the command Zaku without replacing owned units",()=>{
 const state=funded().E.snapshot();state.merchantIntros={zeon:true};
 state.contactTasks=[{id:'zeon-5',status:'accepted',progress:2,loanTracking:true}];
 const prefab=G.catalog.prefabs.find(p=>p.id==='MS_07B3'),kitId=prefab.weaponKits[0].id;
 const model=G.models['MS_07B3__'+kitId];
 state.inventory={MS_07B3:2};
 state.storage.units=[
  {id:'old-trial',unitId:'MS_07B3',kitId,hp:model.hp,en:model.en,contactLoan:'zeon-5'},
  {id:'owned-gouf',unitId:'MS_07B3',kitId,hp:model.hp,en:model.en}
 ];
 const {E}=load(state),units=E.snapshot().storage.units;
 assert.equal(units.find(u=>u.id==='old-trial').unitId,'MS_11S');
 assert.equal(units.find(u=>u.id==='owned-gouf').unitId,'MS_07B3');
 assert.equal(E.snapshot().contactTasks.find(t=>t.id==='zeon-5').progress,2);
 assert.equal(require('../shared/contact-tasks').byId.get('zeon-10').required,50);
});

test("Zeon planning JSON keeps all runtime dialogue, dependency IDs and the supplied portrait",()=>{
 const Z=require('../shared/contact-zeon'),M=require('../task-editor/model');
 const doc=JSON.parse(fs.readFileSync('docs/data/contacts/zeon-吉翁联络人-1.0.json','utf8'));
 assert.deepEqual(M.validate(doc,require('../task-editor/catalog.cjs')),[]);
 const contact=doc.contacts[0];assert.equal(contact.id,'zeon');assert.equal(contact.tasks.length,11);
 for(const task of Z.tasks){const entry=contact.tasks.find(e=>e.id===task.id);assert(entry.text.includes(task.description));assert(entry.text.includes(task.ending));assert.deepEqual(entry.requires,task.requires);}
 assert.deepEqual(Buffer.from(contact.portrait.dataUrl.split(',')[1],'base64'),fs.readFileSync('assets/ui/contact-zeon.png'));
});

test("Peace Statistics resets obsolete kill progress but preserves new squad completion and claimed rewards",()=>{
 const C=require('../shared/contact-tasks');
 const old=C.normalize([{id:'zeon-8',status:'ready',progress:50}])[0];
 assert.deepEqual(old,{id:'zeon-8',status:'accepted',progress:0,progressVersion:2});
 assert.equal(C.normalize([{...old,status:'ready',progress:1}])[0].status,'ready');
 assert.equal(C.normalize([{id:'zeon-8',status:'claimed',progress:50}])[0].status,'claimed');
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
test("twelve commissions follow dependencies, commit rewards once and retain Green Corridor facility unlocks",()=>{
 const {E}=funded();E.meetLiaison();
 assert.throws(()=>E.acceptContactTask("efsf-2"));
 const Contact=require('../shared/contact-tasks');let earned=0;
 for(const task of Contact.tasks.filter(task=>(task.contactId||'efsf')==='efsf')){
  assert(E.acceptContactTask(task.id));
  assert.throws(()=>E.acceptContactTask(task.id));assert.throws(()=>E.completeContactTask(task.id));
  if(task.id==='efsf-5')assert(E.snapshot().storage.units.some(u=>u.unitId==='RX_80PR'));
  const receipt={id:'progress-'+task.id,matchId:'battle-'+task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:task.required}]};
  assert(E.creditAward(receipt));assert.equal(E.creditAward(receipt),false);
  assert.equal(load(E.snapshot()).E.snapshot().contactTasks.find(e=>e.id===task.id).status,'ready');
  const before=E.snapshot().money;assert(E.completeContactTask(task.id));earned+=task.money;
  assert.equal(E.snapshot().money,before+task.money);assert.throws(()=>E.completeContactTask(task.id));
 }
 assert.equal(E.liaisonAffinity(),1200);assert(E.hasLicense('RX_79_G'));assert(E.hasLicense('RX_78_2'));assert(E.hasLicense('RX_77_3'));
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
 const {E}=load(initial);assert.equal(C.planningVersion,'1.3');assert.equal(C.tasks.filter(t=>(t.contactId||'efsf')==='efsf').length,12);
 assert(E.acceptContactTask('efsf-8'));assert(E.acceptContactTask('efsf-7'));
 assert.throws(()=>E.acceptContactTask('efsf-9'));
 assert(C.eligible(C.byId.get('efsf-7'),{mode:'sweep',sweepFaction:'EFSF',sweepDifficulty:3,sweepEnvironment:'ground'}));
 assert(!C.eligible(C.byId.get('efsf-7'),{mode:'sweep',sweepFaction:'ZEON',sweepDifficulty:3,sweepEnvironment:'ground'}));
 for(const difficulty of [4,5,6])assert.doesNotThrow(()=>G.validateOpenContent({mode:'sweep',sweepDifficulty:difficulty,sweepEra:'UC_0079_T1'}));
 for(const difficulty of [7,8,9])assert.throws(()=>G.validateOpenContent({mode:'sweep',sweepDifficulty:difficulty,sweepEra:'UC_0079_T1'}));
});

test("mainline technology missions include their prerequisite chain and locked tasks explain unclaimed requirements",()=>{
 const C=require('../shared/contact-tasks');
 assert.deepEqual(C.tasks.filter(t=>(t.contactId||'efsf')==='efsf').filter(C.isSideTask).map(t=>t.id),['efsf-7','efsf-10','efsf-12']);
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

test("planning JSON 1.3 preserves runtime IDs and dependencies alongside future drafts",()=>{
 const C=require('../shared/contact-tasks'),M=require('../task-editor/model');
 const plan=JSON.parse(fs.readFileSync('docs/data/contacts/efsf-联邦联络人-1.3.json','utf8'));
 assert.equal(plan.systemVersion,C.planningVersion);
 assert.deepEqual(M.validate(plan,plan.aiGuide.statusMeanings),[]);
 const federal=C.tasks.filter(t=>(t.contactId||'efsf')==='efsf');
 assert.deepEqual(plan.contacts[0].tasks.filter(t=>C.byId.has(t.id)).map(t=>t.id),federal.map(t=>t.id));
 for(const task of federal)assert.deepEqual(plan.contacts[0].tasks.find(t=>t.id===task.id).requires,task.requires);
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
