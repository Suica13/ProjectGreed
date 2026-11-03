const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('mixed squad volleys and melee counters share facing and keep approach out of dodge offsets',async({page})=>{
 test.setTimeout(60000);
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  Net.leave();session++;
  const e={unitId:'RGM_79',kitId:'machine_gun'};
  game=Rules.create(false,42,[[e,e,e],[e,e,e]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
  game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;game.winner=null;
  game.units.forEach((u,i)=>Object.assign(u,{x:5,y:u.team?6:5,squadId:'team-'+u.team,squadSlot:i%3,hp:10000000,en:1000000,shield:0,angle:90}));
  await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
  const room={game},planner=createAttackPlanner(Rules,()=>Math.random().toString(36));planner.reset(room);
  planner.plan(room,game.units[0],game.units[3],null,0,'melee');planner.prepare(room);
  while(room.reactions.length)planner.choose(room,room.reactions[0].id,'counter');
  const battles=planner.resolve(room);
  MapCombat.reset();MapCombat.seed(battles);
  battleView={networkId:'facing',battles,actors:battles.flatMap(b=>b.actors),events:battles.flatMap(b=>b.events)};
  phase='battle';pending=moving=null;setPageView('game');MapCombat.begin(battleView,()=>0);
  const finish=CombatPlayback.finish;let completed=false;
  CombatPlayback.finish=()=>{completed=true;battleView=null;};
  const checked=new Set();let counters=0,maxFacingError=0,maxMeleeOffset=0,maxCounterJump=0;
  let previous=new Map(),now=performance.now(),maxDrawFacingError=0,drawnShots=0;
  const draw=SpriteRenderer.draw;
  SpriteRenderer.draw=(...args)=>{
   if(args[14] && /Shoot|Fire/.test(args[6])){
    drawnShots++;
    maxDrawFacingError=Math.max(maxDrawFacingError,Math.abs(((args[5]-args[13]+540)%360)-180));
   }
   return draw(...args);
  };
  try {
   for(let i=0;i<10000&&!completed;i++){
    now+=10;MapCombat.update(now);
    const units=MapCombat.units();
    for(const f of MapCombat.frames){
     const angle=f.source.angle,aim=f.source.aimAngle;
     maxFacingError=Math.max(maxFacingError,Math.abs(((angle-aim+540)%360)-180));
     if(checked.has(f))continue;checked.add(f);
     if(f.event.meleeExchange){
      const limit=ART.presentation.dodgeDistance*f.source.scale;
      maxMeleeOffset=Math.max(maxMeleeOffset,Math.abs(f.event.sourceDodgeX||0)/limit,Math.abs(f.event.sourceDodgeSlot||0));
      if(f.event.from===f.event.meleeExchange.defender){
       counters++;
       const id=f.event.meleeExchange.attacker,before=previous.get(id),after=units.find(u=>u.id===id)?.mapPose;
       if(before&&after)maxCounterJump=Math.max(maxCounterJump,Math.hypot(after.x-before.x,after.y-before.y));
      }
     }
    }
    previous=new Map(units.filter(u=>u.mapPose).map(u=>[u.id,{...u.mapPose}]));
    drawMap(now);
   }
  } finally {SpriteRenderer.draw=draw;CombatPlayback.finish=finish;MapCombat.reset();battleView=null;}
  return {completed,frames:checked.size,counters,maxFacingError,maxMeleeOffset,maxCounterJump,maxDrawFacingError,drawnShots};
 });
 expect(result.completed).toBe(true);expect(result.frames).toBeGreaterThan(10);expect(result.counters).toBeGreaterThan(0);
 expect(result.maxFacingError).toBeLessThan(.001);expect(result.maxMeleeOffset).toBeLessThan(1.6);
 expect(result.maxCounterJump).toBeLessThan(8);
 expect(result.drawnShots).toBeGreaterThan(0);expect(result.maxDrawFacingError).toBeLessThan(.001);
});
