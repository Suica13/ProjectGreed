const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/contract-mode'),F=require('../shared/contract-forces'),T=require('../shared/contact-tasks');
const {createRoomEngine}=require('../shared/room-engine');
function battle(era,n,environment,faction){
 let serial=0;const errors=[];
 const engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>1936384585,aiDelayMs:999999,send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});
 const ws={readyState:1},unitId=environment==='space'?'ColumbusClass':'Medea',model=G.models[unitId+'__standard'];
 engine.join(ws,{mode:'create',room:'LADDER',roomMode:'sweep',characterFaction:'PMC',inventory:{[unitId]:1},licenses:{[unitId]:true},storedUnits:[{id:'stock',unitId,kitId:'standard',hp:model.hp,en:model.en}]});
 const room=engine.rooms.get('LADDER');
 const act=(action,fields={})=>engine.action(ws,{id:'req'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
 try{
 act('configure_room',{...room.settings,sweepEra:era,sweepDifficulty:n,sweepEnvironment:environment,sweepFaction:faction,sweepAlliedFaction:C.factionsForEra(G,era).find(f=>f!==faction)});
 act('start_game',{formation:[{unitId,kitId:'standard',stockId:'stock'}]});act('confirm_formation');
 assert.deepEqual(errors,[]);assert.equal(room.phase,'deployment');return {room,close:()=>engine.close()};
 }catch(e){engine.close();throw e;}
}
test('0087 and CE have ten levels, fixed fleet limits and population growth',()=>{
 for(const era of ['UC_0087_T1','UC_0087_T2','CE_0071_T1']){
  assert.deepEqual(C.difficulties.map(d=>C.config(d.id,era).initialEnemyCount),[9,12,18,24,30,33,36,39,42,45]);
  for(let n=1;n<=10;n++){assert.equal(C.config(n,era).fleetLimit,5);assert.equal(C.config(n,era).events,Math.min(n,5));}
 }
 for(let n=1;n<=10;n++)assert.deepEqual(C.config(n,'UC_0087_T1'),C.config(n,'UC_0087_T2'));
 const rules=G.armyRestrictions({...G.defaultRoomSettings(),mode:'sweep',sweepEra:'UC_0087_T1'},{});
 for(const era of ['UC_0079_T1','UC_0079_T2','UC_0087_T1','UC_0087_T2','CE_0071_T1','AD_2307_T1'])assert(rules.allowedEras.includes(era));
 assert(!rules.allowedEras.includes('UC_0093_T1'));
});
for(const [era,environments,factions] of [['UC_0079_T1',['space'],['EFSF','ZEON']],['UC_0087_T2',['ground','space'],['AEUG','TITANS','NEO_ZEON']],['CE_0071_T1',['ground','space'],['OMNI','ZAFT']]])
 for(const environment of environments)for(const faction of factions)test(`${era} ${environment} ${faction} actual enemy generation`,()=>{
  for(const n of [1,5,6,8,10]){const f=battle(era,n,environment,faction);try{
   const units=f.room.game.units.filter(u=>u.team>0&&!u.facility&&!G.modelOf(u).facility);
   assert.equal(units.length,C.config(n,era).initialEnemyCount,`N${n}`);
   for(const objective of f.room.game.contract.objectives.filter(o=>o.type==='defend')) {
    const guards=f.room.game.units.filter(u=>objective.protected.includes(u.id)&&!u.facility);
    assert.equal(guards.length,6);
    const squads=[...new Set(guards.map(u=>u.squadId))];assert.equal(squads.length,2);assert(squads.every(Boolean));
    for(const id of squads){const members=guards.filter(u=>u.squadId===id);assert.equal(members.length,3);assert(members.every(u=>u.x===members[0].x&&u.y===members[0].y&&u.missionAutonomous));}
   }
   if(environment==='space')assert(units.every(u=>G.modelOf(u).adaptability.space>=100));
   const family=F.family(era);
   if(era.startsWith('UC_0087'))assert.equal(f.room.settings.sweepEra,'UC_0087_T1');
   for(const u of units){const m=G.modelOf(u);assert.equal(u.hp,m.hp);assert(F.modelAllowed(f.room.settings,m));if(n<=5)assert(m.tags.includes(family[0]));if(n===10&&family.length===2)assert(m.tags.includes(family[1]));}
   if(environment==='space' && n===10){
    const game=f.room.game,actor=game.units.find(u=>u.ownerSeat===0);
    const objective={id:'transport-check',type:'salvage',status:'available',x:10,y:10};
    game.contract.objectives.push(objective);f.room.phase='idle';game.team=0;game.winner=null;
    Object.assign(actor,{x:10,y:10,acted:false,deployed:true,deploymentStaged:false});
    const before=game.units.length;
    C.action(f.room,G,f.room.seats[0],{action:'contract_interact',unitId:actor.id,objectiveId:objective.id});
    const added=game.units.slice(before),ships=added.filter(u=>G.modelOf(u).ship);
    assert(ships.length>0,`${era} ${faction} transport wave`);
    for(const ship of ships){const m=G.modelOf(ship);assert(m.adaptability.space>=100);assert((m.availableFactions||[m.faction]).includes(faction));assert(added.filter(u=>u.embarked?.carrierId===ship.id).length>=3);}
   }
  }finally{f.close();}}
 });
test('CE task requirements compress to N1-N5 without changing rewards or save schema',()=>{
 for(const id of ['omni','zaft']){const chain=T.tasks.filter(t=>t.contactId===id);
  assert.deepEqual(chain.map(t=>t.difficulty),[1,1,2,2,3,3,4,4,5,5]);
  chain.forEach((t,i)=>{assert.equal(t.money,10000+(t.difficulty+1)*4000+i*1500);assert.equal(t.progressVersion,2);assert(t.objective.includes('N'+t.difficulty+'以上'));});
 }
});

 test('space pools respect faction, technology, era weights and cache isolation',()=>{
  for(const [era,factions] of [['UC_0079_T1',['EFSF','ZEON']],['UC_0087_T1',['AEUG','TITANS','NEO_ZEON']],['CE_0071_T1',['OMNI','ZAFT']]])
   for(const faction of factions)for(let n=1;n<=10;n++){
    const settings={sweepEra:era,sweepFaction:faction,sweepDifficulty:n,sweepEnvironment:'space'};
    const forms=F.formations(settings,G);assert(forms.length);
    for(const f of forms){assert.equal(f.units.length,3);for(const kits of f.kits)for(const m of kits){
     assert(m.adaptability.space>=100);assert((m.availableFactions||[m.faction]).includes(faction));assert(F.modelAllowed(settings,m));assert(G.aiTechnologyAllows(m,faction));assert(F.aiKitAllowed(m));
    }}
    if(era.startsWith('UC_')){
     const late=F.family(era)[1];const share=forms.filter(f=>f.kits[0][0].tags.includes(late)).reduce((sum,f)=>sum+f.weight,0);
     assert(Math.abs(share-F.t2Share(n))<1e-8,`${era} ${faction} N${n}: ${share}`);
    }
    const ground=F.formations({...settings,sweepEnvironment:'ground'},G);
    if(ground)assert.notStrictEqual(ground,forms);
   }
 });
