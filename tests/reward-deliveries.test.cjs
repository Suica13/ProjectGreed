const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules'),codec=require('../shared/save-codec'),C=require('../shared/contact-tasks');
function load(saved){
 const data=new Map(saved?[['projectgreed.economy.v1',codec.stringify(saved)]]:[]);
 const ctx=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,
  localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
 vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);return {E:ctx.module.exports,ctx};
}
test('activity permanent and rental MS/ships wait in deliveries even when the hangar is empty',()=>{
 const {E}=load(),before=E.snapshot();const reward={id:'activity-units',matchId:'activity-units',money:25,supplies:50,inventory:{RGM_79:2,Medea:1},rentals:[{unitId:'RGM_79',count:1,uses:20,plugins:['frame']}]};
 assert(E.creditActivity(reward));const next=E.snapshot();
 assert.deepEqual(next.inventory,before.inventory);assert.equal(next.storage.units.length,before.storage.units.length);assert.equal(next.storage.ships.length,before.storage.ships.length);
 assert.equal(next.storage.deliveries.length,4);assert.equal(next.storage.deliveries.at(-1).rentalUses,20);assert.deepEqual(next.storage.deliveries.at(-1).plugins.filter(Boolean),['frame']);
 assert.equal(E.creditActivity(reward),false);assert.equal(load(next).E.snapshot().storage.deliveries.length,4);
 E.receiveDeliveries();assert.equal(E.snapshot().storage.deliveries.length,0);assert.equal(E.snapshot().inventory.RGM_79,(before.inventory.RGM_79||0)+3);
});
test('mission settlement and contact hand-ins queue units and retain receipt protection',()=>{
 const {E}=load(),before=E.snapshot(),award={id:'mission-units',matchId:'mission-units',kind:'result',money:0,supplies:0,stockGained:{inventory:{RGM_79:2}}};
 assert(E.creditAward(award));assert.equal(E.creditAward(award),false);assert.equal(E.snapshot().storage.deliveries.length,2);assert.deepEqual(E.snapshot().inventory,before.inventory);
 const task=C.tasks.find(t=>Object.values(t.inventory).some(n=>n>0));assert(task);
 const saved=E.snapshot();saved.contactTasks=[{id:task.id,status:'ready',progress:task.required}];
 const reloaded=load(saved).E;reloaded.completeContactTask(task.id);const after=reloaded.snapshot();
 assert.equal(after.storage.deliveries.length,2+Object.values(task.inventory).reduce((a,b)=>a+b,0));assert.deepEqual(after.inventory,before.inventory);
 assert.throws(()=>reloaded.completeContactTask(task.id));
});
test('failed persistence rolls back rewards and receipt so retry can succeed',()=>{
 const {E,ctx}=load(),before=E.snapshot(),award={id:'retry-units',matchId:'retry-units',money:25,supplies:0,inventory:{RGM_79:1}};
 const write=ctx.localStorage.setItem;ctx.localStorage.setItem=()=>{throw Error('save failed');};
 assert.throws(()=>E.creditActivity(award),/save failed/);assert.deepEqual(E.snapshot(),before);
 ctx.localStorage.setItem=write;assert(E.creditActivity(award));assert.equal(E.snapshot().storage.deliveries.length,1);
});
test('capacity rejects a whole reward without spending its receipt, then accepts it after freeing space',()=>{
 const {E}=load();E.creditActivity({id:'fill',matchId:'fill',money:0,supplies:0,inventory:{RGM_79:200}});
 const before=E.snapshot(),award={id:'full-gift',matchId:'full-gift',money:25,supplies:0,inventory:{RGM_79:1}};
 assert.throws(()=>E.creditActivity(award),/200/);assert.deepEqual(E.snapshot(),before);
 E.receiveDeliveries(0);assert(E.creditActivity(award));assert.equal(E.snapshot().storage.deliveries.length,200);
});
