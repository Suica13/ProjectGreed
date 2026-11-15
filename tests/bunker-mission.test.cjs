const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),M=require('../shared/mission-mode'),D=require('../shared/map-document');
const {createRoomEngine}=require('../shared/room-engine');
function fixture(t){
  let n=0;const frames=new Map();
  const engine=createRoomEngine({rules:G,randomId:()=>"bunker-"+(++n),randomToken:()=>"tok-"+(++n),randomSeed:()=>7319,
    aiDelayMs:999999,send:(ws,s)=>frames.set(ws,s)});t.after(()=>engine.close());
  const host={readyState:1},guest={readyState:1};
  const profile={characterFaction:'PMC',inventory:{Medea:5},licenses:{Medea:true}};
  engine.join(host,{mode:'create',room:'BUNKER',roomMode:'mission',...profile});
  const room=engine.rooms.get('BUNKER');
  const act=(action,data={},ws=host)=>{
    const request={id:'req-'+(++n),revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...data};
    engine.action(ws,request);return request;
  };
  act('configure_room',{mapId:'mission_bunker_coastal',costLimit:4500,unitLimit:18});
  engine.join(guest,{mode:'join',room:'BUNKER',...profile});
  const formation=[{unitId:'Medea',kitId:'standard'}];
  act('set_ready',{formation,ready:true},guest);act('start_game',{formation});
  act('confirm_formation',{},guest);act('confirm_formation');
  G.aiDeployment(room.game,room.members.get(guest.memberId).seat);act('confirm_deployment',{},guest);
  G.aiDeployment(room.game,0);act('confirm_deployment');
  const round=n=>{room.game.round=n;engine.broadcast(room);assert.equal(room.game.mission.error,null);};
  const waves=()=>{for(const n of [2,3,4,6,10])round(n);};
  const finishDialogue=()=>{
    const seen=[];
    while(room.game.mission.dialogue){
      const d=room.game.mission.dialogue;
      assert.equal(room.game.winner,null);
      assert.equal(room.game.units.filter(u=>u.missionGroup==='last-stand').length,0);
      seen.push(d.lines[d.index]);
      act('mission_dialogue_next',{dialogueId:d.id,lineIndex:d.index});
    }
    return seen;
  };
  const ceasefire=()=>{waves();room.game.units.filter(u=>u.missionGroup==='main-force').forEach(u=>u.hp=0);engine.broadcast(room);};
  return {engine,room,frames,host,guest,act,round,waves,ceasefire,finishDialogue};
}
test('bunker rules, fortress, beach and mass driver compile with a two-ship fleet cap',t=>{
  const f=fixture(t),map=G.getMap(f.room.settings.mapId);
  M.validate(map.mission,map,G);D.validate(map.tileMap);
  assert.equal(f.room.settings.costLimit,4500);assert.equal(f.room.settings.missionEra,'UC_0079_T2');
  assert.equal(G.armyUnitLimit(f.room.settings,{seat:0}),2);
  const restrictions=G.armyRestrictions(f.room.settings,{seat:0});assert.equal(restrictions.fleetLimit,2);
  const plan=G.planFormation(Array(3).fill({unitId:'Medea',kitId:'standard'}),4500,{requiresCarriers:true,fleetLimit:2},18);
  assert.equal(plan.reasons[2],'count');assert.equal(plan.indices.length,2);
  const units=f.room.game.units;
  assert.equal(units.filter(u=>u.model==='DabudeClass__standard').length,3);
  assert.equal(units.filter(u=>u.facility).length,8);
  assert(units.filter(u=>u.facility).every(u=>u.facility.level===2 && u.hp===G.modelOf(u).hp));
  assert.equal(units.filter(u=>u.team===1 && u.missionGroup==='main-force').length,21);
  assert(map.tiles[15].slice(68).every(t=>t==='water'));
  assert(map.tiles.flat().includes('desert'));assert.equal(map.mission.landmarks[0].type,'mass_driver');
});
test('bunker timed support and waves preserve all requested counts and real transport cargo',t=>{
  const f=fixture(t);f.waves();const units=f.room.game.units;
  const count=prefix=>units.filter(u=>u.missionActor?.startsWith(prefix)).length;
  assert.equal(count('jim-support'),9);assert.equal(count('guntank-support'),6);
  assert.equal(new Set(units.filter(u=>u.missionGroup==='jim-support').map(u=>u.squadId)).size,3);
  assert.equal(new Set(units.filter(u=>u.missionGroup==='guntank-support').map(u=>u.squadId)).size,2);
  assert.equal(units.filter(u=>u.missionActor?.startsWith('wave-one-') && u.embarked).length,12);
  assert.equal(units.filter(u=>u.missionActor?.startsWith('wave-two-f2') && u.embarked).length,6);
  assert.equal(count('wave-two-dom'),6);assert.equal(count('wave-three-gelgoog'),6);
  assert.equal(units.filter(u=>u.model==='FatUncle__standard').length,6);
  assert(units.filter(u=>u.model==='FatUncle__standard').every(u=>G.hangars.cargo(f.room.game,u).length===3));
  assert.equal(f.room.game.winner,null);assert.equal(f.room.game.mission.choice,undefined);
});
test('clearing only the initial garrison cannot skip future main forces or offer an early ceasefire',t=>{
  const f=fixture(t);f.room.game.units.filter(u=>u.missionGroup==='main-force').forEach(u=>u.hp=0);
  f.engine.broadcast(f.room);assert.equal(f.room.game.winner,null);assert(!f.room.game.mission.choice);
  f.waves();assert(!f.room.game.mission.choice);
});
for(const option of ['accept','refuse'])test(`synchronized ${option} branch authorizes only the commander and awards each PMC once`,t=>{
  const f=fixture(t);f.ceasefire();
  assert(!f.room.game.mission.choice,'request dialogue must precede the choice');
  const requestLines=f.finishDialogue();
  assert.equal(requestLines.length,9);
  assert.equal(requestLines[0].name,'吉翁军前线指挥官');
  assert.equal(requestLines.at(-1).text,'已上报，等待回复。');
  assert(requestLines.every(l=>l.portrait && l.actor));
  const {room}=f,choice=room.game.mission.choice;
  assert(choice);assert.equal(room.game.winner,null);
  assert.deepEqual(f.frames.get(f.host).game.mission.choice,f.frames.get(f.guest).game.mission.choice);
  assert.throws(()=>f.act('end_turn'),/剧情/);
  assert.throws(()=>f.act('mission_choose',{choiceId:choice.id,optionId:option},f.guest),/指挥/);
  assert.throws(()=>f.act('mission_choose',{choiceId:choice.id,optionId:'invalid'}),/无效/);
  assert.throws(()=>f.act('mission_choose',{choiceId:choice.id,optionId:option,revision:room.revision-1}),/更新/);
  const request=f.act('mission_choose',{choiceId:choice.id,optionId:option});
  assert.equal(room.game.mission.choice,null);
  assert(room.game.mission.dialogue,'branch dialogue must run before victory or reinforcements');
  const branchLines=f.finishDialogue();
  assert.equal(branchLines.length,option==='accept'?8:9);
  assert.deepEqual(branchLines.slice(0,3).map(l=>l.text),['待机...','待机......','待机.........']);
  assert.equal(branchLines.at(-1).text,option==='accept'?'这场战争的结局是不会改变的。':'死也要咬下来一块肉！');
  if(option==='refuse'){
    assert.equal(room.game.winner,null);assert.equal(room.game.units.filter(u=>u.missionGroup==='last-stand').length,22);
    assert.equal(room.game.units.filter(u=>u.missionActor?.startsWith('last-old-zaku')).length,9);
    assert.equal(room.game.units.filter(u=>u.missionActor?.startsWith('last-zaku-j')).length,6);
    assert.equal(room.economyAwards.filter(a=>a.kind==='result').length,0);
    room.game.units.filter(u=>u.team===1 && !u.facility).forEach(u=>u.hp=0);f.engine.broadcast(room);
    assert.equal(room.game.winner,null,'surviving turrets still have to be destroyed');
    room.game.units.filter(u=>u.team===1).forEach(u=>u.hp=0);f.engine.broadcast(room);
  }
  assert.equal(room.game.winner,0);
  const awards=room.economyAwards.filter(a=>a.kind==='result');assert.equal(awards.length,2);
  for(const a of awards){assert.equal(a.money,option==='accept'?5000:7500);assert.equal(a.supplies,option==='accept'?7500:10000);
    assert.deepEqual(a.stockGained.inventory,option==='accept'?{RGM_79SC:6,RGM_79HC:6}:{RX_81:3,RGM_79C:9});}
  f.engine.action(f.host,request);f.engine.broadcast(room);assert.equal(room.economyAwards.filter(a=>a.kind==='result').length,2);
  assert.equal(room.game.units.filter(u=>u.missionGroup==='last-stand').length,option==='accept'?0:22);
});
test('PMC extinction loses with no branch reward',t=>{
  const f=fixture(t);f.room.game.units.filter(u=>!u.missionActor && u.team===0).forEach(u=>u.hp=0);
  f.engine.broadcast(f.room);assert.equal(f.room.game.winner,1);
  const reward=M.reward(f.room,G);assert.deepEqual(reward,{money:0,supplies:0,inventory:{}});
});
test('bunker branch references, fleet limits and scripted rewards validate on map export',()=>{
  const original=G.getMap('mission_bunker_coastal');
  for(const mutate of [m=>m.fleetLimit=0,m=>m.events.find(e=>e.id==='ceasefire').actions.find(a=>a.type==='choice').options[0].id='refuse',
    m=>m.rewards.outcomes[0].event='missing',m=>m.victory.continueOption='missing']){
    const map=structuredClone(original);mutate(map.mission);assert.throws(()=>M.validate(map.mission,map,G),/无效/);
  }
});
