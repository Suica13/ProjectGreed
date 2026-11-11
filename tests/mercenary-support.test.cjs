const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),B=G.battlefieldMode;
test('capture pay and research scale with era and room size and custom rooms cap research',()=>{
 for(const [era,money] of [['0079T1',500],['0079T2',750],['0087T1',1000],['0087T2',1500]]){
  let last=0;
  for(const size of ['cost-1500','cost-10000','cost-20000']){
   const settings=B.presetSettings(era+'-'+size,null,G.eras);
   assert.deepEqual(B.captureReward(settings,0),{money,supplies:money*2});
   const points=B.technologyReward(settings,0,true);
   assert(points>last);last=points;
   assert.equal(points,B.technologyReward(settings,0,false));
  }
  const large=B.presetSettings(era+'-cost-20000',null,G.eras);
  assert.equal(B.technologyReward({...large,costLimit:99999},0,true),last);
 }
 assert.equal(B.technologyReward(B.presetSettings('0079T1-cost-1500'),0,true),1100);
});
test('friendly control healing uses strongest zone once and never repairs main bases or enemy troops',()=>{
 const game=G.create(false,123,Array(G.getMap(B.defaultMapId).spawns.length).fill(null),false,{mode:'battlefield',mapId:B.defaultMapId});
 game.team=0;
 const point=game.battlefield.points[0];point.owner=0;
 const actor=G.makeUnit({unitId:'Type61',kitId:'standard'},2,'healing',point);
 const model=G.modelOf(actor);actor.hp=1;actor.en=0;game.units.push(actor);
 B.heal(G,game);assert.equal(actor.hp,1+Math.round(model.hp*.15));assert.equal(actor.en,Math.ceil(model.en*.3));
 point.owner=1;actor.hp=1;actor.en=0;B.heal(G,game);assert.equal(actor.hp,1);assert.equal(actor.en,0);
 const site=B.deploymentSites(G,game,0).find(s=>s.id.startsWith('base:'));
 actor.x=site.x;actor.y=site.y;point.x=site.x;point.y=site.y;point.owner=0;
 const base=game.units.find(u=>u.team===0&&u.facility?.type==='base');base.hp=100;
 B.heal(G,game);assert.equal(actor.hp,1+Math.round(model.hp*.2));assert.equal(actor.en,Math.ceil(model.en*.4));assert.equal(base.hp,100);
 actor.team=1;actor.hp=1;B.heal(G,game);assert.equal(actor.hp,1);
});
