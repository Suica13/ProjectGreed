const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),{createAttackPlanner}=require('../shared/attack-plans');
for(const primaryHp of [1000000,1])test(`one mortar salvo resolves all squad occupants on the same impacts (primary HP ${primaryHp})`,()=>{
 const m=Object.values(G.models).find(m=>m.prefabId==='RGC_80'&&m.weapons.some(w=>w.category==='mortar'));
 const enemy={unitId:'Type61',kitId:'standard'};
 const game=G.create(false,1,[[{unitId:m.prefabId,kitId:m.kitId}],[enemy,enemy,enemy]],false,{fogMode:'disabled'});
 game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
 const [a,...targets]=game.units;Object.assign(a,{x:5,y:5,en:10000});
 targets.forEach((u,i)=>Object.assign(u,{x:8,y:5,hp:i===0?primaryHp:1000000,shield:0,squadId:'mortar-victims',squadSlot:i}));
 const planner=createAttackPlanner(G,()=>Math.random().toString()),room={game};planner.reset(room);
 const w=G.modelOf(a).weapons.find(w=>w.category==='mortar'),en=a.en;
 planner.plan(room,a,targets[0],w,0);planner.prepare(room);
 while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');
 const battles=planner.resolve(room);
 const events=targets.map(t=>battles.flatMap(b=>b.events).filter(e=>e.to===t.id));
 assert(events.every(events=>events.length===1),'one merged lane per target, no duplicate salvo');
 assert.equal(a.en,en-w.en,'one energy charge for the entire target cell');
 const starts=events.map(events=>events[0].shotTimings[0].impactAt);
 assert(starts.every(start=>start===starts[0]),'all occupants are adjudicated at the first shell impact');
 assert(targets.every(t=>t.hp<(t===targets[0]?primaryHp:1000000)));
 for(const eventsForTarget of events.slice(1)) {
  assert.equal(eventsForTarget[0].shotTimings.length,w.shotCount,'the remaining shells keep firing after the selected target dies');
  assert(eventsForTarget[0].strikes[0].damage>0);
 }
});
