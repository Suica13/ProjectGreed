const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../shared/pilots'),C=require('../shared/contact-tasks'),tree=require('../shared/development-tree.json'),codec=require('../shared/save-codec');
function context(saved){const data=new Map(saved?[['projectgreed.economy.v1',codec.stringify(saved)]]:[]);const ctx=vm.createContext({module:{exports:{}},require:require('node:module').createRequire(path.resolve('shared/economy.js')),structuredClone,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);const E=ctx.module.exports;ctx.module={exports:{}};vm.runInContext(fs.readFileSync('shared/development.js','utf8'),ctx);return {E,D:ctx.module.exports};}
test('all priced ACE offers triple both currencies, while recovery stays level times 1000',()=>{
 for(const raw of P.catalog.aces){const source=P.aceProfile(raw.id);if(!source.price)continue;
  assert.deepEqual(P.recruitmentPrice(raw.id),{money:source.price.money*3,supplies:source.price.supplies*3});
  for(let level=0;level<=5;level++){const p=P.custom({...P.createAce(raw.id),level,stats:undefined,needsRecruitment:true});assert.deepEqual(P.recruitmentPrice(raw.id,p),{money:0,supplies:level*1000});assert.equal(P.revive(p).level,level);}
 }
 assert.deepEqual(P.recruitmentPrice('Pilot_ZEON_0079_N_ACE_HRD'),{money:15000,supplies:7500});
 assert.equal(P.catalog.aces.find(p=>p.id.endsWith('_HRD')).price,null);
});
test('claimed task permits unlock associated ACE in existing saves, never unrelated tech or other factions',()=>{
 const fresh=context(),saved=fresh.E.snapshot();
 const id='Pilot_EFSF_0079_N_ACE_YDR';assert(!fresh.D.allows('PMC',id));
 saved.contactTasks=C.tasks.map(t=>({id:t.id,status:'claimed',progress:t.required,progressVersion:t.progressVersion}));
 const {E,D}=context(saved);let count=0;
 for(const task of C.tasks)for(const plan of C.planIds(task)){
  assert(E.hasTechnologyPlan(plan));
  const node=Object.values(tree).flat().find(n=>n.id===plan);
  for(const id of node.unlocks.filter(id=>P.aceProfile(id))){const p=P.aceProfile(id);assert(D.allows('PMC',id),id);assert(D.allows(p.faction,id),id);assert(P.recruitmentPrice(id),id);count++;}
 }
 assert(count>10);assert(!D.allows('ZEON',id));
 assert(!E.hasTechnologyPlan('missing-plan'));
 const accepted={...saved,contactTasks:[{id:'efsf-2',status:'accepted',progress:0}]};assert(!context(accepted).D.allows('PMC',id));
});
