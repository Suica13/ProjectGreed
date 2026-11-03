const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),P=G.pilots;
const unit=stats=>({pilot:{stats:{...P.baseStats(),...stats}}});
test('attribute bonuses increase by 25 percent, while attack mobility follows the explicit 100/200 curve',()=>{
 const modifiers=P.modifiers(unit({shooting:200,melee:200,accuracy:200,reaction:200,defense:200,speed:200,awakening:100}));
 for(const key of ['shooting','melee','accuracy','reaction'])assert.equal(modifiers[key],1.3125);
 assert.equal(modifiers.defense,.6875);assert.equal(modifiers.move,1.625);assert.equal(modifiers.attackRounds,1.25);
 assert.equal(modifiers.awakeningHit,10);assert.equal(modifiers.awakeningEvasion,10);
 assert.equal(P.modifiers(unit({awakening:99})).awakeningHit,0);
 assert.equal(P.modifiers(unit({awakening:200})).shooting,1);
});
function fixture(){
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
 const [a,b]=g.units;g.tiles.forEach(r=>r.fill('plain'));Object.assign(a,{x:5,y:5,pilot:unit({}).pilot});Object.assign(b,{x:6,y:5,pilot:unit({}).pilot});
 return {g,a,b};
}
test('unit mobility and pilot mobility multiply base rounds; use limits and forced-exit penalties remain',()=>{
 const {g,a}=fixture(),original=G.models[a.model],key='round-mobility-test';
 G.models[key]={...original,speed:160};a.model=key;
 const w={...original.weapons[0],attackRounds:2,pilotRequirements:[],maxUsesPerTurn:undefined};
 try{
  assert.equal(G.attackRounds(g,a,w),3);
  a.pilot=unit({speed:200}).pilot;assert.equal(G.attackRounds(g,a,w),4);
  assert.equal(G.attackRounds(g,a,{...w,maxUsesPerTurn:1}),1);
  assert.equal(G.attackRounds(g,a,{...w,type:'melee'}),1);
  assert.equal(G.attackRounds(g,a,{...w,sourceName:'Common_ArmBR'}),1);
  assert.equal(G.attackRounds(g,a,{...w,sourceName:'Common_DoubleVulcan_MS',weaponClass:'small_vulcan'}),1);
  assert.equal(G.attackRounds(g,a,{...w,pilotRequirements:[{stat:'melee',value:125}]}),1);
  a.forcedExitRound=g.round;assert.equal(G.attackRounds(g,a,w),2);
  assert.equal(G.attackRounds(g,a,{...w,maxUsesPerTurn:1}),0);
 }finally{delete G.models[key];}
});
test('100 awakening adds ten hit and evasion percentage points without adding ordinary damage',()=>{
 const {g,a,b}=fixture(),w=G.modelOf(a).weapons[0];
 const before=G.estimate(g,a,b,w);
 a.pilot=unit({awakening:100}).pilot;const attack=G.estimate(g,a,b,w);
 assert.equal(attack.hit,Math.min(100-G.squadEvasion(g,b),before.hit+10));
 assert.equal(attack.damage,before.damage);
 b.pilot=unit({awakening:100}).pilot;assert.equal(G.estimate(g,a,b,w).hit,attack.hit-10);
 assert(G.estimate(g,a,b,{...w,hit:10000}).hit<=100);
});
test('the authoritative automatic queue executes the same mobility-scaled rounds shown in preview',()=>{
 const {createAttackPlanner}=require('../shared/attack-plans');
 const {g,a,b}=fixture(),key='round-resolution-test';
 G.models[key]={...G.models[a.model],speed:160};a.model=key;a.pilot=unit({speed:200}).pilot;a.en=100000;b.hp=1000000000;
 const weapon=G.modelOf(a).weapons[0],room={game:g};let sequence=0;
 const planner=createAttackPlanner(G,()=>String(++sequence));planner.reset(room);
 try{
  const expected=G.attackRounds(g,a,weapon);assert.equal(expected,4);
  planner.plan(room,a,b,null,0,'shooting');planner.prepare(room);
  while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');
  const battles=planner.resolve(room).filter(battle=>battle.events[0].from===a.id&&battle.events[0].weapon===weapon.id);
  assert.equal(battles.length,expected);
 }finally{delete G.models[key];}
});
test('leadership aura range stays unchanged and effect growth is 25 percent stronger',()=>{
 const {a}=fixture();a.pilot=unit({leadership:125}).pilot;
 assert.equal(G.commandAura(a).radius,4);assert.equal(G.commandAura(a).effect,.1125);
});
