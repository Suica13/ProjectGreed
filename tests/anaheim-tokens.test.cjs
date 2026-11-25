const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules'),Tasks=require('../shared/contact-tasks');
const tasks=Tasks.tasks.filter(t=>t.tokenUnlock),prices={'0079t1-token':10000,'thunderbolt-token':30000,'celestial-being-token':30000};
function load(saved){
 const data=new Map(saved?[['projectgreed.economy.v1',require('../shared/save-codec').stringify(saved)]]:[]);let failing=false;
 const ctx=vm.createContext({module:{exports:{}},require:require('node:module').createRequire(path.resolve('shared/economy.js')),structuredClone,ART:G.catalog,
 localStorage:{getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k),setItem:(k,v)=>{if(failing)throw Error('write failed');data.set(k,v);}}});
 vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);return {E:ctx.module.exports,data,fail:()=>failing=true};
}
test('three independent N5 procurement commissions require 0079T1 armed intervention and extraction',()=>{
 assert.equal(tasks.length,3);
 for(const task of tasks){
  assert.deepEqual(task.requires,[]);assert.equal(task.requiresExtraction,true);assert.equal(task.tokenPrice,prices[task.tokenUnlock]);
  const settings={mode:'sweep',sweepDifficulty:5,sweepEra:'UC_0079_T1',sweepEnvironment:'ground',sweepFaction:'NONE'};
  assert(Tasks.eligible(task,settings));
  for(const invalid of [{sweepDifficulty:4},{sweepEra:'UC_0079_T2'},{sweepFaction:'EFSF'},{sweepEnvironment:'space'}])assert(!Tasks.eligible(task,{...settings,...invalid}));
 }
 const {E}=load();E.meetLiaison('anaheim');for(const task of tasks)E.acceptContactTask(task.id);assert.equal(E.snapshot().contactTasks.length,3);
});
test('each delivered task unlocks only its own token, with exact funds cost and persistent item stock',()=>{
 const {E}=load();E.creditActivity({id:'funds',matchId:'funds',money:200000,supplies:0,inventory:{}});E.meetLiaison('anaheim');
 for(const task of tasks){
  assert.equal(E.tokenOffer('anaheim',task.tokenUnlock).available,false);assert.throws(()=>E.purchaseToken('anaheim',task.tokenUnlock),/前提任务/);
  E.acceptContactTask(task.id);E.creditAward({id:task.id,matchId:task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:1}]});
  assert.equal(E.tokenOffer('anaheim',task.tokenUnlock).available,false);E.completeContactTask(task.id);
  const before=E.snapshot();assert.equal(E.purchaseToken('anaheim',task.tokenUnlock),true);const after=E.snapshot();
  assert.equal(after.money,before.money-prices[task.tokenUnlock]);assert.equal(after.supplies,before.supplies);assert.equal(after.itemInventory[task.tokenUnlock],(before.itemInventory[task.tokenUnlock]||0)+1);
  assert.equal(load(after).E.snapshot().itemInventory[task.tokenUnlock],after.itemInventory[task.tokenUnlock]);
 }
 for(const id of ['efsf','zeon','fake'])assert.equal(E.tokenOffer(id,'0079t1-token'),null);
 assert.throws(()=>E.purchaseToken('anaheim','fake'),/不存在/);
});
test('failed or unaffordable purchases and capped token inventory never consume funds',()=>{
 const task=tasks[0],s=load().E.snapshot();s.contactTasks=[{id:task.id,status:'claimed',progress:1}];s.money=50000;
 const x=load(s),before=JSON.stringify(x.E.snapshot()),persisted=x.data.get(x.E.key);x.fail();assert.throws(()=>x.E.purchaseToken('anaheim',task.tokenUnlock),/write failed/);assert.equal(JSON.stringify(x.E.snapshot()),before);assert.equal(x.data.get(x.E.key),persisted);
 s.money=0;const poor=load(s).E;assert.equal(poor.purchaseToken('anaheim',task.tokenUnlock),false);assert.equal(poor.snapshot().itemInventory[task.tokenUnlock]||0,0);
 s.money=50000;s.itemInventory[task.tokenUnlock]=1000000;const full=load(s).E;assert.throws(()=>full.purchaseToken('anaheim',task.tokenUnlock),/上限/);assert.equal(full.snapshot().money,50000);
});
