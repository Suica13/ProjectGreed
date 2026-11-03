const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('full squad melee choreography renders survivors and completes across repeated batches',async({page})=>{
 test.setTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const brokenSource=process.env.GREED_REPRO_MISSING_HEALTH ? require('node:fs').readFileSync('client/map-combat.js','utf8').replace(/  function health\(id\) \{[\s\S]*?\n  \}/,'') : null;
 const result=await page.evaluate(async(brokenSource)=>{
  const combat=brokenSource ? new Function(brokenSource+';return MapCombat;')() : MapCombat;
  Net.leave();session++;
  // Exercise authoritative squad attack/counter scheduling, not isolated weapon clips.
  const e={unitId:'RX_78_2',kitId:PRODUCTION_CATALOG.defaultKits.RX_78_2};
  game=Rules.create(false,1,[[e,e,e],[e,e,e]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
  game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;game.winner=null;
  game.units.forEach((u,i)=>Object.assign(u,{x:5,y:u.team?6:5,squadId:'team-'+u.team,squadSlot:i%3,hp:10000000,en:1000000,shield:0}));
  await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
  setPageView('game');phase='battle';pending=moving=battleView=null;
  let completed=0,minVisible=Infinity,finite=true,meleePairs=0;
  const finish=CombatPlayback.finish;
  CombatPlayback.finish=()=>{completed++;battleView=null;MapCombat.reset();};
  try {
   for(let batch=0;batch<3;batch++){
    game.units.forEach(u=>{u.acted=false;u.plan=null;u.squadOrder=false;u.en=1000000;});
    const room={game},planner=createAttackPlanner(Rules,()=>Math.random().toString(36));planner.reset(room);
    planner.plan(room,game.units[0],game.units[3],null,0,'melee');
    planner.prepare(room);
    while(room.reactions.length)planner.choose(room,room.reactions[0].id,'counter');
    const battles=planner.resolve(room);meleePairs+=battles.filter(b=>b.meleeExchange).length;
    combat.reset();combat.seed(battles);
    battleView={networkId:'repeat-'+batch,battles,actors:battles.flatMap(b=>b.actors),events:battles.flatMap(b=>b.events)};
    phase='battle';combat.begin(battleView,()=>0);
    let now=performance.now();
    for(let frame=0;frame<6000&&battleView;frame++){
     now+=40;combat.update(now);drawMap(now);
     const visible=combat.units().filter(u=>u.hp>0&&!u.mapPose?.hidden);
     minVisible=Math.min(minVisible,visible.length);
     finite&&=visible.every(u=>!u.mapPose||[u.mapPose.x,u.mapPose.y].every(Number.isFinite));
    }
    if(battleView)throw Error('Squad playback did not complete');
   }
  } finally {CombatPlayback.finish=finish;MapCombat.reset();battleView=null;}
  return {completed,minVisible,finite,meleePairs};
 },brokenSource);
 expect(result.meleePairs).toBeGreaterThan(0);expect(result.completed).toBe(3);
 expect(result.minVisible).toBe(6);expect(result.finite).toBe(true);expect(errors).toEqual([]);
});

test('a rendering exception is visible and does not permanently stop the frame loop',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 await page.evaluate(()=>{
  Net.leave();session++;
  const e={unitId:'RGM_79',kitId:'machine_gun'};
  game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});game.deployment=null;
  phase='idle';battleView=null;setPageView('game');
  const original=MapCombat.update;window.recoveredRenderFrames=0;
  MapCombat.update=(now)=>{
   if(++window.recoveredRenderFrames===1)throw Error('render-recovery-fixture');
   return original(now);
  };
 });
 await expect(page.locator('#gameDialogMessage')).toContainText('render-recovery-fixture');
 await expect.poll(()=>page.evaluate(()=>window.recoveredRenderFrames)).toBeGreaterThan(2);
});
