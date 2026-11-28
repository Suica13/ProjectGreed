const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules'),M=require('../shared/mission-mode'),C=require('../shared/contact-tasks'),codec=require('../shared/save-codec');
const tasks=C.tasks.filter(t=>t.contactId==='efsf');
test('T2 tasks rise from N3 to N6 and special-stage budgets match their tier',()=>{
 assert.deepEqual(tasks.filter(t=>t.number>=16).map(t=>t.difficulty),[3,3,3,4,4,4,5,5,5,5,6,6,6,6]);
 for(const t of tasks.filter(t=>t.number>=16&&!t.missionId)){
  const settings={mode:'sweep',sweepEra:t.era,sweepEnvironment:t.environment||'ground',sweepFaction:t.enemyFaction,sweepDifficulty:t.difficulty};
  assert(C.eligible(t,settings),t.id);assert(!C.eligible(t,{...settings,sweepDifficulty:t.difficulty-1}),t.id);
 }
 assert.equal(M.settings(G,'mission_efsf_19').costLimit,13500);
 assert.equal(M.settings(G,'mission_efsf_29').costLimit,22500);
 const t=C.byId.get('efsf-20');assert.equal(t.kind,'kills');assert.equal(t.required,60);assert.equal(t.targetCount,undefined);
 for(const status of ['ready','claimed']){const [entry]=C.normalize([{id:t.id,status,progress:1,progressVersion:3}]);assert.equal(entry.status,status);assert.equal(entry.progress,60);}
 const [entry]=C.normalize([{id:t.id,status:'accepted',progress:0,progressVersion:3}]);assert.equal(entry.status,'accepted');assert.equal(entry.progress,0);
});
function fixture(n){
 const task=tasks[n-1],settings=M.settings(G,task.missionId),host={id:'host',seat:0,contactTasks:[{id:task.id,status:'accepted',progressVersion:2}],ws:{readyState:1}},enemy={id:'enemy',seat:1,bot:true};
 const game=G.create(false,33,Array.from({length:10},(_,i)=>i===0?[{unitId:G.getMap(task.missionId).environment==='space'?'ColumbusClass':'Medea',kitId:'standard'}]:null),false,settings);
 const room={game,settings,seats:[host,enemy],members:new Map([['host',host]]),hostId:'host',started:true,phase:'idle',missionAllySeat:10};
 M.initialize(room,G);game.units[0].deployed=true;delete game.units[0].deploymentStaged;game.winner=null;
 return {room,task,host,player:game.units[0],state:game.mission.commission,poll:()=>M.poll(room,G,()=>{})};
}

test('29 original-text tasks cover both technology tiers; only two special stages use mission mode',()=>{
 assert.equal(tasks.length,29);assert.deepEqual(tasks.filter(t=>t.missionId).map(t=>t.number),[19,29]);
 const ids=new Set([C.introPlan('efsf'),...tasks.flatMap(C.planIds)]);
 for(const node of require('../shared/development-tree.json').EFSF.filter(n=>['UC_0079_T1','UC_0079_T2'].includes(n.era)))assert(ids.has(node.id),node.id);
 for(const t of tasks.filter(t=>t.missionId)){const map=G.getMap(t.missionId);M.validate(map.mission,map,G);assert(!M.commissions.unlocked(map,[]));assert(M.commissions.unlocked(map,[{id:t.id,status:'accepted'}]));const {room}=fixture(t.number);assert.deepEqual(M.reward({...room,game:{...room.game,winner:0}},G),{money:0,supplies:0,inventory:{}});assert.equal(M.technologyReward(room,G),0);}
 for(const map of Object.values(G.catalog.maps).filter(m=>m.mission&&!m.mission.contactTask))assert(!M.commissions.visible(map));
});
test('colony objective needs cleared guards and all three points; deadlines override completion',()=>{
 const f=fixture(29),c=G.getMap(f.task.missionId).mission.commission;
 Object.assign(f.player,{x:c.nodes[0].x,y:c.nodes[0].y});M.commissions.poll(f.room,G);assert.equal(f.state.visited.length,0);
 for(const u of f.room.game.units.filter(u=>u.missionGroup==='targets'))u.hp=0;
 for(const node of c.nodes){Object.assign(f.player,{x:node.x,y:node.y});M.commissions.progress(f.room,G);assert(!f.state.visited.includes(node.id));M.commissions.poll(f.room,G);assert(f.state.visited.includes(node.id));}
 assert.equal(f.room.game.mission.requestedWinner,0);f.room.game.round=25;M.commissions.poll(f.room,G);assert.equal(f.room.game.mission.requestedWinner,1);
 f.room.game.winner=1;assert.deepEqual(M.commissions.commissionProgress(f.room,G,f.host),[]);f.room.game.winner=0;assert.equal(M.commissions.commissionProgress(f.room,G,f.host)[0].id,'efsf-29');assert.deepEqual(M.commissions.commissionProgress(f.room,G,{id:'observer',seat:null}),[]);
});
function economy(saved){const data=new Map(saved?[['projectgreed.economy.v1',codec.stringify(saved)]]:[]),ctx=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);return ctx.module.exports;}
test('both fleet battles reinforce independently on casualties, cap five waves and keep unique MA',()=>{
 for(const n of [19,29]){
  const f=fixture(n),map=G.getMap(f.task.missionId),m=map.mission;f.room.phase='idle';
  assert.equal(map.width,n===19?44:64);assert.equal(map.height,n===19?64:44);
  assert.equal(m.actors.filter(a=>a.team===1).length,198);assert.equal(m.actors.filter(a=>a.team===0).length,132);
  assert.equal(m.actors.filter(a=>a.team===1&&G.models[a.unitId+'__'+a.kitId].unitTags.includes('Ship')).length,16);
  const initial=f.room.game.units.filter(u=>u.missionActor);assert.equal(initial.filter(u=>u.team===0).length,22);assert.equal(initial.filter(u=>u.team===1).length,33);
  for(const u of initial.filter(u=>u.team===0)){assert(u.missionAutonomous);assert.equal(G.ownerOf(u),10);assert(!G.canControlUnit({...f.room.settings,shareAlliedUnits:true},[{seat:0}],0,u));}
  f.poll();assert(f.room.game.mission.dialogue?.lines.length>=3);assert(f.room.game.mission.dialogue.lines.every(l=>l.focus));
  while(f.room.game.mission.dialogue){const d=f.room.game.mission.dialogue;M.advance(f.room,G,d.id,d.index,()=>{});}f.poll();
  for(let wave=1;wave<=5;wave++)for(const team of [1,0]){
   const group=team===1&&wave===1?'targets':(team?'enemy':'allied')+'-wave-'+(wave-1),count=team?17:12;
   const victims=f.room.game.units.filter(u=>u.missionGroup===group&&!m.protect.includes(u.missionActor));
   const before=f.room.game.units.length;for(const u of victims.slice(0,count-1))u.hp=0;f.poll();assert.equal(f.room.game.units.length,before);
   victims[count-1].hp=0;f.poll();assert(!f.room.game.mission.error,f.room.game.mission.error);assert.equal(f.room.game.units.length,before+(team?33:22));
   f.poll();assert.equal(f.room.game.units.length,before+(team?33:22));
   if(wave===2)f.room.game=JSON.parse(JSON.stringify(f.room.game));
  }
  for(const u of f.room.game.units.filter(u=>u.missionActor&&!m.protect.includes(u.missionActor)))u.hp=0;
  f.poll();f.poll();assert.equal(f.room.game.units.filter(u=>u.missionActor).length,330);
  assert.equal(new Set(f.room.game.units.map(u=>u.id)).size,f.room.game.units.length);
  if(n===29){for(const id of ['neue-ziel','dendrobium','cima','albion','lili-marleen'])assert.equal(f.room.game.units.filter(u=>u.missionActor===id).length,1);}
 }
});
test('A Baoa Qu attacks north with loaded late-type Federation fleets and Zeon screens',()=>{
 const f=fixture(19),map=G.getMap(f.task.missionId),actors=map.mission.actors;
 assert(map.spawns.filter(s=>s.team===0).every(s=>s.y>50));
 assert(map.spawns.filter(s=>s.team===1).every(s=>s.y<10));
 assert(map.mission.commission.extraction.y>50);
 for(let wave=0;wave<=5;wave++){
  const allies=actors.filter(a=>a.group==='allied-wave-'+wave);
  const ships=allies.filter(a=>G.models[a.unitId+'__'+a.kitId].unitTags.includes('Ship'));
  assert.deepEqual(ships.map(a=>a.unitId),['MagellanClassLateType','SalamisClassLateType','ColumbusClass']);
  assert.equal(allies.filter(a=>a.unitId==='FA_78_1').length,1);
  assert(allies.filter(a=>a.carrier).length>=13);
  for(const ship of ships)assert(allies.some(a=>a.carrier===ship.id));
 }
 assert(actors.filter(a=>a.team===1).every(a=>['MusaiClassLateType','PapuaClass','MS_14A','MS_06F2','MS_09R'].includes(a.unitId)));
 const loaded=f.room.game.units.filter(u=>u.team===0&&u.missionActor&&u.embarked);
 assert.equal(loaded.length,actors.filter(a=>a.team===0&&a.initial&&a.carrier).length);
 for(const u of loaded){const carrier=f.room.game.units.find(c=>c.id===u.embarked.carrierId);assert(carrier&&carrier.team===0);assert.equal(u.y,carrier.y);assert.equal(u.x,carrier.x);assert(G.hangars.launchCells(f.room.game,u).length>0);}
});
test('Side 6 sixty kills accumulate across matches and reloads without duplicate credit',()=>{
 let E=economy(),saved=E.snapshot();saved.contactIntro=true;saved.contactTasks=tasks.filter(t=>t.number<20).map(t=>({id:t.id,status:'claimed',progress:t.required,progressVersion:t.progressVersion}));E=economy(saved);E.acceptContactTask('efsf-20');
 let total=0;for(const amount of [20,25,15]){const receipt={id:'side6-'+total,matchId:'side6-'+total,money:0,supplies:0,contactProgress:[{id:'efsf-20',amount}]};E.creditAward(receipt);assert.equal(E.creditAward(receipt),false);total+=amount;E=economy(E.snapshot());const entry=E.snapshot().contactTasks.find(e=>e.id==='efsf-20');assert.equal(entry.progress,total);assert.equal(entry.status,total===60?'ready':'accepted');}
 E.completeContactTask('efsf-20');assert.throws(()=>E.completeContactTask('efsf-20'));
});
test('29 deliveries persist rewards and technology permits once; battle receipt grants no money',()=>{
 let E=economy();E.meetLiaison('efsf');assert(!C.available(E.snapshot(),'anaheim'));
 for(const t of tasks){E.acceptContactTask(t.id);const before=E.snapshot().money,receipt={id:'test-'+t.id,matchId:'test-'+t.id,money:0,supplies:0,contactProgress:[{id:t.id,amount:t.required,kills:7}]};E.creditAward(receipt);assert.equal(E.snapshot().money,before);assert.equal(E.creditAward(receipt),false);E=economy(E.snapshot());E.completeContactTask(t.id);assert.equal(E.snapshot().money,before+t.money+(t.moneyPerKill||0)*7);assert.throws(()=>E.completeContactTask(t.id));for(const id of C.planIds(t)){const plan=require('../shared/development-tree.json').EFSF.find(n=>n.id===id);for(const unit of plan.unlocks||[])if(Object.values(G.models).some(m=>m.prefabId===unit))assert(E.hasLicense(unit),unit);}if(t.number===15)assert(C.available(E.snapshot(),'anaheim'));}
 assert.equal(E.liaisonAffinity(),2900);assert.equal(E.snapshot().contactTasks.filter(e=>e.status==='claimed').length,29);
});
