const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),M=require('../shared/mission-mode');
const {createRoomEngine}=require('../shared/room-engine');
function fixture(t){
  let n=0;const frames=new Map();
  const engine=createRoomEngine({rules:G,randomId:()=>`city-${++n}`,randomToken:()=>`token-${++n}`,randomSeed:()=>7319,
    aiDelayMs:999999,roomReturnMs:10,send:(ws,s)=>frames.set(ws,s)});t.after(()=>engine.close());
  const host={readyState:1},guest={readyState:1};
  const profile={characterFaction:'PMC',licenses:{Medea:true},inventory:{Medea:5}};
  engine.join(host,{mode:'create',room:'CITY',roomMode:'mission',...profile});
  const room=engine.rooms.get('CITY');
  const act=(action,data={},ws=host)=>engine.action(ws,{id:`request-${++n}`,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...data});
  act('configure_room',{mapId:'mission_burning_city',costLimit:6000,unitLimit:18});
  engine.join(guest,{mode:'join',room:'CITY',...profile});
  const formation=[{unitId:'Medea',kitId:'standard'}];
  act('set_ready',{formation,ready:true},guest);act('start_game',{formation});
  act('confirm_formation',{},guest);act('confirm_formation');
  G.aiDeployment(room.game,room.members.get(guest.memberId).seat);act('confirm_deployment',{},guest);
  G.aiDeployment(room.game,0);act('confirm_deployment');
  const dialogue=()=>{
    const lines=[];
    while(room.game.mission.dialogue){
      assert(lines.length<50);const d=room.game.mission.dialogue;lines.push(d.lines[d.index]);
      act('mission_dialogue_next',{dialogueId:d.id,lineIndex:d.index});
    }
    assert.equal(room.game.mission.error,null);return lines;
  };
  const round=n=>{room.game.round=n;engine.broadcast(room);return dialogue();};
  return {engine,room,host,guest,act,frames,dialogue,round};
}
test('burning city square, era, two carriers, fixed dusk and independent yellow AI allies',t=>{
  const f=fixture(t),{room}=f,map=G.getMap(room.settings.mapId),allies=room.game.units.filter(u=>u.missionAutonomous);
  assert.equal(map.width,map.height);assert.equal(map.tileMap.biomeStyle.biome,'urban');
  for(const center of [9,22,35]){
    assert.deepEqual(map.tiles.slice(center-1,center+2).map(row=>row[14]),['plain','plain','plain']);
    assert.equal(map.tiles[center-2][14],'rubble');assert.equal(map.tiles[center+2][14],'rubble');
  }
  assert.equal(room.settings.costLimit,6000);assert.equal(room.settings.missionFleetLimit,2);
  assert.equal(room.settings.missionEra,'UC_0087_T1');assert.equal(require('../shared/battlefield-climate').resolve(map,room.settings,1,1).time,'dusk');
  assert.equal(allies.length,9);assert.equal(new Set(allies.map(u=>u.squadId)).size,3);
  assert.equal(room.game.units.filter(u=>u.missionGroup==='titans-line').length,21);
  assert.equal(room.seats[room.missionAllySeat].missionAlly,true);
  assert(!f.frames.get(f.host).members.some(p=>p.seat===room.missionAllySeat));
  assert.equal(f.dialogue()[0].text,'距离目标到达还有一段时间，请先进行部署，不用管我们。');
  const ally=allies[0];room.settings.shareAlliedUnits=true;
  assert.equal(G.canControlUnit(room.settings,[...room.members.values()],0,ally),false);
  assert.equal(G.canControlUnit(room.settings,[...room.members.values()],room.missionAllySeat,ally),true);
  assert.throws(()=>f.act('wait',{unitId:ally.id}),/不能操作/);
  const progress=M.objectives(room.game,G);assert.equal(progress.victory[0].current,0);assert.equal(progress.victory[0].total,3);
});
test('three staggered targets have the right escort squads and sixteen-turn two-seat SFS reinforcements',t=>{
  const f=fixture(t);f.dialogue();
  for(const [i,r] of [3,8,13].entries()){
    const lines=f.round(r);assert.equal(lines[0].text,['第一台出现了！','第二台出现了！','第三台出现了！'][i]);
    assert.equal(f.room.game.units.filter(u=>u.missionGroup==='psycho').length,i+1);
    const escorts=f.room.game.units.filter(u=>u.missionActor?.startsWith('psycho-escort-'+i));
    assert.equal(escorts.length,6);assert.equal(new Set(escorts.map(u=>u.squadId)).size,2);
    assert(escorts.every(u=>u.model.startsWith(i===2?'RMS_108':'RMS_106')));
  }
  f.round(16);const support=f.room.game.units.filter(u=>u.missionActor?.startsWith('support-'));
  assert.equal(support.filter(u=>u.model==='DodaiKai__standard').length,6);
  assert.equal(support.filter(u=>u.embarked?.exposed).length,12);
  assert(support.every(u=>u.missionAutonomous && G.ownerOf(u)===f.room.missionAllySeat));
  assert(support.filter(u=>u.model==='DodaiKai__standard').every(u=>G.hangars.cargo(f.room.game,u).length===2));
});
test('destroying all targets before round twenty-one plays relief camera dialogue before the high reward',t=>{
  const f=fixture(t);f.dialogue();f.round(13);
  f.room.game.units.filter(u=>u.missionGroup==='psycho').forEach(u=>u.hp=0);f.engine.broadcast(f.room);
  assert.equal(f.room.game.winner,null);
  const d=f.room.game.mission.dialogue;
  assert.equal(d.lines[0].actor,'relief-0');assert(d.lines[0].focus);
  assert.equal(f.room.game.units.filter(u=>u.missionActor?.startsWith('relief-')).length,24);
  f.dialogue();assert.equal(f.room.game.winner,0);
  assert.deepEqual(M.reward(f.room,G),{money:12000,supplies:18000,inventory:{MSN_100:1,MSA_003:6,RMS_179_AEUG:6}});
  assert.equal(f.room.economyAwards.filter(a=>a.kind==='result').length,2);
});
test('reaching the edge stays attackable until the next round; escape changes objectives and replaces rewards',t=>{
  const f=fixture(t);f.dialogue();f.round(21);
  const targets=f.room.game.units.filter(u=>u.missionGroup==='psycho');
  assert.equal(targets.length,3);assert(targets.every(u=>u.missionWithdrawal));
  targets[0].x=44;targets[0].y=9;f.engine.broadcast(f.room);
  assert.equal(targets[0].missionWithdrawal.edgeRound,21);assert(G.onMap(targets[0]));assert(!targets[0].missionEscaped);
  f.engine.broadcast(f.room);assert(!targets[0].missionEscaped);
  const lines=f.round(22);assert.equal(lines[0].text,'该死,有目标撤离了,那至少也要消灭提坦斯的有生力量');
  assert.equal(targets[0].missionEscaped,true);assert.equal(targets[0].hp,G.modelOf(targets[0]).hp);
  assert(!G.onMap(targets[0]));assert.equal(f.room.game.mission.defeatRounds?.[targets[0].missionActor],undefined);
  assert.equal(M.objectives(f.room.game,G).victory[0].kind,'all_enemies');
  targets.slice(1).forEach(u=>u.hp=0);f.engine.broadcast(f.room);assert.equal(f.room.game.winner,null);
  f.room.game.units.filter(u=>u.team===1&&!u.missionEscaped).forEach(u=>u.hp=0);f.engine.broadcast(f.room);
  assert.equal(f.room.game.winner,0);
  assert.deepEqual(M.reward(f.room,G),{money:10000,supplies:15000,inventory:{RMS_108:3,MSA_003:3,RMS_179_AEUG:6}});
});
test('PMC extinction loses even while autonomous allies remain alive',t=>{
  const f=fixture(t);f.dialogue();f.room.game.units.filter(u=>u.team===0&&!u.missionActor).forEach(u=>u.hp=0);
  f.engine.broadcast(f.room);assert.equal(f.room.game.winner,1);assert.equal(M.reward(f.room,G).money,0);
});

test('the independent ally controller can execute real AI actions without player delegation',async t=>{
  const f=fixture(t);f.dialogue();
  const allies=f.room.game.units.filter(u=>u.missionAutonomous);
  const before=allies.map(u=>({x:u.x,y:u.y}));
  f.room.turnNotBefore=0;f.engine.broadcast(f.room);
  const deadline=Date.now()+6000;
  while(Date.now()<deadline && !allies.some((u,i)=>u.x!==before[i].x || u.y!==before[i].y || u.acted || u.plan || u.pendingMove))
    await new Promise(r=>setTimeout(r,50));
  assert(allies.some((u,i)=>u.x!==before[i].x || u.y!==before[i].y || u.acted || u.plan || u.pendingMove));
  assert(!f.room.log.some(line=>/AI.*失败|不能操作该单位/.test(line.text || line)));
});
test('withdrawing targets use the real AI movement path toward the right edge',async t=>{
  const f=fixture(t);f.dialogue();f.round(21);
  f.room.game.team=1;f.room.turnDone.fill(false);f.room.turnNotBefore=0;
  const target=f.room.game.units.find(u=>u.missionActor==='psycho-0');
  target.x=35;target.y=9;target.moved=target.acted=false;
  for(const u of f.room.game.units)if(u.team===1 && u!==target)u.acted=true;
  f.engine.broadcast(f.room);
  const deadline=Date.now()+6000;
  while(Date.now()<deadline && target.x<=35 && !target.pendingMove)await new Promise(r=>setTimeout(r,50));
  assert(target.x>35 || target.pendingMove,'target must issue a real retreat move');
});

test('mission saves keep five player slots and restore the separate allied AI controller',async t=>{
  const f=fixture(t);f.dialogue();
  const R=require('../shared/match-records');
  const save=R.validateSave(G,R.createSave(G,f.room));
  assert.equal(save.armies.length,10);
  const invalid=structuredClone(save);invalid.game.units.find(u=>u.missionAutonomous).missionActor='unknown';
  assert.throws(()=>R.validateSave(G,invalid),/存档单位状态/);
  f.act('return_room');
  const deadline=Date.now()+2000;while(f.room.started && Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
  f.room.loadedSave=save;f.act('save_load');
  assert.equal(f.room.seats.length,10);assert.equal(f.room.missionAllySeat,undefined);
  const formation=[{unitId:'Medea',kitId:'standard'}];
  f.act('set_ready',{formation,ready:true},f.guest);f.act('start_game',{formation});
  f.act('confirm_formation',{},f.guest);f.act('confirm_formation');
  assert.equal(f.room.phase,'idle');
  assert.equal(f.room.seats[f.room.missionAllySeat].missionAlly,true);
  assert(f.room.game.units.filter(u=>u.missionAutonomous).every(u=>G.ownerOf(u)===f.room.missionAllySeat));
  assert.equal(f.room.game.mission.dialogue,null);
});
