const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const G=require('../shared/rules'),C=require('../shared/contact-tasks'),K=require('../shared/contract-mode'),P=require('../shared/unit-plugins'),codec=require('../shared/save-codec'),{createRoomEngine}=require('../shared/room-engine');
function economy(saved){const data=new Map(saved?[['projectgreed.economy.v1',codec.stringify(saved)]]:[]),ctx=vm.createContext({require:require('module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);return ctx.module.exports;}
function finish(E,t){E.acceptContactTask(t.id);const id='t2-'+t.id;E.creditAward({id,matchId:id,money:0,supplies:0,contactProgress:[{id:t.id,amount:t.required}]});E.completeContactTask(t.id);}
test('Zeon T2 covers all ten technology plans and persists one-time rewards and returned loans',()=>{
 let E=economy();E.meetLiaison('zeon');const line=C.tasks.filter(t=>t.contactId==='zeon');
 assert.equal(line.length,21);assert.deepEqual(line.slice(11).map(t=>t.difficulty),[3,3,3,4,4,4,5,5,6,6]);
 for(const t of line){finish(E,t);const before=E.snapshot().money;assert.throws(()=>E.completeContactTask(t.id));E=economy(E.snapshot());assert.equal(E.snapshot().money,before);}
 assert(C.available(E.snapshot(),'anaheim'));
 const unlocked=new Set(line.flatMap(C.planIds));
 for(const plan of require('../shared/development-tree.json').ZEON.filter(n=>n.era==='UC_0079_T2')){
  assert(unlocked.has(plan.id),plan.id);for(const id of plan.unlocks||[])if(Object.values(G.models).some(m=>m.prefabId===id))assert(E.hasLicense(id),id);
 }
 for(const id of ['zeon-13','zeon-16'])assert(E.snapshot().contactTasks.find(t=>t.id===id).loanReturned);
});
test('Anaheim finale opens T2 purchases at every merchant, reaches level 3, and persists inventory',()=>{
 let E=economy();const s=E.snapshot();s.merchantIntros.anaheim=true;s.contactIntro=true;s.merchantIntros.zeon=true;s.contactAffinity=800;s.merchantAffinities.zeon=800;s.money=2000000;E=economy(s);
 for(const p of P.catalog.filter(p=>p.era==='UC_0079_T2')){assert(!E.pluginOffer(p.merchant,p.id).available);assert.throws(()=>E.purchasePlugin(p.merchant,p.id));}
 const ids=['anaheim-1','anaheim-2','anaheim-3','anaheim-4','anaheim-5','anaheim-6','anaheim-8','anaheim-7','anaheim-9','anaheim-10'];
 for(const id of ids)finish(E,C.byId.get(id));
 assert(!E.pluginOffer('anaheim','weapon_rack').available);
 const final=C.byId.get('anaheim-12');E.acceptContactTask(final.id);E.creditAward({id:'final',matchId:'final',money:0,supplies:0,contactProgress:[{id:final.id,amount:1}]});
 assert(!E.pluginOffer('anaheim','weapon_rack').available);E.completeContactTask(final.id);E=economy(E.snapshot());assert.equal(E.merchantLevel('anaheim'),3);
 for(const p of P.catalog.filter(p=>p.era==='UC_0079_T2')){assert(E.pluginOffer(p.merchant,p.id).available,p.id);E.purchasePlugin(p.merchant,p.id);}
 E=economy(E.snapshot());for(const p of P.catalog.filter(p=>p.era==='UC_0079_T2'))assert.equal(E.pluginQuantity(p.id),1,p.id);
 for(const p of P.catalog.filter(p=>!['UC_0079_T1','UC_0079_T2'].includes(p.era)))assert.equal(E.pluginOffer(p.merchant,p.id),null);
});
test('every new T2 event can enter the real room engine with valid native units and correct faction',t=>{
 for(const task of C.tasks.filter(t=>(t.contactId==='zeon'&&t.era==='UC_0079_T2')||['anaheim-7','anaheim-12'].includes(t.id))){
  let serial=0;const errors=[];const engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>1936384585,aiDelayMs:999999,send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});t.after(()=>engine.close());
  const ws={readyState:1},unitId=task.environment==='space'?'ColumbusClass':'Medea',model=G.models[unitId+'__standard'];
  engine.join(ws,{mode:'create',room:'T2',roomMode:'sweep',characterFaction:'PMC',contactTasks:[{id:task.id,status:'accepted',progressVersion:task.progressVersion}],inventory:{[unitId]:1},licenses:{[unitId]:true},storedUnits:[{id:'stock',unitId,kitId:'standard',hp:model.hp,en:model.en}]});
  const room=engine.rooms.get('T2'),act=(action,fields={})=>engine.action(ws,{id:'req'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
  act('configure_room',{...room.settings,sweepEra:task.era,sweepEnvironment:task.environment||'ground',sweepDifficulty:task.difficulty,sweepFaction:task.enemyFaction,sweepAlliedFaction:task.enemyFaction==='NONE'?'NONE':'ZEON'});
  act('start_game',{formation:[{unitId,kitId:'standard',stockId:'stock'}]});act('confirm_formation');assert.equal(room.phase,'deployment',task.id+errors.join('\n'));assert.deepEqual(errors,[]);
  if(task.kind!=='kills')assert(room.game.contract.objectives.some(o=>o.contactTaskId===task.id),task.id);
  assert(C.eligible(task,room.settings));assert(!C.eligible(task,{...room.settings,sweepEra:'UC_0079_T1'}));
 }
});
