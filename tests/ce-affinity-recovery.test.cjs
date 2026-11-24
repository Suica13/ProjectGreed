const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules'),codec=require('../shared/save-codec');
function economy(saved){
 const data=new Map(saved?[['projectgreed.economy.v1',codec.stringify(saved)]]:[]);
 const context=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,
  localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
 vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),context);return context.module.exports;
}
test('missing and reset CE affinity recovers from claimed tasks without duplicating other rewards',()=>{
 for(const points of [undefined,0,50]){
  const saved=economy().snapshot();saved.contactTasks=[{id:'omni-1',status:'claimed'},{id:'omni-2',status:'claimed'},{id:'omni-3',status:'ready'},{id:'zaft-1',status:'claimed'},{id:'zaft-2',status:'accepted'}];
  saved.merchantAffinities=points===undefined?{}:{omni:points,zaft:points};
  const e=economy(saved);assert.equal(e.storageIssue(),null);assert.equal(e.merchantAffinity('omni'),200);assert.equal(e.merchantAffinity('zaft'),100);
  assert.equal(e.snapshot().money,saved.money);assert.equal(e.snapshot().supplies,saved.supplies);
  assert.deepEqual(e.snapshot().licenses,saved.licenses);
  e.creditActivity({id:'affinity-save-'+String(points),matchId:'affinity-save',money:25,supplies:0,inventory:{}});
  const reloaded=economy(e.snapshot());assert.equal(reloaded.merchantAffinity('omni'),200);assert.equal(reloaded.merchantAffinity('zaft'),100);
 }
});
test('CE affinity preserves larger existing balances and never rewards accepted or ready commissions',()=>{
 const saved=economy().snapshot();saved.merchantAffinities={omni:950,zaft:0};saved.contactTasks=[{id:'omni-1',status:'claimed'},{id:'zaft-1',status:'ready'}];
 let e=economy(saved);assert.equal(e.merchantAffinity('omni'),950);assert.equal(e.merchantAffinity('zaft'),0);
 for(let i=0;i<3;i++){e=economy(e.snapshot());assert.equal(e.merchantAffinity('omni'),950);}
});
test('each CE hand-in adds affinity once and survives reload plus unrelated wallet writes',()=>{
 for(const id of ['omni','zaft']){
  const saved=economy().snapshot();saved.contactTasks=[{id:'efsf-11',status:'claimed'}];let e=economy(saved);
  e.meetLiaison(id);e.acceptContactTask(id+'-1');e.creditAward({id:id+'-proof',matchId:id+'-proof',money:0,supplies:0,contactProgress:[{id:id+'-1',amount:12}]});
  e.completeContactTask(id+'-1');assert.equal(e.merchantAffinity(id),100);
  assert.throws(()=>e.completeContactTask(id+'-1'));
  e=economy(e.snapshot());assert.equal(e.merchantAffinity(id),100);
 }
});
