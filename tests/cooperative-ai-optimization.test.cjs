const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),Mission=require('../shared/mission-mode');
const {fixture}=require('../tools/performance-unit-ai.cjs');
const B=G.battlefieldMode;
function battlefield(){
 const e={unitId:'Type61',kitId:'standard'};
 const game=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
 game.tiles=Array.from({length:30},()=>Array(50).fill('plain'));
 const [ally,enemy]=game.units;
 Object.assign(ally,{x:5,y:10});Object.assign(enemy,{x:40,y:10,facility:{id:'enemy-hq',type:'base'}});
 game.battlefield={points:[{id:'rear',owner:0,x:15,y:10},{id:'front',owner:0,x:25,y:10},{id:'target',owner:1,x:12,y:15}]};
 return {game,ally,enemy};
}
test('wave stages change exactly at 31 and 71',()=>{
 for(const [turn,stage]of [[1,'early'],[30,'early'],[31,'middle'],[70,'middle'],[71,'late'],[100,'late']])assert.equal(B.waveStage(turn),stage);
});
test('battlefield formations prefer the nearby post, but attack a closer HQ',()=>{
 const {game,ally,enemy}=battlefield();
 const choose=()=>G.aiTactics.forUnit(G,game,ally,G.aiTactics.decide(G,game,ally));
 assert.equal(choose().goal.id,'target');assert(choose().occupation);
 enemy.x=7;assert.equal(choose().goal.id,enemy.id);assert(!choose().occupation);
});
test('reinforcements favor the forward site and redirect to a threatened rear post',()=>{
 const {game,enemy}=battlefield();
 assert.equal(B.aiDeploymentSites(G,game,0)[0].id,'point:front');
 const attacker={...enemy,id:'attacker',facility:undefined,x:16,y:11};game.units.push(attacker);
 assert.equal(B.aiDeploymentSites(G,game,0)[0].id,'point:rear');
 attacker.hp=0;assert.equal(B.aiDeploymentSites(G,game,0)[0].id,'point:front');
});
test('incremental AI is read-only and gives the synchronous order after many yield points',()=>{
 const game=fixture(),before=JSON.stringify(game),unit=game.units[0];
 const expected=G.aiChoice(game,unit),search=G.aiChoiceSteps(game,unit);let step,count=0;
 do{step=G.withModelQuery(()=>search.next());count++;}while(!step.done);
 assert(count>20);assert.deepEqual(step.value,expected);assert.equal(JSON.stringify(game),before);
});
test('mission ignores tag bans while retaining scenario era, technology and pilot policy',()=>{
 const settings={...G.defaultRoomSettings(),...Mission.settings(G,'mission_white_base'),bannedTypes:['MS'],bannedFactions:['EFSF'],bannedEras:['UC_0079_T1'],pilotPolicy:'no_custom',technologyCaps:{EFSF:5000}};
 const restrictions=G.armyRestrictions(settings,{seat:0,characterFaction:'PMC'});
 assert.equal(settings.costLimit,2000);assert.deepEqual(restrictions.bannedTypes,[]);assert.deepEqual(restrictions.bannedFactions,[]);assert.deepEqual(restrictions.bannedEras,[]);
 assert.equal(restrictions.technologyCaps.EFSF,5000);assert.equal(restrictions.pilotPolicy,'no_custom');assert(restrictions.allowedEras.includes('UC_0079_T1'));assert(!restrictions.allowedEras.includes('UC_0087_T1'));
});
