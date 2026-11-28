const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),P=G.pilots,A=require('../shared/automatic-fire');
const unit=stats=>({pilot:{stats:{...P.baseStats(),...stats}}});
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('pilot attribute gains follow reduced curves and awakening is only a five percent coefficient bonus',()=>{
 const m=P.modifiers(unit({shooting:200,melee:200,accuracy:200,reaction:200,defense:200,speed:200,awakening:99}));
 near(m.shooting,1.25);near(m.melee,1.25);near(m.shootingRounds,1.25);near(m.meleeRounds,1.25);
 near(m.attackRounds,1.125);near(m.move,1.5);near(m.defense,.8125);near(m.accuracy,1.1875);near(m.reaction,1.1875);
 for(const awakening of [100,200]){const n=P.modifiers(unit({awakening}));near(n.accuracy,1.05);near(n.reaction,1.05);near(n.shooting,1);near(n.melee,1);assert.equal(n.awakeningHit,undefined);}
});
test('shooting and melee attributes affect only their own counts; limits and counter replies remain',()=>{
 const g={round:1},u={};let m={speed:100,pilotModifiers:P.modifiers(unit({})),weapons:[]};const api={modelOf:()=>m};
 const ranged={type:'shell',weaponClass:'rifle',attackRounds:8},melee={type:'melee',weaponClass:'melee',attackRounds:3};
 const counts=()=>[A.roundCount(api,g,u,ranged),A.roundCount(api,g,u,melee)];assert.deepEqual(counts(),[8,4]);
 m.pilotModifiers=P.modifiers(unit({shooting:200}));assert.deepEqual(counts(),[10,4]);
 m.pilotModifiers=P.modifiers(unit({melee:200}));assert.deepEqual(counts(),[8,5]);
 assert.equal(A.roundCount(api,g,u,melee,true),1);
 m.pilotModifiers=P.modifiers(unit({speed:200}));assert.deepEqual(counts(),[9,5]);
 m.pilotModifiers=P.modifiers(unit({}));m.speed=200;assert.deepEqual(counts(),[10,5]);
 assert.equal(A.roundCount(api,g,u,{...ranged,maxUsesPerTurn:1}),1);
 u.forcedExitRound=1;assert.equal(A.roundCount(api,g,u,{...ranged,maxUsesPerTurn:1}),0);
});
function fixture(){const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'});const [a,b]=g.units;g.tiles.forEach(r=>r.fill('plain'));Object.assign(a,{x:5,y:5,pilot:unit({}).pilot});Object.assign(b,{x:6,y:5,pilot:unit({}).pilot});return {g,a,b};}
test('authoritative automatic queue agrees with reduced mobility preview',()=>{
 const {createAttackPlanner}=require('../shared/attack-plans'),{g,a,b}=fixture(),key='round-resolution-test';
 G.models[key]={...G.models[a.model],speed:160};a.model=key;a.pilot=unit({speed:200,shooting:200}).pilot;a.en=100000;b.hp=1000000000;
 const weapon=G.modelOf(a).weapons[0],room={game:g};let sequence=0;const planner=createAttackPlanner(G,()=>String(++sequence));planner.reset(room);
 try{const expected=G.attackRounds(g,a,weapon);assert.equal(expected,3);planner.plan(room,a,b,null,0,'shooting');planner.prepare(room);while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');const battles=planner.resolve(room).filter(battle=>battle.events[0].from===a.id&&battle.events[0].weapon===weapon.id);assert.equal(battles.length,expected);}finally{delete G.models[key];}
});
test('awakening no longer scales remote damage but weapon requirements still apply',()=>{
 const {a}=fixture();const m=Object.values(G.models).find(m=>m.weapons.some(w=>w.remote&&w.remote.kind!=='incom'));a.model=m.prefabId+'__'+m.kitId;
 const w=m.weapons.find(w=>w.remote&&w.remote.kind!=='incom');let previous;
 for(const awakening of [50,100,200]){a.pilot=unit({awakening}).pilot;const now=G.weaponStats(w,a);if(previous)assert.deepEqual(now.damageComponents,previous);previous=now.damageComponents;assert.equal(now.remoteDamageMultiplier ?? 1,1);}
 assert(w.pilotRequirements?.length);
});
test('melee attribute changes actual offensive melee rounds, not just preview',()=>{
 const {createAttackPlanner}=require('../shared/attack-plans'),{g,a,b}=fixture();
 a.pilot=unit({melee:300}).pilot;a.en=100000;b.hp=1000000000;
 const weapon=G.modelOf(a).weapons.find(w=>w.type==='melee'&&!w.pilotRequirements?.length&&w.category!=='ram');assert(weapon);
 const expected=G.attackRounds(g,a,weapon);assert(expected>=3);
 const room={game:g};let n=0;const planner=createAttackPlanner(G,()=>String(++n));planner.reset(room);planner.plan(room,a,b,null,0,'melee');planner.prepare(room);
 while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');
 const battles=planner.resolve(room).filter(x=>x.events[0].from===a.id&&x.events[0].weapon===weapon.id);assert.equal(battles.length,expected);
});
