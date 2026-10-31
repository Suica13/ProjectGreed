const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules.js');
function fixture() {
  const e = {unitId:'Type61',kitId:'standard'};
  const g=G.create(false,1,[[e,e],[e]],false,{costLimit:99999,unitCostLimit:99999});
  g.tiles=Array.from({length:30},()=>Array(45).fill('plain'));
  g.fogMode='full';
  const [fast,slow,enemy]=g.units;
  const base=G.modelOf(fast);
  G.models.ai_formation_test={...base,move:8,sensors:{sight:1,radar:1,antiDetection:0},
    weapons:base.weapons.map(w=>({...w,min:1,max:3}))};
  for(const u of g.units)Object.assign(u,{model:'ai_formation_test',moved:false,acted:false,actionPoints:10});
  Object.assign(fast,{x:15,y:12,ownerSeat:0});
  Object.assign(slow,{x:5,y:12,ownerSeat:0});
  Object.assign(enemy,{x:35,y:12,ownerSeat:1});
  return {g,fast,slow,enemy};
}
test('AI approaches unseen actual enemies instead of a fixed map edge',()=>{
  const {g,fast,slow,enemy}=fixture();g.units=[fast,enemy];
  Object.assign(enemy,{x:3,y:12});
  const before=G.sensors.view(g,fast.team);
  assert(!G.sensors.visible(g,fast.team,enemy));
  const c=G.aiChoice(g,fast);
  assert(G.dist({...fast,x:c.x,y:c.y},enemy)<G.dist(fast,enemy));
  assert.equal(c.target,null);
  assert.deepEqual(G.sensors.view(g,fast.team),before);
});
test('front units wait for rear units, rear units advance, contact releases formation',()=>{
  const {g,fast,slow,enemy}=fixture();
  let c=G.aiChoice(g,fast);
  assert(G.dist({...fast,x:c.x,y:c.y},enemy)>=G.dist(fast,enemy)-.001);
  c=G.aiChoice(g,slow);
  assert(G.dist({...slow,x:c.x,y:c.y},enemy)<G.dist(slow,enemy));
  Object.assign(enemy,{x:21,y:12});
  c=G.aiChoice(g,fast);
  assert(G.dist({...fast,x:c.x,y:c.y},enemy)<G.dist(fast,enemy));
});
test('other players and enclosed passengers do not hold up a squad',()=>{
  const {g,fast,slow,enemy}=fixture();
  slow.ownerSeat=2;
  let c=G.aiChoice(g,fast);
  assert(G.dist({...fast,x:c.x,y:c.y},enemy)<G.dist(fast,enemy));
  slow.ownerSeat=0;slow.embarked={carrierId:fast.id};
  c=G.aiChoice(g,fast);
  assert(G.dist({...fast,x:c.x,y:c.y},enemy)<G.dist(fast,enemy));
});
