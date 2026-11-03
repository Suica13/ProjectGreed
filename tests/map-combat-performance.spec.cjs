const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('many parallel squad volleys share state and pose calculations',async({page})=>{
 test.setTimeout(60000);
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const baseline=process.env.GREED_PLAYBACK_BASELINE ? require("node:fs").readFileSync(process.env.GREED_PLAYBACK_BASELINE,"utf8") : null;
 const metrics=await page.evaluate(async(baseline)=>{
  Net.leave();session++;
  const e={unitId:'RGM_79',kitId:'machine_gun'};
  game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});game.tiles.forEach(row=>row.fill('plain'));
  const models=[game.units[0],game.units[1]];
  const units=Array.from({length:48},(_,i)=>({...structuredClone(models[i<24?0:1]),id:'perf-'+i,
    x:5+Math.floor((i%24)/6),y:i<24?5:7,squadId:'perf-squad-'+Math.floor(i/6),squadSlot:i%6,hp:1000000,en:100000,shield:0,acted:false}));
  game.units=units;game.deployment=null;game.winner=null;
  await SpriteRenderer.ensureModels(units.map(u=>u.model));
  const records=[];
  for(let wave=0;wave<3;wave++)for(let i=0;i<24;i++) {
   const a=units[i],b=units[24+i],weapon=Rules.modelOf(a).weapons.find(w=>w.type!=='melee'&&!w.special);
   a.acted=false;a.en=100000;
   const actors=structuredClone([a,b]),events=Rules.fight(game,a,b,weapon,'defend');
   records.push({id:'perf-'+wave+'-'+i,a:a.id,b:b.id,actors,events,before:{[a.id]:actors[0].hp,[b.id]:actors[1].hp},crossfire:true,timelineStart:0});
  }
  await SpriteRenderer.ensureAssets([Rules.modelOf(units[0]).weapons.find(w=>w.type!=='melee'&&!w.special).projectile.asset]);
  phase='battle';pending=moving=battleView=null;setPageView('game');
  function measure(api) {
   api.reset();api.seed(records);
   battleView={networkId:'perf',battles:records,actors:records.flatMap(b=>b.actors),events:records.flatMap(b=>b.events)};
   api.begin(battleView,()=>0);api.update(performance.now());
   for(const f of api.frames)f.time=f.plan.impacts[0]+.01;
   const expected=new Map();
   for(const f of api.frames)expected.set(f.event.to,(expected.get(f.event.to)||0)+WeaponEffects.arrived(f.plan,f.time).reduce((n,c)=>n+c.damage,0));
   const arrived=WeaponEffects.arrived,pose=WeaponEffects.firingPose;
   let scans=0,poses=0;
   WeaponEffects.arrived=(...args)=>{scans++;return arrived(...args);};
   WeaponEffects.firingPose=(...args)=>{poses++;return pose(...args);};
   const samples=[];let result;
   for(let i=0;i<35;i++) {
    api.update(performance.now());
    for(const f of api.frames){f.time=f.plan.impacts[0]+.01;f.lastNow=performance.now();}
    const start=performance.now();result=api.units();for(const u of result)api.fieldImpact(u.id);samples.push(performance.now()-start);
   }
   WeaponEffects.arrived=arrived;WeaponEffects.firingPose=pose;
   const correct=result.every(u=>u.team===0 || u.hp===1000000-(expected.get(u.id)||0));
   return {units:result.length,frames:api.frames.length,correct,scansPerFrame:scans/35,posesPerFrame:poses/35,medianMs:samples.sort((a,b)=>a-b)[17]};
  }
  const old=baseline ? measure(new Function(baseline+';return MapCombat;')()) : null;
  const result=measure(MapCombat);
  const f=MapCombat.frames[0], shot=f.plan.shots[0];
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d'),nativeDraw=ctx.drawImage.bind(ctx);
  const image=SpriteRenderer.images[f.weapon.projectile.asset];let draws=0;
  ctx.drawImage=(...args)=>{if(args[0]===image)draws++;return nativeDraw(...args);};
  const time=shot.at+shot.flight*.5;
  ctx.setTransform(.1,0,0,.1,-10000,-10000);
  WeaponEffects.draw(ctx,f.weapon,f.plan,time,f.source,f.event);
  const offscreenDraws=draws;draws=0;
  ctx.setTransform(.1,0,0,.1,100-f.source.x*.1,100-f.source.y*.1);
  WeaponEffects.draw(ctx,f.weapon,f.plan,time,f.source,f.event);
  return {...result,baseline:old,offscreenDraws,onscreenDraws:draws};
 },baseline);
 console.log('MAP_COMBAT_METRICS '+JSON.stringify(metrics));
 expect(metrics.offscreenDraws).toBe(0);expect(metrics.onscreenDraws).toBeGreaterThan(0);
 expect(metrics.correct).toBe(true);expect(metrics.units).toBe(48);expect(metrics.frames).toBe(72);
 expect(metrics.scansPerFrame).toBeLessThanOrEqual(metrics.frames*2+1);
 expect(metrics.posesPerFrame).toBeLessThanOrEqual(metrics.frames+1);
});
