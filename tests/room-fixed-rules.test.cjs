const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),M=require('../shared/mission-mode'),C=require('../shared/contract-mode'),{createRoomEngine}=require('../shared/room-engine');
test('fixed rules: N1-N9 patrol limits increase from 24 to 48 in steps of three',()=>{
 assert.deepEqual(Array.from({length:9},(_,i)=>C.config(i+1).patrolLimit),[24,27,30,33,36,39,42,45,48]);
});
test('fixed rules: mission maps and shared battle creation always allow pilots with full fog',()=>{
 for(const map of Object.values(G.catalog.maps).filter(map=>map.mission)) {
  const settings={...G.defaultRoomSettings(),...M.settings(G,map.id),fogMode:'disabled',pilotPolicy:'none'};
  assert.equal(M.settings(G,map.id).fogMode,'full');assert.equal(M.settings(G,map.id).pilotPolicy,'allow');
  assert.equal(G.formationRestrictions(settings,0).pilotPolicy,'allow');
  const game=G.create(false,7,Array(map.spawns.length).fill(null),false,settings);assert.equal(game.fogMode,'full');
 }
});
test('fixed rules: mission authority rejects attempts to turn off fog or pilots, quick battles remain configurable',t=>{
 let serial=0;const engine=createRoomEngine({rules:G,randomId:()=>"fixed-"+(++serial),randomToken:()=>"token-"+(++serial),randomSeed:()=>7,send(){}});
 t.after(()=>engine.close());const host={readyState:1};engine.join(host,{mode:'create',room:'FIXED_RULES',roomMode:'mission',characterFaction:'PMC'});
 const room=engine.rooms.get('FIXED_RULES');assert.equal(room.settings.fogMode,'full');assert.equal(room.settings.pilotPolicy,'allow');
 const act=fields=>engine.action(host,{id:'rules-'+(++serial),revision:room.revision,action:'configure_room',...fields});
 act({...room.settings,fogMode:'disabled',pilotPolicy:'none'});
 assert.equal(room.settings.fogMode,'full');assert.equal(room.settings.pilotPolicy,'allow');
 act({...room.settings,battleMode:'quick',fogMode:'disabled',pilotPolicy:'none'});
 assert.equal(room.settings.mode,'quick');assert.equal(room.settings.fogMode,'disabled');assert.equal(room.settings.pilotPolicy,'none');
});
