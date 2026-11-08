const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/campaign');
const scenario=G.catalog.scenarios.earth_0079_mid;
const ctx={G,world:scenario.world,production:require('../shared/production-data.cjs'),development:require('../shared/development')};
test('every regional map has four legal base defenses that persist without respawning',()=>{
 const state=C.create(ctx,[{seat:0},{seat:1}]);
 for(const [id,entry] of Object.entries(scenario.regions)){
  const game=G.create(false,1,Array(10).fill(null),false,G.campaignRoomSettings({mapId:entry.mapId}));
  game.campaignBattlefield=G.campaignBattlefield.create(G,state,id);
  G.campaignBattlefield.ensureTurrets(G,game,state);
  const turrets=game.units.filter(u=>u.facility?.campaignDefense);
  assert.equal(turrets.length,4,id);assert.equal(new Set(turrets.map(u=>u.facility.type)).size,4);
  assert(turrets.every(u=>u.team===game.campaignBattlefield.defender));
  assert.equal(new Set(turrets.map(u=>u.x+','+u.y)).size,4);
  turrets[0].hp=0;
  const saved=structuredClone(game);G.campaignBattlefield.ensureTurrets(G,saved,state);
  assert.equal(saved.units.length,4);assert.equal(saved.units[0].hp,0);
 }
});
