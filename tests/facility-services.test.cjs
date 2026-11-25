const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const G=require('../shared/rules'),P=require('../shared/pilots'),C=require('../shared/contract-mode'),Tasks=require('../shared/contact-tasks');
const pilotKey='projectgreed.custom-pilots.v3.shared';
function load(saved,store){
 const data=new Map();if(saved)data.set('projectgreed.economy.v1',require('../shared/save-codec').stringify(saved));if(store)data.set(pilotKey,JSON.stringify(store));let failKey=null;
 const ctx=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,crypto:require('node:crypto').webcrypto,ART:G.catalog,
 localStorage:{getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k),setItem:(k,v)=>{if(k===failKey)throw Error('write failed');data.set(k,v);}}});
 vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);return {E:ctx.module.exports,data,fail:k=>failKey=k};
}
test('all difficulties add one fleet slot, academy caps and level-four reincarnation apply',()=>{
 assert.deepEqual([1,2,3,4,5,6].map(n=>G.fleetLimit({mode:'sweep',sweepDifficulty:n})),[3,3,3,4,4,4]);
 const p=P.custom({...P.createCustom('custom-caps','驾驶员'),reincarnations:4,level:0});
 assert.deepEqual([1,2,3,4,5].map(n=>P.maxLevel(p,n)),[4,6,8,10,12]);
 const veteran=P.custom({...P.createCustom('custom-rebirth','驾驶员'),level:8});assert(!P.canReincarnate(veteran,3));assert(P.canReincarnate(veteran,4));
});
test('HQ two opens beacon two with its own funds and supplies gate',()=>{
 const {E}=load(),s=E.snapshot();assert(!E.facilityUpgradeOffer('beacon').available);
 s.baseFacilities.levels.hq=2;s.money=s.supplies=50000;const unlocked=load(s).E,offer=unlocked.facilityUpgradeOffer('beacon');
 assert(offer.available);assert.equal(offer.money,10000);unlocked.upgradeFacility('beacon',offer);assert(unlocked.canRecruitCrew('ace'));assert.equal(unlocked.snapshot().supplies,40000);assert(!unlocked.facilityUpgradeOffer('beacon').available);
});
test('expanded facility capacities survive economy validation at all five levels',()=>{
 const s=load().E.snapshot();
 for(let n=1;n<=5;n++){
  Object.assign(s.baseFacilities.levels,{hq:n,factory:n,giantFactory:n,academy:n});
  const E=load(s).E;assert.equal(E.storageIssue(),null);assert.equal(E.snapshot().storage.slots.units,10+n*20);assert.equal(E.snapshot().storage.slots.ships,4+n*8);assert.equal(E.customPilotLimit(),10+n*20);
 }
});
test('batch depot removal preserves permanent stock and stale confirmation cannot delete new arrivals',()=>{
 const {E}=load();E.creditActivity({id:'depot',matchId:'depot',money:0,supplies:0,inventory:{RGM_79:3}});const s=E.snapshot();s.storage.deliveries[0].rentalUses=20;s.storage.deliveries[1].rentalUses=3;
 const x=load(s),before=x.E.snapshot().storage.deliveries;assert.throws(()=>x.E.discardRentalDeliveries(before.slice(1)),/已变化/);
 x.E.discardRentalDeliveries(before);assert.equal(x.E.snapshot().storage.deliveries.length,1);assert(!x.E.snapshot().storage.deliveries[0].rentalUses);assert.equal(x.E.snapshot().storage.units.length,s.storage.units.length);
});
test('gacha rental durations migrate once in reward definitions and preserve grade weights',()=>{
 const pools=require('../shared/supply-pools.json');for(const pool of pools){assert.equal(pool.grades.reduce((n,g)=>n+g.weight,0),100);for(const grade of pool.grades)for(const reward of grade.rewards)if(reward.kind==='rental')assert([1,3,5].includes(reward.uses));}
 assert.equal(pools.find(p=>p.id==='gundam-04-05').grades[0].rewards.find(r=>r.kind==='rental').uses,3);
});
test('N6 all-event commission requires completion before extraction and the correct participant',()=>{
 const task=Tasks.byId.get('anaheim-11'),actor={id:'a',ownerSeat:0,hp:1,contractExtracted:true};
 const room={settings:{mode:'sweep',sweepFaction:'NONE',sweepEra:'UC_0079_T1',sweepDifficulty:6,sweepEnvironment:'ground'},game:{units:[actor],contract:{commissions:{p:[task.id]},objectives:[{status:'completed'},{status:'completed'}]}}};
 const p={id:'p',seat:0};assert.equal(C.commissionProgress(room,G,p).length,0);actor.contractAllEventsAtExtraction=true;assert.equal(C.commissionProgress(room,G,p)[0].amount,1);
 room.game.contract.objectives[1].status='failed';assert.equal(C.commissionProgress(room,G,p).length,0);room.game.contract.objectives[1].status='completed';actor.ownerSeat=2;assert.equal(C.commissionProgress(room,G,p).length,0);
 room.settings.sweepDifficulty=5;actor.ownerSeat=0;assert.equal(C.commissionProgress(room,G,p).length,0);
 for(const faction of ['EFSF','ZEON','NONE','OMNI','ZAFT'])assert(Tasks.eligible(task,{mode:'sweep',sweepDifficulty:6,sweepFaction:faction,sweepEra:'CE_0071_T1',sweepEnvironment:'ground'}));
});
test('talent reset requires delivered commission and atomically spends supplies while retaining growth',()=>{
 const pilot=P.custom({...P.createCustom('custom-reroll','驾驶员'),level:4}),store={pilots:[pilot],awards:[]};const s=load().E.snapshot();s.supplies=20000;
 assert.throws(()=>load(s,store).E.resetPilotTalents(pilot.id,JSON.stringify(pilot)),/交付/);
 s.contactTasks=[{id:'anaheim-11',status:'claimed',progress:1}];const x=load(s,store),result=x.E.resetPilotTalents(pilot.id,JSON.stringify(pilot));
 assert(result);assert.equal(x.E.snapshot().supplies,16000);assert.equal(result.pilot.level,4);assert.equal(result.pilot.talents.length,pilot.talents.length);assert(result.pilot.talents.every(t=>!pilot.talents.includes(t)));assert.deepEqual(JSON.parse(JSON.stringify(result.pilot.stats)),pilot.stats);
 assert.equal(JSON.parse(x.data.get(pilotKey)).pilots[0].talents[0],result.pilot.talents[0]);assert.throws(()=>x.E.resetPilotTalents(pilot.id,JSON.stringify(pilot)),/已变化/);
 const y=load(s,store),before=JSON.stringify(y.E.snapshot()),persisted=y.data.get(pilotKey);y.fail(pilotKey);assert.throws(()=>y.E.resetPilotTalents(pilot.id,JSON.stringify(pilot)),/write failed/);assert.equal(JSON.stringify(y.E.snapshot()),before);assert.equal(y.data.get(pilotKey),persisted);
});
