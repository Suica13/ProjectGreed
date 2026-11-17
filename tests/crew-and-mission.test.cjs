const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const G = require('../shared/rules'), P=G.pilots, E=require('../shared/economy');
const { createRoomEngine }=require('../shared/room-engine');
const Classes=require('../shared/weapon-classes');
const hired=(grade='veteran', faction='EFSF', commander=false, seed=7319)=>P.hired({
  id:'crew-test-'+grade, hired:true, grade, faction, commander, seed,
});
test('all factions have seeded general, veteran, elite, non-selectable ACE and enhanced variants',()=>{
  for(const faction of Object.keys(require('../shared/factions.json'))){
    for(const commander of [false,true]){
      const m={faction,unitTags:commander?['CmdUnit']:[]}, base=P.roll(null,7319,0,0,m);
      assert(P.defaultName(m).includes('一般'));
      assert.equal(base.faction,faction);
      for(const [grade,multiplier] of [['veteran',1.2],['elite',1.4],['ace',1.6]]){
        const p=P.rollGrade(grade,7319,m);
        assert.equal(p.faction,faction);
        for(const key of Object.keys(P.labels)) assert.equal(p.stats[key],
          key==='awakening'&&grade!=='ace'?base.stats[key]:Math.round(base.stats[key]*multiplier));
      }
    }
    const p=hired('enhanced',faction);
    assert(p.stats.awakening>=75 && p.stats.awakening<=110);
    assert.equal(P.cost(p),250);
  }
  assert.equal(P.cost(hired('veteran')),50);
  assert.equal(P.cost(hired('elite')),150);
  assert.throws(()=>hired('ace'));
  assert.throws(()=>hired('enhanced','EFSF',true));
  assert.equal(P.roll("generic:ace",7319,0,0,{faction:"EFSF"}).genericGrade,"ace");
  assert.throws(()=>P.validate("generic:ace",{faction:"EFSF"}));
  const p=hired(); assert(!Object.hasOwn(p,"seed")); assert.deepEqual(P.custom({...p,stats:{shooting:99999}}).stats,p.stats);
});
test('shared tier stock falls back to ordinary pilots for invalid or excess assignments',()=>{
  const entries=[{customPilot:hired()},{customPilot:{...hired(),id:'crew-other',faction:'ZEON'}},
    {customPilot:{...hired(),grade:'invalid'}}];
  const clean=P.normalizeCrewFormation(entries,{veteran:1});
  assert(clean[0].customPilot.hired); assert(!clean[1].customPilot); assert(!clean[2].customPilot);
  assert(entries[1].customPilot);
  const unit={unitId:'RGM_79',kitId:'machine_gun',customPilot:hired('veteran','ZEON')};
  assert(!G.validateFleetFormation([unit],Infinity,72)[0].customPilot);
});
function economy(){
  const storage=new Map(); const context=vm.createContext({PilotSystem:P,SaveCodec:require('../shared/save-codec'),
    STARTER_PROFILE:require('../shared/starter-profile.json'),PRODUCTION_CATALOG:require('../shared/production-data.cjs'),
    ART:G.catalog,DEVELOPMENT_TREE:require('../shared/development-tree.json'),structuredClone,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  vm.runInContext(fs.readFileSync('shared/economy.js','utf8')+';globalThis.E=Economy;',context);
  return context.E;
}
test('recruitment is paid, tier stock persists, settlement receipts deduct once and licenses use 1x/3x prices',()=>{
  const e=economy(), before=e.snapshot();
  for(const grade of ['veteran','elite','enhanced']) assert(e.recruitCrew(grade));
  assert.equal(e.snapshot().money,before.money-2250);
  assert.deepEqual({...e.snapshot().crewStock},{veteran:1,elite:1,enhanced:1});
  const award={id:'crew-loss',matchId:'match',money:0,supplies:0,crewLost:{veteran:1,enhanced:1}};
  assert(e.creditAward(award)); assert(!e.creditAward(award));
  assert.deepEqual({...e.snapshot().crewStock},{veteran:0,elite:1,enhanced:0});
  assert.equal(e.validate(before).crewStock.elite,0);
  for(const id of ['RGM_79','MAN_08','Medea']){
    const p=e.productionOffer(id,e.defaultKit(id)), l=e.licenseOffer(id);
    assert.equal(l.money,p.money);assert.equal(l.supplies,p.supplies*3);
  }
});
test('MA and remote strike accuracy is converted exactly once; usable remote salvos have finite positive damage',()=>{
  const rows=[];
  for(const m of Object.values(G.models)){
    if(!m.unitTags?.includes('MA') && !m.weapons.some(w=>w.remote))continue;
    const g=G.create(false,7319,[[{unitId:'RGM_79',kitId:'machine_gun'}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,
      {costLimit:99999,unitCostLimit:99999});
    const environment=(m.adaptability.space||0)>=(m.adaptability.ground||0)?'space':'ground';
    g.environment=environment;g.fogMode='disabled';g.tiles.forEach(r=>r.fill('plain'));
    g.cellEnvironments=g.tiles.map(r=>r.map(()=>environment));
    const [a,b]=g.units; a.model=m.prefabId+'__'+m.kitId; a.environment=environment;b.environment=environment;
    a.x=8;a.y=8;b.x=10;b.y=8;a.en=100000;b.shield=0;
    a.pilot={stats:Object.fromEntries(Object.keys(P.labels).map(k=>[k,100]))};
    b.pilot={stats:Object.fromEntries(Object.keys(P.labels).map(k=>[k,k==='awakening'?0:100]))};
    for(const w of m.weapons){
      if(!w.attack.strikes.length)continue;
      const step=w.attack.strikes[0];
      if(step.accuracy===w.hit){
        const single={...w,attack:{...w.attack,strikes:[step]}};
        const copy={...step};delete copy.accuracy;
        const native={...w,attack:{...w.attack,strikes:[copy]}};
        assert.equal(G.estimate(g,a,b,single,'none').hit,G.estimate(g,a,b,native,'none').hit,m.id+'/'+w.id);
      }
      if(w.remote){
        const scaled=G.weaponStats(w,a), result=G.estimate(g,a,b,w,'none');
        assert(Number.isFinite(result.hit)&&result.hit>0); assert(scaled.damage>0);
        assert(result.damage>0,m.id+'/'+w.id+' unexpectedly deals zero to unshielded GM');
        rows.push({model:a.model,weapon:w.id,hit:result.hit,damage:result.damage,shots:w.attack.shots.length});
      }
    }
  }
  assert(rows.length>10);
  fs.mkdirSync('tmp/verification/reports',{recursive:true});
  fs.writeFileSync('tmp/verification/reports/remote-damage-audit.json',JSON.stringify(rows,null,2));
});
test('smart beam timing and shotgun classes are distinct while charged sniper and cluster bazookas keep their classes',()=>{
  const w=G.models.MSZ_006C1__standard.weapons.find(w=>w.sourceName==='AEUG_MSZ_006C1_BeamSmartGun');
  assert.equal(Classes.classify(w),'beam_smart_gun');
  assert(w.projectile.sequence.duration>=1);
  assert.equal(Classes.classify({sourceName:'Common_ShellShotGun',type:'shell'}),'shell_shotgun');
  assert.equal(Classes.classify({sourceName:'Common_BeamShotGun',type:'beam'}),'beam_shotgun');
  assert.equal(Classes.classify({sourceName:'Bazooka_ShotgunMode',category:'bazooka'}),'bazooka');
  assert.equal(Classes.classify({sourceName:'BeamSmartGun_Sniper_Aim',category:'sniper'}),'sniper');
});
test('paid crew losses remain provisional during battle and settle once on mission completion',t=>{
  let serial=0;
  const engine=createRoomEngine({rules:G,randomId:()=> 'crew-'+ ++serial,randomToken:()=> 'token-'+ ++serial,
    randomSeed:()=>7319,aiDelayMs:999999,send:()=>{}});t.after(()=>engine.close());
  const host={readyState:1};
  engine.join(host,{mode:'create',room:'CREW',roomMode:'mission',characterFaction:'PMC',
    licenses:{ColumbusClass:true},inventory:{ColumbusClass:5},crewStock:{veteran:1}});
  const room=engine.rooms.get('CREW');
  const act=(action,fields={})=>engine.action(host,{id:'crew-req-'+ ++serial,revision:room.revision,
    phase:room.phase,round:room.game.round,matchId:room.matchId,action,...fields});
  const m=G.models.ColumbusClass__standard;
  const profile=hired('veteran',m.faction,P.commandUnit(m));
  act('start_game',{formation:[{unitId:'ColumbusClass',kitId:'standard',customPilot:profile},
    {unitId:'ColumbusClass',kitId:'standard'}]});
  act('confirm_formation');G.aiDeployment(room.game,0);act('confirm_deployment');
  while(room.game.mission.dialogue){const d=room.game.mission.dialogue;act('mission_dialogue_next',{dialogueId:d.id,lineIndex:d.index});}
  const actor=room.game.units.find(u=>u.pilot?.hired), member=room.members.get(host.memberId);
  assert(actor);assert.equal(member.crewStock.veteran,1);
  actor.hp=25;actor.burning={expiresRound:100,hpPercent:1,sourceId:room.game.units.find(u=>u.team===1).id,lastTickRound:-1};
  act('end_turn');
  assert.equal(actor.hp,0);
  assert.equal(room.economyAwards.filter(a=>a.crewLost).length,0);
  assert.equal(member.crewStock.veteran,1);
  room.game.round=11;room.game.units.filter(u=>u.team===1).forEach(u=>u.hp=0);engine.broadcast(room);
  const awards=room.economyAwards.filter(a=>a.crewLost);
  assert.equal(awards.length,1);assert.equal(awards[0].crewLost.veteran,1);
  assert.equal(member.crewStock.veteran,0);
  engine.broadcast(room);assert.equal(room.economyAwards.filter(a=>a.crewLost).length,1);
});
test('mercenary reserve drops a paid pilot when no replacement stock remains, before persistent settlement',t=>{
  let serial=0;const engine=createRoomEngine({rules:G,randomId:()=> 'crew-'+ ++serial,
    randomToken:()=> 'token-'+ ++serial,randomSeed:()=>7319,aiDelayMs:999999,send:()=>{}});
  t.after(()=>engine.close());const host={readyState:1},guest={readyState:1};
  const profile={characterFaction:'PMC',licenses:{Medea:true},inventory:{Medea:5},crewStock:{elite:1}};
  engine.join(host,{mode:'create',room:'CREWWAR',roomMode:'battlefield',...profile});
  engine.join(guest,{mode:'join',room:'CREWWAR',...profile});const room=engine.rooms.get('CREWWAR');
  const act=(ws,action,fields={})=>engine.action(ws,{id:'crew-request-'+ ++serial,revision:room.revision,
    phase:room.phase,round:room.game.round,matchId:room.matchId,action,...fields});
  const m=G.models.Medea__standard;
  act(guest,'set_ready',{formation:[{unitId:'Medea',kitId:'standard'}],ready:true});
  act(host,'start_game',{formation:[{unitId:'Medea',kitId:'standard',customPilot:hired('elite',m.faction,P.commandUnit(m))}]});
  act(host,'confirm_formation');act(guest,'confirm_formation');
  for(const ws of [host,guest]){G.aiDeployment(room.game,room.members.get(ws.memberId).seat);act(ws,'confirm_deployment');}
  const member=room.members.get(host.memberId), actor=room.game.units.find(u=>G.ownerOf(u)===member.seat && u.pilot?.hired);
  assert(actor);const reserve=room.game.battlefield.reserves.find(r=>r.formationIndex===actor.formationIndex && r.ownerSeat===member.seat);
  actor.hp=25;actor.burning={expiresRound:100,hpPercent:1,sourceId:room.game.units.find(u=>u.team!==actor.team).id,lastTickRound:-1};
  for(let i=0;i<room.seats.length;i++)if(room.seats[i]?.bot && G.seatTeam(i)===0)room.turnDone[i]=true;
  act(host,'end_turn');assert.equal(actor.hp,0);
  assert(!reserve.template.pilot.hired);assert.match(reserve.template.pilot.name,/一般/);
  assert.equal(room.economyAwards.filter(a=>a.crewLost).length,0);assert.equal(member.crewStock.elite,1);
  room.game.winner=0;engine.broadcast(room);assert.equal(member.crewStock.elite,0);
});
