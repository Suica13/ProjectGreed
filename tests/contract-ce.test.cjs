const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../shared/rules'), C = require('../shared/contract-mode'), F = require('../shared/contract-forces');
const contacts = require('../shared/contact-tasks'), tree = require('../shared/development-tree.json');
const {createRoomEngine} = require('../shared/room-engine');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const codec = require('../shared/save-codec');

function economy(saved) {
  const data = new Map(saved ? [['projectgreed.economy.v1',codec.stringify(saved)]] : []);
  const context = vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),
    module:{exports:{}}, structuredClone, ART:G.catalog,
    localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
  vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),context);
  return context.module.exports;
}
function fixture(t, faction, difficulty, task) {
  let serial=0; const errors=[], ws={readyState:1};
  const engine=createRoomEngine({rules:G,randomId:()=> 'ce-'+ ++serial,randomToken:()=> 'token-'+ ++serial,
    randomSeed:()=>1936384585,aiDelayMs:999999,roomReturnMs:999999,
    send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});
  t.after(()=>engine.close());
  engine.join(ws,{mode:'create',room:'CE',roomMode:'sweep',characterFaction:'PMC',inventory:{Medea:1},licenses:{Medea:true},
    storedUnits:[{id:'stock',unitId:'Medea',kitId:'standard',hp:G.models.Medea__standard.hp,en:G.models.Medea__standard.en}],
    contactTasks:task?[{id:task.id,status:'accepted',progress:0}]:[]});
  const room=engine.rooms.get('CE');
  const act=(action,fields={})=>engine.action(ws,{id:'act-'+ ++serial,revision:room.revision,
    round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
  act('configure_room',{...room.settings,sweepEra:'CE_0071_T1',sweepDifficulty:difficulty,sweepFaction:faction,
    sweepAlliedFaction:faction==='NONE'?'NONE':faction==='OMNI'?'ZAFT':'OMNI'});
  return {room,act,errors,start(){
    act('start_game',{formation:[{unitId:'Medea',kitId:'standard',stockId:'stock'}]});
    act('confirm_formation');act('auto_place_deployment');act('confirm_deployment');
    assert.deepEqual(errors,[]);assert.equal(room.phase,'idle');
  }};
}

test('CE ground contracts reject N1 and space at the authority boundary',t=>{
  assert.throws(()=>C.roomSettings({sweepEra:'CE_0071_T1',sweepDifficulty:1,sweepEnvironment:'ground'}),/N2/);
  assert.throws(()=>C.roomSettings({sweepEra:'CE_0071_T1',sweepDifficulty:2,sweepEnvironment:'space'}),/宇宙/);
  assert.throws(()=>fixture(t,'OMNI',1),/N2/);
  assert.throws(()=>G.validateOpenContent({...G.defaultRoomSettings(),mode:'regular',regularEra:'CE_0071_T1'}));
});

test('armed intervention enlarges both map axes and adds exactly one ordinary event',()=>{
  for(let n=1;n<=6;n++){
    const settings={sweepDifficulty:n,sweepEra:'UC_0079_T1',sweepEnvironment:'ground',sweepFaction:'NONE'};
    const base=C.config(n),d=C.scenarioConfig(settings),map=C.generateMap(G.catalog,settings,100+n);
    assert.equal(map.width,Math.ceil(base.width*1.1));assert.equal(map.height,Math.ceil(base.height*1.1));
    assert.equal(d.events,n+1);assert.equal(map.contractLayout.locations.length,n+1);
    assert(map.tiles.every(row=>row.length===map.width));assert.equal(map.tiles.length,map.height);
    assert.equal(C.config(n).events,n,'base configuration must remain reusable');
  }
});

test('global rewards and intervention rewards stack for currency, research and pilot experience',()=>{
  for(let n=1;n<=6;n++){
    const state={objectives:Array.from({length:n},()=>({status:'completed'}))};
    const room={settings:{sweepDifficulty:n,sweepEra:'UC_0079_T1'},game:{contract:state}};
    const normal=C.reward(room,G),oldXP=[500,1000,1500,3000,4000,5000][n-1];
    assert.equal(normal.experience,oldXP*1.25);
    assert.equal(normal.money,[2500,4000,6000,9000,12000,15000][n-1]); // settlement adds its existing x1.25 once
    state.noAllies=true;const intervention=C.reward(room,G);
    for(const key of ['money','supplies','technology'])assert.equal(intervention[key],normal[key]*1.25);
    assert.equal(intervention.experience,Math.floor(oldXP*1.5625));
    state.objectives.forEach(o=>o.status='failed');assert.equal(C.reward(room,G).money,0);
  }
});

test('either final UC task unlocks both contacts; meeting and all hand-ins persist every T1 license once',()=>{
  for(const gate of ['efsf-11','zeon-11']){
    let E=economy();for(const id of ['omni','zaft'])assert.throws(()=>E.meetLiaison(id),/解锁/);
    const saved=E.snapshot();saved.contactTasks=[{id:gate,status:'claimed',progress:1}];E=economy(saved);
    for(const id of ['omni','zaft']){
      assert(contacts.available(E.snapshot(),id));assert(E.meetLiaison(id));assert.equal(E.meetLiaison(id),false);
      for(const plan of contacts.introPlans(id))for(const unit of tree[id.toUpperCase()].find(n=>n.id===plan).unlocks)
        if(G.catalog.prefabs.some(p=>p.id===unit&&!p.facility))assert(E.hasLicense(unit),unit);
      for(const task of contacts.tasks.filter(t=>t.contactId===id)){
        assert(E.acceptContactTask(task.id));
        E.creditAward({id:gate+task.id,matchId:gate+task.id,money:0,supplies:0,contactProgress:[{id:task.id,amount:1}]});
        assert(E.completeContactTask(task.id));assert.throws(()=>E.completeContactTask(task.id));
      }
      const granted=new Set([...contacts.introPlans(id),...contacts.tasks.filter(t=>t.contactId===id).flatMap(contacts.planIds)]);
      assert(tree[id.toUpperCase()].filter(n=>n.era==='CE_0071_T1'&&!n.placeholder).every(n=>granted.has(n.id)));
      const reloaded=economy(E.snapshot());assert(contacts.met(reloaded.snapshot(),id));
      const licenses=reloaded.snapshot().licenses;
      for(const node of tree[id.toUpperCase()].filter(n=>n.era==='CE_0071_T1'&&!n.placeholder))
        for(const unit of node.unlocks)if(G.catalog.prefabs.some(p=>p.id===unit)&&!G.catalog.prefabs.find(p=>p.id===unit).facility)
          assert(licenses[unit] || reloaded.hasLicense(unit),unit);
    }
  }
});

test('CE Markdown profiles retain complete formations, ordinary pilots, progression and nuclear bans',()=>{
  require('../tools/compile-contract-force-pools.cjs').generate({check:true});
  for(const faction of ['OMNI','ZAFT'])for(let n=2;n<=6;n++){
    const s={sweepEra:'CE_0071_T1',sweepEnvironment:'ground',sweepFaction:faction,sweepDifficulty:n};
    const rows=F.formations(s,G);assert.equal(rows.length,F.profile(s).formations.length);
    assert(rows.every(r=>r.units.length%3===0&&r.kits.every(k=>k.length&&k.every(F.aiKitAllowed))));
    assert(F.profile(s).garrisons.command>=require('../shared/contract-force-pools.json').factions[faction==='OMNI'?'EFSF':'ZEON'][n].garrisons.command);
    if(n<4)assert(rows.every(r=>!r.units.some(id=>id.startsWith('GAT_X'))));
  }
  assert(!F.aiKitAllowed(G.models.TS_MA2_H__nuclear));assert(F.aiKitAllowed(G.models.TS_MA2_H__main_0));
});

for(const faction of ['OMNI','ZAFT','NONE'])for(const difficulty of [2,4,6])
  test(`CE ${faction} N${difficulty} starts and settles using the shared authority`,t=>{
    const f=fixture(t,faction,difficulty);f.start();
    assert.equal(f.room.game.contract.objectives.length,difficulty+(faction==='NONE'?1:0));
    assert(f.room.game.units.filter(u=>u.team>0&&!u.facility).every(u=>F.aiKitAllowed(G.modelOf(u))&&!u.pilot.genericGrade));
    for(const o of f.room.game.contract.objectives)o.status='completed';
    const unit=f.room.game.units.find(u=>u.ownerSeat===0 || u.owner===0),exit=f.room.game.contract.extractions[0];
    assert(unit);Object.assign(unit,{x:exit.x+1,y:exit.y+1,acted:false,moved:false});
    f.act('contract_extract',{unitId:unit.id});assert.deepEqual(f.errors,[]);assert(f.room.economySettled);
    const award=f.room.economyAwards.find(a=>a.kind==='result'),bonus=1.25*(faction==='NONE'?1.25:1);
    assert.equal(award.money,Math.round([2500,4000,6000,9000,12000,15000][difficulty-1]*bonus/25)*25);
    assert.equal(award.supplies,Math.round([3500,6000,8000,11000,15000,20000][difficulty-1]*bonus/25)*25);
  });

for(const task of contacts.tasks.filter(t=>['omni','zaft'].includes(t.contactId)))
  test(`CE task ${task.id} creates its playable special event`,t=>{
    const f=fixture(t,task.enemyFaction,task.difficulty,task);f.start();
    const objective=f.room.game.contract.objectives.find(o=>o.contactTaskId===task.id);assert(objective);
    assert.equal(objective.type,task.kind);
    if(task.targetUnits)assert.equal(objective.targets.length,task.targetUnits.length);
  });

test('intervention reinforcement waves share a 25 percent larger cap across both factions',t=>{
  const f=fixture(t,'NONE',6);f.start();const game=f.room.game;
  for(const u of game.units.filter(u=>u.team>0))u.hp=0;
  for(const o of game.contract.objectives)o.status='completed';
  for(let i=0;i<80;i++){game.round+=2;C.poll(f.room,G);}
  const alive=game.units.filter(u=>u.contractReinforcement&&u.hp>0);
  assert(alive.length>Math.floor(27*1.1),'new capacity must exceed the previous 10 percent allowance');
  assert(alive.length<=Math.floor(27*1.25));
  const count=game.units.length;
  for(let i=0;i<12;i++){game.round+=2;C.poll(f.room,G);}
  assert.equal(game.units.length,count);
});

for(const faction of ['OMNI','ZAFT'])test(`CE ${faction} recovery spawns its own loaded transports`,t=>{
  const f=fixture(t,faction,6);f.start();const game=f.room.game,o=game.contract.objectives.find(o=>o.type==='salvage');
  assert(o);const actor=game.units.find(u=>u.ownerSeat===0);
  Object.assign(actor,{x:o.x,y:o.y,acted:false,moved:false});const before=game.units.length;
  C.action(f.room,G,f.room.seats[0],{action:'contract_interact',unitId:actor.id,objectiveId:o.id});
  assert.equal(o.status,'completed');const added=game.units.slice(before);
  const carriers=added.filter(u=>G.modelOf(u).prefabId===(faction==='OMNI'?'VTOLTransport':'VoLPHAU'));
  assert(carriers.length);
  for(const carrier of carriers)assert(added.filter(u=>u.embarked?.carrierId===carrier.id).length>=3);
  assert(added.every(u=>F.aiKitAllowed(G.modelOf(u))));
});
